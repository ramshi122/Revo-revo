/* REVO FIXER — isolated wheel-direction analysis module.
 * The module is read-only against the existing Firebase results feed.
 * It stores analysis records separately in localStorage and never alters source results.
 */
(function (root) {
  'use strict';

  const WHEEL_ORDER = [
    '1','2','5','1','2','Pachinko','1','5','1','2','1','Coin Flip',
    '1','2','1','10','2','Cash Hunt','1','2','1','5','1','Coin Flip',
    '1','5','2','10','1','Pachinko','1','2','5','1','2','Coin Flip',
    '1','10','1','5','1','Cash Hunt','1','2','5','1','2','Coin Flip',
    '2','1','10','2','1','Crazy Time'
  ];
  const STORAGE_HISTORY = 'revo.wheelDirection.records.v1';
  const STORAGE_PENDING = 'revo.wheelDirection.pending.v1';
  const STORAGE_BASELINE = 'revo.wheelDirection.baseline.v1';
  const OUTCOME_COUNTS = {'1':21,'2':13,'5':7,'10':4,'Coin Flip':4,'Pachinko':2,'Cash Hunt':2,'Crazy Time':1};
  const SAMPLE_COUNT = 360;
  const RING_FACTORS = [0.72, 0.80, 0.88];
  const CHANNELS_PER_ANGLE = RING_FACTORS.length * 3;

  function normalizeOutcome(raw) {
    if (raw === null || raw === undefined) return null;
    let value = raw;
    if (typeof raw === 'object') {
      value = raw.result || raw.outcome || raw.wheelResult || raw.name || raw.value || raw.label || '';
    }
    const s = String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s === '1' || s === '2' || s === '5' || s === '10') return s;
    if (s.includes('coinflip')) return 'Coin Flip';
    if (s.includes('pachinko')) return 'Pachinko';
    if (s.includes('cashhunt')) return 'Cash Hunt';
    if (s.includes('crazytime') || s.includes('crazybonus') || s === 'crazy') return 'Crazy Time';
    return null;
  }

  function getNextFivePockets(referenceIndex, direction) {
    if (!Number.isInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= WHEEL_ORDER.length) return [];
    if (direction !== 'clockwise' && direction !== 'counterclockwise') return [];
    const step = direction === 'clockwise' ? -1 : 1;
    const items = [];
    for (let n = 1; n <= 5; n++) {
      const index = (referenceIndex + step * n + WHEEL_ORDER.length * 2) % WHEEL_ORDER.length;
      items.push({index:index, outcome:WHEEL_ORDER[index]});
    }
    return items;
  }

  function expectedHitProbability(candidates) {
    const outcomes = Array.from(new Set((candidates || []).map(function (c) {
      return normalizeOutcome(c && typeof c === 'object' ? c.outcome : c);
    }).filter(Boolean)));
    return outcomes.reduce(function (sum, outcome) {
      return sum + (OUTCOME_COUNTS[outcome] || 0);
    }, 0) / WHEEL_ORDER.length;
  }

  function evaluateOutcome(candidates, actualResult) {
    const actual = normalizeOutcome(actualResult);
    if (!actual || !Array.isArray(candidates) || candidates.length !== 5) return 'INVALID';
    return candidates.some(function (c) { return normalizeOutcome(c && typeof c === 'object' ? c.outcome : c) === actual; }) ? 'HIT' : 'MISS';
  }

  // Signature layout: SAMPLE_COUNT angular bins; CHANNELS_PER_ANGLE RGB triplets across three radii.
  // A positive shift means the visual wheel features moved clockwise on screen.
  function compareSignatures(previous, current, maxDegrees) {
    if (!previous || !current || previous.length !== current.length || previous.length % CHANNELS_PER_ANGLE !== 0) return null;
    const n = previous.length / CHANNELS_PER_ANGLE;
    if (n < 60) return null;
    const limit = Math.max(2, Math.min(Math.floor(n / 6), Math.floor((maxDegrees || 30) * n / 360)));
    let bestShift = 0;
    let bestError = Infinity;
    let secondError = Infinity;

    for (let shift = -limit; shift <= limit; shift++) {
      let total = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const j = (i - shift + n) % n;
        const a = i * CHANNELS_PER_ANGLE;
        const b = j * CHANNELS_PER_ANGLE;
        for (let ch = 0; ch < CHANNELS_PER_ANGLE; ch++) {
          total += Math.abs(current[a + ch] - previous[b + ch]);
          count++;
        }
      }
      const error = total / (count * 255);
      if (error < bestError) {
        bestError = error;
        bestShift = shift;
      }
    }

    // Compare against the best non-neighbouring alternative to avoid understating confidence
    // merely because adjacent angular bins describe the same broad colour block.
    for (let shift = -limit; shift <= limit; shift++) {
      if (Math.abs(shift - bestShift) <= 2) continue;
      let total = 0;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const j = (i - shift + n) % n;
        const a = i * CHANNELS_PER_ANGLE;
        const b = j * CHANNELS_PER_ANGLE;
        for (let ch = 0; ch < CHANNELS_PER_ANGLE; ch++) {
          total += Math.abs(current[a + ch] - previous[b + ch]);
          count++;
        }
      }
      const error = total / (count * 255);
      if (error < secondError) secondError = error;
    }

    if (!Number.isFinite(secondError)) secondError = bestError;
    const prominence = Math.max(0, (secondError - bestError) / Math.max(secondError, 0.01));
    return {
      shiftBins:bestShift,
      shiftDegrees:bestShift * 360 / n,
      bestError:bestError,
      confidence:prominence,
      edgeLimited:Math.abs(bestShift) >= limit - 1
    };
  }

  function computeStats(records) {
    const settled = (records || []).filter(function (r) { return !!r.roundId && !!r.actualResult; });
    const invalid = settled.filter(function (r) { return r.status === 'INVALID'; }).length;
    const valid = settled.filter(function (r) { return r.status === 'HIT' || r.status === 'MISS'; });
    function section(rows) {
      const hits = rows.filter(function (r) { return r.status === 'HIT'; }).length;
      const baselineRows = rows.filter(function (r) { return Number.isFinite(r.expectedProbability); });
      const baseline = baselineRows.length ? baselineRows.reduce(function (sum, r) { return sum + r.expectedProbability; }, 0) / baselineRows.length : null;
      return {
        total:rows.length,
        hits:hits,
        misses:rows.length - hits,
        hitRate:rows.length ? hits / rows.length : null,
        baseline:baseline,
        difference:rows.length && baseline !== null ? hits / rows.length - baseline : null
      };
    }
    const all = section(valid);
    const recent = section(valid.slice(-20));
    const clockwise = section(valid.filter(function (r) { return r.direction === 'clockwise'; }));
    const counterclockwise = section(valid.filter(function (r) { return r.direction === 'counterclockwise'; }));
    return {valid:valid.length, hits:all.hits, misses:all.misses, invalid:invalid, hitRate:all.hitRate,
      baseline:all.baseline, difference:all.difference, recent:recent, clockwise:clockwise, counterclockwise:counterclockwise};
  }

  const API = {
    WHEEL_ORDER:WHEEL_ORDER.slice(),
    OUTCOME_COUNTS:Object.assign({}, OUTCOME_COUNTS),
    normalizeOutcome:normalizeOutcome,
    getNextFivePockets:getNextFivePockets,
    expectedHitProbability:expectedHitProbability,
    evaluateOutcome:evaluateOutcome,
    compareSignatures:compareSignatures,
    computeStats:computeStats
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.REVOWheelAnalysis = API;

  if (typeof document === 'undefined') return;

  const $ = function (id) { return document.getElementById(id); };
  const state = {
    stream:null, tracking:false, raf:0, video:null, canvas:null, ctx:null,
    center:null, radius:null, previousSignature:null, previousAt:null,
    direction:null, candidateDirection:null, candidateDirectionCount:0,
    lastMotionAt:0, lastMotionQuality:'NOT TRACKING', lastError:null,
    lastShiftDegrees:null, lastVelocity:null, lastProminence:null,
    resultsConnected:false, snapshotInitialized:false, knownIds:new Set(),
    latestEntries:[], lastConfirmedResult:null, pending:null, history:[],
    referenceIndex:null, baselineIds:[], savedBaselineIds:null
  };

  function readJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { setText('waFeedStatus', 'Local save failed: ' + (e && e.message ? e.message : 'storage unavailable')); return false; }
  }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
  function displayOutcome(value) { return normalizeOutcome(value) || 'Unknown'; }
  function directionLabel(direction) { return direction === 'clockwise' ? 'RIGHT / CLOCKWISE' : direction === 'counterclockwise' ? 'LEFT / COUNTERCLOCKWISE' : 'UNKNOWN'; }
  function formatPct(value) { return value === null || value === undefined || !Number.isFinite(value) ? '—' : (value * 100).toFixed(1) + '%'; }
  function formatTime(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleTimeString(); } catch (_) { return '—'; }
  }
  function validMotion() {
    return !!state.direction && !!state.center && !!state.radius &&
      (Date.now() - state.lastMotionAt) <= 350 && state.lastMotionQuality === 'GOOD';
  }

  function loadPersisted() {
    const records = readJSON(STORAGE_HISTORY, []);
    state.history = Array.isArray(records) ? records : [];
    const pending = readJSON(STORAGE_PENDING, null);
    state.pending = pending && typeof pending === 'object' ? pending : null;
    state.savedBaselineIds = readJSON(STORAGE_BASELINE, []);
    if (!Array.isArray(state.savedBaselineIds)) state.savedBaselineIds = [];
  }

  function storePending() {
    writeJSON(STORAGE_PENDING, state.pending);
    writeJSON(STORAGE_BASELINE, state.pending && Array.isArray(state.pending.baselineRoundIds) ? state.pending.baselineRoundIds : []);
  }

  function outcomeFromEntry(value) {
    if (value && typeof value === 'object') {
      return normalizeOutcome(value.result || value.outcome || value.wheelResult || value.winner || value.value || value.name);
    }
    return normalizeOutcome(value);
  }

  function entryTimestamp(value) {
    if (!value || typeof value !== 'object') return null;
    const raw = value.time || value.timestamp || value.createdAt || value.finishedAt || value.finished_at;
    if (raw === undefined || raw === null || raw === '') return null;
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) return num < 100000000000 ? num * 1000 : num;
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseEntries(data) {
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data).map(function (pair) {
      const key = String(pair[0]);
      const raw = pair[1];
      const outcome = outcomeFromEntry(raw);
      const roundId = raw && typeof raw === 'object' ?
        String(raw.roundId || raw.roundID || raw.gameRoundId || raw.game_round_id || raw.id || key) : key;
      return {roundId:roundId, outcome:outcome, timestamp:entryTimestamp(raw), receivedAt:Date.now(), raw:raw};
    }).filter(function (entry) { return !!entry.outcome; }).sort(function (a, b) {
      return (a.timestamp || a.receivedAt) - (b.timestamp || b.receivedAt);
    });
  }

  function hasRoundId(roundId) {
    return state.history.some(function (record) { return String(record.roundId) === String(roundId); });
  }

  function saveHistory() {
    writeJSON(STORAGE_HISTORY, state.history);
    renderStats();
    renderHistory();
  }

  function settlePending(result, recoveredFromSnapshot) {
    const pending = state.pending;
    if (!pending || !result || !result.outcome || hasRoundId(result.roundId)) return false;
    if (recoveredFromSnapshot && (!Array.isArray(pending.baselineRoundIds) ||
        pending.baselineRoundIds.indexOf(result.roundId) >= 0 || !result.timestamp || result.timestamp < pending.generatedAt)) return false;

    pending.roundId = String(result.roundId);
    pending.actualResult = result.outcome;
    pending.resultTimestamp = result.timestamp || result.receivedAt || Date.now();
    pending.settledAt = Date.now();
    if (pending.generatedAt && result.timestamp && result.timestamp < pending.generatedAt) {
      pending.status = 'INVALID';
      pending.reason = 'Result timestamp predates candidate generation; this round was not scored';
    } else if (pending.status === 'WAITING') {
      pending.status = evaluateOutcome(pending.candidates, result.outcome);
      if (pending.status === 'INVALID') pending.reason = 'Confirmed result could not be normalized or evaluated';
    }
    // A result that duplicates a settled round is ignored above. Keep original candidate data immutable.
    delete pending.baselineRoundIds;
    state.history.push(pending);
    state.pending = null;
    storePending();
    saveHistory();
    state.lastConfirmedResult = result;
    renderCurrent();
    return true;
  }

  function captureObservation() {
    if (state.pending) {
      setText('waCurrentStatus', 'WAITING — previous observation is still unmatched');
      return;
    }
    const now = Date.now();
    const refValue = $('waReferencePocket') ? $('waReferencePocket').value : '';
    const refIndex = refValue === '' ? null : Number(refValue);
    const direction = state.direction;
    const motionOk = validMotion();
    const candidates = motionOk && Number.isInteger(refIndex) ? getNextFivePockets(refIndex, direction) : [];
    const reasons = [];
    if (!motionOk) reasons.push('Reliable wheel motion direction is not currently available');
    if (!Number.isInteger(refIndex) || refIndex < 0 || refIndex >= WHEEL_ORDER.length) reasons.push('Reference pocket at the fixed pointer was not selected');
    if (!state.resultsConnected || !state.snapshotInitialized) reasons.push('Confirmed result feed is not connected');
    if (!state.resultsConnected || !state.snapshotInitialized || !(state.knownIds instanceof Set)) reasons.push('Live-result baseline is unavailable');

    const valid = reasons.length === 0 && candidates.length === 5;
    const record = {
      observationId:'obs-' + now + '-' + Math.random().toString(36).slice(2, 9),
      observationTimestamp:new Date(now).toISOString(),
      generatedAt:now,
      direction:valid ? direction : null,
      observedDirection:direction || null,
      referenceIndex:Number.isInteger(refIndex) ? refIndex : null,
      referenceSegment:Number.isInteger(refIndex) ? WHEEL_ORDER[refIndex] : null,
      candidates:valid ? candidates : [],
      candidateLabels:valid ? candidates.map(function (c) { return c.outcome; }) : [],
      actualResult:null,
      roundId:null,
      status:valid ? 'WAITING' : 'INVALID',
      reason:valid ? null : reasons.join('; '),
      quality:{
        label:state.lastMotionQuality,
        measuredAt:state.lastMotionAt || null,
        angularVelocityDegPerSec:state.lastVelocity,
        shiftDegrees:state.lastShiftDegrees,
        imageMatchConfidence:state.lastProminence,
        calibrated:!!state.center && !!state.radius
      },
      expectedProbability:valid ? expectedHitProbability(candidates) : null,
      baselineRoundIds:state.resultsConnected && state.snapshotInitialized ? Array.from(state.knownIds) : null
    };
    state.pending = record;
    storePending();
    renderCurrent();
    setText('waCandidates', valid ? candidates.map(function (c) { return '#' + c.index + ' ' + c.outcome; }).join('  ·  ') : 'INVALID — ' + record.reason);
    if (valid) setText('waCurrentStatus', 'WAITING — candidates recorded before the result');
    else setText('waCurrentStatus', 'INVALID — recorded; waiting for the next confirmed result');
  }

  function candidateSummary(records) {
    return records.map(function (c) { return '#' + c.index + ' ' + c.outcome; }).join('  ·  ');
  }

  function renderCurrent() {
    const pending = state.pending;
    setText('waDirection', directionLabel(state.direction));
    setText('waVelocity', state.lastVelocity === null || !Number.isFinite(state.lastVelocity) ? '—' : Math.abs(state.lastVelocity).toFixed(1) + '°/s');
    setText('waMotionQuality', state.lastMotionQuality + (state.lastMotionAt ? ' · observed ' + formatTime(state.lastMotionAt) : ''));
    if (state.lastError) setText('waMotionNote', state.lastError);
    else if (!state.tracking) setText('waMotionNote', 'No screen-capture motion source. Direction is not guessed.');
    else setText('waMotionNote', 'RIGHT = clockwise; LEFT = counterclockwise. The detector tracks visible wheel colours in the shared screen.');
    if (pending) {
      setText('waCandidates', pending.candidates && pending.candidates.length ? candidateSummary(pending.candidates) : 'No candidates — observation is INVALID');
      setText('waCurrentStatus', pending.status === 'WAITING' ? 'WAITING — candidates locked before result' : 'INVALID — ' + (pending.reason || 'insufficient evidence'));
    } else if (state.history.length) {
      const last = state.history[state.history.length - 1];
      setText('waCandidates', last.candidates && last.candidates.length ? candidateSummary(last.candidates) : 'No candidate set');
      setText('waCurrentStatus', last.status + (last.reason ? ' — ' + last.reason : ''));
    } else {
      setText('waCandidates', 'Waiting for a valid motion observation');
      setText('waCurrentStatus', 'WAITING');
    }
    const latest = state.lastConfirmedResult;
    setText('waLiveResult', latest ? latest.outcome + ' · round ' + latest.roundId : 'Waiting for a confirmed result');
    setText('waFeedStatus', state.resultsConnected ? 'Read-only result feed connected · Firebase crazy_results' : 'Result feed unavailable — no hit rate will be inferred');
    renderStats();
    renderHistory();
  }

  function renderStats() {
    const s = computeStats(state.history);
    setText('waValidRounds', String(s.valid));
    setText('waHits', String(s.hits));
    setText('waMisses', String(s.misses));
    setText('waInvalid', String(s.invalid));
    setText('waHitRate', formatPct(s.hitRate));
    setText('waBaseline', formatPct(s.baseline));
    setText('waDifference', s.difference === null ? '—' : ((s.difference >= 0 ? '+' : '') + (s.difference * 100).toFixed(1) + ' pp'));
    const recent = s.recent.total ? formatPct(s.recent.hitRate) + ' (n=' + s.recent.total + ')' : '—';
    const cw = s.clockwise.total ? formatPct(s.clockwise.hitRate) + ' (n=' + s.clockwise.total + ')' : '—';
    const ccw = s.counterclockwise.total ? formatPct(s.counterclockwise.hitRate) + ' (n=' + s.counterclockwise.total + ')' : '—';
    setText('waRecentRate', recent);
    setText('waClockwiseRate', cw);
    setText('waCounterRate', ccw);
    setText('waSampleWarning', s.valid < 30 ? 'Exploratory only: fewer than 30 valid settled rounds.' : 'Observed rate only; compare against the per-round wheel-layout baseline. No predictive claim is implied.');
  }

  function renderHistory() {
    const holder = $('waHistory');
    if (!holder) return;
    const rows = state.history.slice(-6).reverse();
    if (!rows.length) {
      holder.innerHTML = '<div class="wa-empty">No evaluated rounds recorded yet.</div>';
      return;
    }
    holder.innerHTML = rows.map(function (r) {
      const candidates = (r.candidateLabels || []).join(', ') || '—';
      return '<div class="wa-history-row">' +
        '<div><b>' + escapeHTML(r.actualResult || '—') + '</b><small>Round ' + escapeHTML(r.roundId || 'unmatched') + '</small></div>' +
        '<div><span class="wa-status wa-' + String(r.status || 'INVALID').toLowerCase() + '">' + escapeHTML(r.status || 'INVALID') + '</span><small>' + escapeHTML(directionLabel(r.direction)) + '</small></div>' +
        '<div><small>Five candidates</small><b>' + escapeHTML(candidates) + '</b></div>' +
      '</div>';
    }).join('');
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function startTracking() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      state.lastError = 'Screen sharing is not supported by this browser. Use a supported HTTPS browser.';
      renderCurrent();
      return;
    }
    navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:8,max:15}}, audio:false}).then(function (stream) {
      state.stream = stream;
      state.tracking = true;
      state.video = $('waCaptureVideo');
      state.canvas = $('waPreviewCanvas');
      state.ctx = state.canvas.getContext('2d', {willReadFrequently:true});
      state.video.srcObject = stream;
      state.lastError = null;
      state.center = null;
      state.radius = null;
      state.previousSignature = null;
      state.previousAt = null;
      state.direction = null;
      state.candidateDirection = null;
      state.candidateDirectionCount = 0;
      $('waPreviewCanvas').hidden = false;
      $('waStopTracking').disabled = false;
      $('waStartTracking').disabled = true;
      $('waResetCalibration').disabled = false;
      state.video.play().then(function () {
        requestAnimationFrame(trackFrame);
        renderCurrent();
      }).catch(function () {
        state.lastError = 'The shared screen could not start playing.';
        renderCurrent();
      });
      const track = stream.getVideoTracks()[0];
      if (track) track.addEventListener('ended', stopTracking);
    }).catch(function (e) {
      state.lastError = 'Screen sharing was not started: ' + (e && e.message ? e.message : 'permission denied');
      renderCurrent();
    });
  }

  function stopTracking() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); });
    if (state.video) { state.video.pause(); state.video.srcObject = null; }
    state.stream = null;
    state.tracking = false;
    state.previousSignature = null;
    state.previousAt = null;
    state.direction = null;
    state.candidateDirection = null;
    state.candidateDirectionCount = 0;
    state.lastMotionQuality = 'NOT TRACKING';
    state.lastVelocity = null;
    $('waStartTracking').disabled = false;
    $('waStopTracking').disabled = true;
    renderCurrent();
  }

  function resetCalibration() {
    state.center = null;
    state.radius = null;
    state.previousSignature = null;
    state.previousAt = null;
    state.direction = null;
    state.candidateDirection = null;
    state.candidateDirectionCount = 0;
    state.lastMotionQuality = 'CALIBRATION REQUIRED';
    state.lastError = 'Click the wheel centre, then a point on the visible rim in the preview.';
    renderCurrent();
  }

  function sampleSignature(imageData, width, height) {
    if (!state.center || !state.radius || !width || !height) return null;
    const pixels = imageData.data;
    const signature = new Uint8Array(SAMPLE_COUNT * CHANNELS_PER_ANGLE);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const theta = -Math.PI / 2 + (2 * Math.PI * i / SAMPLE_COUNT);
      let out = i * CHANNELS_PER_ANGLE;
      for (let ring = 0; ring < RING_FACTORS.length; ring++) {
        const x = Math.round(state.center.x + state.radius * RING_FACTORS[ring] * Math.cos(theta));
        const y = Math.round(state.center.y + state.radius * RING_FACTORS[ring] * Math.sin(theta));
        if (x < 0 || y < 0 || x >= width || y >= height) return null;
        const idx = (y * width + x) * 4;
        signature[out++] = pixels[idx];
        signature[out++] = pixels[idx + 1];
        signature[out++] = pixels[idx + 2];
      }
    }
    return signature;
  }

  function recordMotion(comparison, timeMs, deltaMs) {
    const tooSlow = Math.abs(comparison.shiftDegrees) < 0.8;
    const valid = deltaMs >= 45 && deltaMs <= 450 && !comparison.edgeLimited &&
      comparison.bestError <= 0.20 && comparison.confidence >= 0.025 && !tooSlow;
    state.lastShiftDegrees = comparison.shiftDegrees;
    state.lastProminence = comparison.confidence;
    state.lastError = null;

    if (!valid) {
      state.direction = null;
      state.candidateDirection = null;
      state.candidateDirectionCount = 0;
      state.lastMotionQuality = 'INSUFFICIENT';
      if (deltaMs > 450) state.lastError = 'Frame gap is too long; motion direction is not inferred.';
      else if (comparison.edgeLimited) state.lastError = 'Wheel movement exceeded the tracking range; reduce the frame gap or recalibrate.';
      else if (tooSlow) state.lastError = 'Wheel motion is too small or stopped; direction is unknown.';
      else state.lastError = 'Visual landmark match was ambiguous; direction is unknown.';
      return;
    }

    const direction = comparison.shiftDegrees > 0 ? 'clockwise' : 'counterclockwise';
    state.lastVelocity = comparison.shiftDegrees / (deltaMs / 1000);
    state.lastMotionAt = timeMs;
    state.lastMotionQuality = 'TRACKING';
    if (state.candidateDirection === direction) state.candidateDirectionCount++;
    else {
      state.candidateDirection = direction;
      state.candidateDirectionCount = 1;
    }
    // Require three consecutive, sufficiently clear frame-to-frame matches.
    if (state.candidateDirectionCount >= 3) {
      state.direction = direction;
      state.lastMotionQuality = 'GOOD';
      state.lastError = null;
    } else {
      state.direction = null;
      state.lastMotionQuality = 'BUILDING CONFIDENCE';
    }
  }

  function paintOverlay() {
    if (!state.ctx || !state.canvas) return;
    const ctx = state.ctx;
    if (state.center) {
      ctx.save();
      ctx.strokeStyle = '#39f5cf';
      ctx.lineWidth = Math.max(2, state.canvas.width / 500);
      ctx.beginPath();
      ctx.arc(state.center.x, state.center.y, state.radius || 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(state.center.x - 10, state.center.y);
      ctx.lineTo(state.center.x + 10, state.center.y);
      ctx.moveTo(state.center.x, state.center.y - 10);
      ctx.lineTo(state.center.x, state.center.y + 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  function trackFrame(rafTime) {
    if (!state.tracking || !state.video || !state.canvas || state.video.readyState < 2) {
      state.raf = requestAnimationFrame(trackFrame);
      return;
    }
    const vw = state.video.videoWidth || 960;
    const vh = state.video.videoHeight || 540;
    const targetWidth = Math.min(960, vw);
    const targetHeight = Math.max(1, Math.round(targetWidth * vh / vw));
    if (state.canvas.width !== targetWidth || state.canvas.height !== targetHeight) {
      state.canvas.width = targetWidth;
      state.canvas.height = targetHeight;
      state.center = null;
      state.radius = null;
      state.previousSignature = null;
      state.previousAt = null;
    }
    state.ctx.drawImage(state.video, 0, 0, targetWidth, targetHeight);
    const now = performance.now();
    if (state.center && state.radius && (!state.previousAt || now - state.previousAt >= 110)) {
      try {
        const raw = state.ctx.getImageData(0, 0, targetWidth, targetHeight);
        const signature = sampleSignature(raw, targetWidth, targetHeight);
        if (signature && state.previousSignature && state.previousAt) {
          const delta = now - state.previousAt;
          const comparison = compareSignatures(state.previousSignature, signature, 30);
          if (comparison) recordMotion(comparison, Date.now(), delta);
        } else {
          state.lastMotionQuality = 'CALIBRATING MOTION';
        }
        state.previousSignature = signature;
        state.previousAt = now;
        renderCurrent();
      } catch (e) {
        state.lastMotionQuality = 'FRAME UNREADABLE';
        state.direction = null;
        state.lastError = 'Unable to sample the screen capture. Recalibrate on a visible wheel.';
      }
    }
    paintOverlay();
    state.raf = requestAnimationFrame(trackFrame);
  }

  function canvasClick(event) {
    if (!state.tracking || !state.canvas) return;
    const rect = state.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * state.canvas.width / rect.width;
    const y = (event.clientY - rect.top) * state.canvas.height / rect.height;
    if (!state.center) {
      state.center = {x:x,y:y};
      state.radius = null;
      state.previousSignature = null;
      state.previousAt = null;
      state.lastMotionQuality = 'SET RIM';
      state.lastError = 'Centre selected. Now click one point on the outside rim of the wheel.';
    } else if (!state.radius) {
      const radius = Math.hypot(x - state.center.x, y - state.center.y);
      if (radius < 40) {
        state.lastError = 'The rim point is too close to the centre. Select the outside rim.';
        renderCurrent();
        return;
      }
      state.radius = radius;
      state.previousSignature = null;
      state.previousAt = null;
      state.lastMotionQuality = 'CALIBRATING MOTION';
      state.lastError = 'Wheel circle calibrated. Keep the whole wheel visible and wait for stable motion tracking.';
    } else {
      state.lastError = 'Calibration is set. Use Reset Calibration to select the centre and rim again.';
    }
    renderCurrent();
  }

  function exportCSV() {
    const header = ['roundId','observationTimestamp','generatedAt','direction','referenceIndex','referenceSegment','candidates','actualResult','status','quality','angularVelocityDegPerSec','expectedProbability','reason'];
    const rows = [header].concat(state.history.map(function (r) {
      return [r.roundId,r.observationTimestamp,r.generatedAt,r.direction,r.referenceIndex,r.referenceSegment,
        (r.candidateLabels || []).join('|'),r.actualResult,r.status,r.quality && r.quality.label,
        r.quality && r.quality.angularVelocityDegPerSec,r.expectedProbability,r.reason];
    }));
    const csv = rows.map(function (row) {
      return row.map(function (v) {
        const s = v === null || v === undefined ? '' : String(v);
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'revo-wheel-direction-history.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function connectFirebase() {
    try {
      const appSdk = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
      const dbSdk = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
      const config = {
        apiKey:'AIzaSyDbaFKRqrD976syNij_fSSuIBSPRtR9vbo',
        authDomain:'revofixer-81a1c.firebaseapp.com',
        databaseURL:'https://revofixer-81a1c-default-rtdb.firebaseio.com',
        projectId:'revofixer-81a1c',
        storageBucket:'revofixer-81a1c.appspot.com',
        messagingSenderId:'1049094387124',
        appId:'1:1049094387124:web:864be9cd7ed7c2455caee1'
      };
      const appName = 'revo-wheel-direction-analysis';
      const existing = appSdk.getApps().find(function (a) { return a.name === appName; });
      const app = existing || appSdk.initializeApp(config, appName);
      const db = dbSdk.getDatabase(app);
      dbSdk.onValue(dbSdk.ref(db, 'crazy_results'), function (snapshot) {
        const data = snapshot.val() || {};
        const entries = parseEntries(data);
        const entryMap = new Map(entries.map(function (entry) { return [String(entry.roundId), entry]; }));
        state.latestEntries = entries;
        state.resultsConnected = true;

        if (!state.snapshotInitialized) {
          state.snapshotInitialized = true;
          state.knownIds = new Set(entries.map(function (e) { return String(e.roundId); }));
          if (state.pending && !Array.isArray(state.pending.baselineRoundIds)) {
            // Establish a safe baseline now; rounds already present cannot be assigned to an earlier observation.
            state.pending.baselineRoundIds = Array.from(state.knownIds);
            storePending();
          }
          if (state.pending && Array.isArray(state.pending.baselineRoundIds)) {
            const baseline = new Set(state.pending.baselineRoundIds);
            const recovered = entries.filter(function (e) {
              return !baseline.has(String(e.roundId)) && e.timestamp && e.timestamp >= state.pending.generatedAt;
            });
            if (recovered.length) settlePending(recovered[0], true);
          }
        } else {
          const newcomers = entries.filter(function (e) { return !state.knownIds.has(String(e.roundId)); });
          newcomers.forEach(function (entry) {
            settlePending(entry, false);
            state.knownIds.add(String(entry.roundId));
          });
          entries.forEach(function (entry) { state.knownIds.add(String(entry.roundId)); });
        }

        const ordered = entries.slice().sort(function (a,b) { return (a.timestamp || a.receivedAt) - (b.timestamp || b.receivedAt); });
        if (ordered.length) {
          const current = ordered[ordered.length - 1];
          if (!state.lastConfirmedResult || !hasRoundId(current.roundId) || state.lastConfirmedResult.roundId !== current.roundId) {
            state.lastConfirmedResult = current;
          }
        }
        renderCurrent();
      }, function (error) {
        state.resultsConnected = false;
        setText('waFeedStatus', 'Confirmed result feed error: ' + (error && error.message ? error.message : 'read failed'));
        renderCurrent();
      });
    } catch (e) {
      state.resultsConnected = false;
      setText('waFeedStatus', 'Confirmed result feed unavailable: ' + (e && e.message ? e.message : 'connection failed'));
      renderCurrent();
    }
  }

  function handleExternalConfirmedResult(detail) {
    if (!detail) return;
    const outcome = normalizeOutcome(detail.result || detail.outcome || detail.wheelResult);
    const roundId = detail.roundId || detail.roundID || detail.id;
    if (!outcome || roundId === undefined || roundId === null) return;
    const result = {roundId:String(roundId),outcome:outcome,timestamp:entryTimestamp(detail),receivedAt:Date.now()};
    if (state.pending) settlePending(result, false);
    if (!state.lastConfirmedResult || result.roundId !== state.lastConfirmedResult.roundId) {
      state.lastConfirmedResult = result;
      renderCurrent();
    }
  }

  function init() {
    if (!$('wheelAnalysisPanel')) return;
    loadPersisted();
    const select = $('waReferencePocket');
    if (select) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select the pocket at the fixed pointer…';
      select.appendChild(placeholder);
      WHEEL_ORDER.forEach(function (outcome, index) {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = '#' + index + ' — ' + outcome;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        state.referenceIndex = select.value === '' ? null : Number(select.value);
      });
    }
    if ($('waStartTracking')) $('waStartTracking').addEventListener('click', startTracking);
    if ($('waStopTracking')) $('waStopTracking').addEventListener('click', stopTracking);
    if ($('waResetCalibration')) $('waResetCalibration').addEventListener('click', resetCalibration);
    if ($('waPreviewCanvas')) $('waPreviewCanvas').addEventListener('click', canvasClick);
    if ($('waCaptureObservation')) $('waCaptureObservation').addEventListener('click', captureObservation);
    if ($('waExportCSV')) $('waExportCSV').addEventListener('click', exportCSV);
    window.addEventListener('revo:confirmed-result', function (event) { handleExternalConfirmedResult(event.detail); });
    state.pending = readJSON(STORAGE_PENDING, state.pending);
    const baseline = readJSON(STORAGE_BASELINE, []);
    if (state.pending && !Array.isArray(state.pending.baselineRoundIds) && Array.isArray(baseline) && baseline.length) {
      state.pending.baselineRoundIds = baseline;
    }
    renderCurrent();
    connectFirebase();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
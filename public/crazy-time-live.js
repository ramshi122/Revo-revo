/* REVO FIXER — CasinoScores live results and automatic next estimate.
 * This displays only results returned by the backend; it never fabricates a live outcome.
 * Every new observed result refreshes a descriptive frequency-based estimate, not a guarantee.
 */
(function () {
  'use strict';
  var SOURCE_URL = 'https://www.casino.org/casinoscores/crazy-time/';
  var lastKey = '';
  var pollBusy = false;
  var timer = null;
  var OUTCOMES = ['1','2','5','10','Coin Flip','Pachinko','Cash Hunt','Crazy Time'];
  var WHEEL_COUNTS = {'1':21,'2':13,'5':7,'10':4,'Coin Flip':4,'Pachinko':2,'Cash Hunt':2,'Crazy Time':1};
  var history = [];
  function el(id) { return document.getElementById(id); }
  function safeText(id, value) { var node = el(id); if (node) node.textContent = value; }
  function makePanel() {
    if (el('ctLivePanel')) return;
    var panel = document.createElement('section');
    panel.id = 'ctLivePanel';
    panel.style.cssText = 'margin:0 auto 18px;max-width:400px;padding:16px;background:#10131d;color:#fff;border:1px solid rgba(255,215,0,.45);border-radius:16px;font-family:Arial,sans-serif;';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong style="color:#FFD700">CRAZY TIME · LIVE RESULTS</strong><span id="ctLiveStatus" style="font-size:11px;color:#aaa">Connecting…</span></div>' +
      '<div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div style="padding:12px;background:#1b2030;border-radius:10px"><small style="color:#aaa">LATEST CONFIRMED RESULT</small><div id="ctLatestOutcome" style="font-size:24px;font-weight:900;color:#fff;margin-top:4px">—</div><small id="ctLatestMeta" style="color:#aaa">Waiting for source data</small></div>' +
      '<div style="padding:12px;background:#1b2030;border-radius:10px"><small style="color:#aaa">NEXT ESTIMATE</small><div id="ctNextEstimate" style="font-size:24px;font-weight:900;color:#FFD700;margin-top:4px">—</div><small id="ctEstimateMeta" style="color:#aaa">No verified history yet</small></div></div>' +
      '<div style="margin-top:10px;font-size:11px;color:#aaa">Source: CasinoScores · <a href="' + SOURCE_URL + '" target="_blank" rel="noopener" style="color:#69d7d0">Open source</a>. Estimates describe historical frequency only; they cannot predict a random spin.</div>';
    var signal = document.querySelector('.signal-container');
    if (signal && signal.parentNode) signal.parentNode.insertBefore(panel, signal);
    else document.body.insertBefore(panel, document.body.firstChild);
  }
  function normalize(value) {
    var s = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['1','1x'].indexOf(s) >= 0) return '1';
    if (['2','2x'].indexOf(s) >= 0) return '2';
    if (['5','5x'].indexOf(s) >= 0) return '5';
    if (['10','10x'].indexOf(s) >= 0) return '10';
    if (s.indexOf('coinflip') >= 0) return 'Coin Flip';
    if (s.indexOf('pachinko') >= 0) return 'Pachinko';
    if (s.indexOf('cashhunt') >= 0) return 'Cash Hunt';
    if (s.indexOf('crazytime') >= 0 || s.indexOf('crazybonus') >= 0) return 'Crazy Time';
    return null;
  }
  function estimateNext() {
    if (!history.length) return;
    // Laplace smoothing toward the wheel's known pocket distribution. This is a
    // descriptive baseline only, not a claim that previous outcomes predict a spin.
    var counts = Object.assign({}, WHEEL_COUNTS);
    history.slice(-50).forEach(function (r) { if (counts[r.outcome] !== undefined) counts[r.outcome] += 1; });
    var total = Object.keys(counts).reduce(function (sum, key) { return sum + counts[key]; }, 0);
    var best = OUTCOMES[0];
    OUTCOMES.forEach(function (outcome) {
      if (counts[outcome] / total > counts[best] / total) best = outcome;
    });
    safeText('ctNextEstimate', best);
    safeText('ctEstimateMeta', 'Baseline estimate · ' + Math.min(history.length, 50) + ' recent results + wheel layout');
  }
  function render(data) {
    if (!data || !Array.isArray(data.results) || !data.results.length) {
      safeText('ctLiveStatus', 'SOURCE DATA UNAVAILABLE');
      safeText('ctLatestMeta', data && data.message ? data.message : 'No confirmed results returned');
      return;
    }
    var ordered = data.results.slice().reverse();
    history = ordered.filter(function (r) { return !!normalize(r.outcome); }).map(function (r) {
      return {roundId:String(r.roundId || ''), outcome:normalize(r.outcome), timestamp:r.timestamp || null};
    });
    var latest = data.latest || data.results[0];
    var outcome = normalize(latest.outcome);
    var key = String(latest.roundId || latest.timestamp || (outcome + ':' + (latest.label || '')));
    safeText('ctLiveStatus', data.cached ? 'Connected · cached' : 'Connected · checked now');
    safeText('ctLatestOutcome', outcome || 'Unverified');
    safeText('ctLatestMeta', (latest.timestamp ? new Date(latest.timestamp).toLocaleString() : 'Source time unavailable') + (latest.roundId ? ' · Round ' + latest.roundId : ''));
    estimateNext();
    if (key && key !== lastKey) {
      lastKey = key;
      // Update the existing Signal Card automatically only after a new source result
      // is detected. No fabricated accuracy/confidence percentage is shown.
      var signal = document.querySelector('.signal-container');
      if (signal && outcome) {
        var number = el('signalNumber');
        var icon = el('signalIcon');
        var conf = el('confidenceText');
        var fill = el('confidenceFill');
        var source = el('dataSrcText');
        if (number && icon) {
          var cls = {'1':'signal-1','2':'signal-2','5':'signal-5','10':'signal-10','Coin Flip':'signal-coinflip','Pachinko':'signal-pachinko','Cash Hunt':'signal-cashunt','Crazy Time':'signal-crazytime'}[document.getElementById('ctNextEstimate').textContent] || 'signal-1';
          icon.className = 'signal-icon ' + cls;
          number.textContent = document.getElementById('ctNextEstimate').textContent || '?';
          number.style.fontSize = outcome.length > 4 ? '14px' : '56px';
          if (conf) conf.textContent = 'Next estimate from verified feed history — not a guaranteed prediction';
          if (fill) fill.style.width = '0%';
          if (source) source.textContent = 'Latest result updated from CasinoScores · new round detected';
        }
      }
    }
  }
  function poll() {
    if (pollBusy || document.hidden) return;
    pollBusy = true;
    fetch('/api/crazy-time/results', {cache:'no-store'})
      .then(function (response) { if (!response.ok) return response.json().then(function (d) { throw new Error(d.error || response.status); }); return response.json(); })
      .then(render)
      .catch(function (error) { safeText('ctLiveStatus', 'Feed error'); safeText('ctLatestMeta', error.message || 'Could not fetch live results'); })
      .finally(function () { pollBusy = false; });
  }
  function start() {
    makePanel();
    poll();
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 20000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();

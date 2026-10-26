/**
 * REVO FIXER - Secure Backend Proxy Server
 * ==========================================
 * Proxies all API calls securely server-side.
 * API keys stay in .env — never exposed to browser.
 *
 * Deploy: Node 18+, run `npm install` then `node server.js`
 * Vercel:  rename to api/ folder (see README)
 * Render:  set environment variables in dashboard
 */

const express    = require('express');
const cors       = require('cors');
const NodeCache  = require('node-cache');
const rateLimit  = require('express-rate-limit');
const morgan     = require('morgan');
const fetch      = require('node-fetch');
require('dotenv').config();

const app   = express();
const cache = new NodeCache({ stdTTL: 45, checkperiod: 30 });

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan(':date[iso] :method :url :status :response-time ms'));

// Serve frontend from /public
app.use(express.static('public'));

// ─── RATE LIMITERS ───────────────────────────────────────────
const limiterGeneral = rateLimit({ windowMs: 60_000, max: 60,  message: { error: 'Too many requests' } });
const limiterAI      = rateLimit({ windowMs: 60_000, max: 20,  message: { error: 'AI rate limit' } });
app.use('/api/', limiterGeneral);
app.use('/api/openai', limiterAI);
app.use('/api/gemini', limiterAI);
app.use('/api/claude', limiterAI);

// ─── HELPERS ─────────────────────────────────────────────────
const ENV = {
  CT_KEY:   process.env.CT_RAPIDAPI_KEY   || '',
  WS_KEY:   process.env.WS_RAPIDAPI_KEY   || '',
  GPT_KEY:  process.env.GPT_RAPIDAPI_KEY  || '',
  SC_KEY:   process.env.SC_RAPIDAPI_KEY   || '',
  OAI_KEY:  process.env.OPENAI_KEY        || '',
  GEM_KEY:  process.env.GEMINI_KEY        || '',
  ANT_KEY:  process.env.ANTHROPIC_KEY     || '',
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

// Quick fetch with timeout
async function apiFetch(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ─── STATUS ENDPOINT ─────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    ok:      true,
    engines: {
      ct:  !!ENV.CT_KEY,
      ws:  !!ENV.WS_KEY,
      gpt: !!ENV.GPT_KEY,
      sc:  !!ENV.SC_KEY,
      oai: !!ENV.OAI_KEY,
      gem: !!ENV.GEM_KEY,
      ant: !!ENV.ANT_KEY,
    },
    cacheKeys: cache.keys().length,
    uptime:    Math.round(process.uptime()) + 's',
  });
});

// ─── CT RAPIDAPI ─────────────────────────────────────────────
app.get('/api/ct-live', async (req, res) => {
  if (!ENV.CT_KEY) return res.status(503).json({ error: 'CT key not configured' });
  const cKey = 'ct_live';
  const hit  = cache.get(cKey);
  if (hit) { log('CT', 'cache hit'); return res.json({ ...hit, cached: true }); }

  try {
    const r = await apiFetch('https://crazytime.p.rapidapi.com/stat', {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'crazytime.p.rapidapi.com',
        'x-rapidapi-key':  ENV.CT_KEY,
      },
    }, 9000);
    const data = await r.json();
    if (data && data.aggStats) {
      cache.set(cKey, data, 45);
      log('CT', `fetched ${data.aggStats.length} segments`);
    }
    res.json(data);
  } catch (e) {
    log('CT', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

// ─── WEB SEARCH RAPIDAPI ─────────────────────────────────────
app.get('/api/websearch', async (req, res) => {
  if (!ENV.WS_KEY) return res.status(503).json({ error: 'WS key not configured' });
  const q    = req.query.q || 'Crazy Time live results today hot bonus overdue';
  const cKey = 'ws_' + q.slice(0, 30);
  const hit  = cache.get(cKey);
  if (hit) return res.json({ ...hit, cached: true });

  try {
    const url = `https://real-time-web-search.p.rapidapi.com/search?q=${encodeURIComponent(q)}&num=5`;
    const r   = await apiFetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'real-time-web-search.p.rapidapi.com',
        'x-rapidapi-key':  ENV.WS_KEY,
      },
    }, 8000);
    const data = await r.json();
    cache.set(cKey, data, 120);
    log('WS', 'fetched search results');
    res.json(data);
  } catch (e) {
    log('WS', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

// ─── GPT RAPIDAPI ────────────────────────────────────────────
app.post('/api/gpt-rapid', async (req, res) => {
  if (!ENV.GPT_KEY) return res.status(503).json({ error: 'GPT RapidAPI key not configured' });
  const { prompt } = req.body || {};
  if (!prompt)     return res.status(400).json({ error: 'prompt required' });

  try {
    const r = await apiFetch('https://chat-gpt26.p.rapidapi.com/', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-rapidapi-host': 'chat-gpt26.p.rapidapi.com',
        'x-rapidapi-key':  ENV.GPT_KEY,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] }),
    }, 12000);
    const data = await r.json();
    log('GPT-RAP', 'response received');
    res.json(data);
  } catch (e) {
    log('GPT-RAP', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

// ─── AI WEB SCRAPER RAPIDAPI ─────────────────────────────────
app.post('/api/scraper', async (req, res) => {
  if (!ENV.SC_KEY) return res.status(503).json({ error: 'Scraper key not configured' });
  const cKey = 'csq_scrape';
  const hit  = cache.get(cKey);
  if (hit) { log('SC', 'cache hit'); return res.json({ ...hit, cached: true }); }

  const body = {
    url:    'https://casinosquad.com/stats/crazy-time',
    prompt: 'Extract Crazy Time stats. Return ONLY JSON: {totalRounds24h:number,bonusRatePercent:number,segments:[{name,percentage,lastSeenRounds,hotScore}]}. Names: 1,2,5,10,Pachinko,CashHunt,CoinFlip,CrazyBonus.',
  };
  try {
    const r = await apiFetch('https://ai-web-scraper1.p.rapidapi.com/', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-rapidapi-host': 'ai-web-scraper1.p.rapidapi.com',
        'x-rapidapi-key':  ENV.SC_KEY,
      },
      body: JSON.stringify(body),
    }, 20000);
    const data = await r.json();
    cache.set(cKey, data, 90);
    log('SC', 'scraped CasinoSquad');
    res.json(data);
  } catch (e) {
    log('SC', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

// ─── OPENAI GPT-4o ───────────────────────────────────────────
app.post('/api/openai', async (req, res) => {
  if (!ENV.OAI_KEY) return res.status(503).json({ error: 'OpenAI key not configured' });
  const { prompt } = req.body || {};
  if (!prompt)      return res.status(400).json({ error: 'prompt required' });

  try {
    const r = await apiFetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + ENV.OAI_KEY,
      },
      body: JSON.stringify({
        model:      'gpt-4o',
        max_tokens: 15,
        messages:   [{ role: 'user', content: prompt }],
      }),
    }, 13000);
    const data = await r.json();
    log('OAI', 'GPT-4o responded');
    res.json(data);
  } catch (e) {
    log('OAI', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

// ─── GOOGLE GEMINI ───────────────────────────────────────────
app.post('/api/gemini', async (req, res) => {
  if (!ENV.GEM_KEY) return res.status(503).json({ error: 'Gemini key not configured' });
  const { prompt } = req.body || {};
  if (!prompt)      return res.status(400).json({ error: 'prompt required' });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${ENV.GEM_KEY}`;
    const r   = await apiFetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }, 13000);
    const data = await r.json();
    log('GEM', 'Gemini responded');
    res.json(data);
  } catch (e) {
    log('GEM', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});

// ─── ANTHROPIC CLAUDE ────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  if (!ENV.ANT_KEY) return res.status(503).json({ error: 'Anthropic key not configured' });
  const { prompt } = req.body || {};
  if (!prompt)      return res.status(400).json({ error: 'prompt required' });

  try {
    const r = await apiFetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ENV.ANT_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 15,
        messages:   [{ role: 'user', content: prompt }],
      }),
    }, 15000);
    const data = await r.json();
    log('ANT', 'Claude responded');
    res.json(data);
  } catch (e) {
    log('ANT', 'ERROR: ' + e.message);
    res.status(502).json({ error: e.message });
  }
});



// ─── CASINOSCORES CRAZY TIME RESULT FEED ─────────────────────
// Public page scraper only. If the page markup does not expose a
// confirmed outcome, return an explicit empty feed rather than inventing one.
function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}
function plainText(value) {
  return decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function normalizeCTOutcome(value) {
  const s = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s === '1' || s === '1x') return '1';
  if (s === '2' || s === '2x') return '2';
  if (s === '5' || s === '5x') return '5';
  if (s === '10' || s === '10x') return '10';
  if (s.includes('coinflip')) return 'Coin Flip';
  if (s.includes('pachinko')) return 'Pachinko';
  if (s.includes('cashhunt')) return 'Cash Hunt';
  if (s.includes('crazytime') || s.includes('crazybonus')) return 'Crazy Time';
  return null;
}
function extractCasinoScoresResults(html) {
  const results = [];
  const seen = new Set();
  const rows = String(html || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    if (cells.length < 3) continue;
    const cellInfo = cells.map(cell => {
      const attrs = (cell.match(/\b(?:alt|aria-label|title|data-result|data-outcome|datetime|data-time)\s*=\s*["'][^"']*["']/gi) || [])
        .map(x => x.replace(/^[^=]+=\s*["']|["']$/g, ''));
      return { text: plainText(cell), attrs, html: cell };
    });
    const combined = cellInfo.map(c => c.text + ' ' + c.attrs.join(' ')).join(' | ');
    if (/finished\s*\|\s*slot result/i.test(combined) || /spin history|multiplier\s+payout/i.test(combined)) continue;

    // CasinoScores table columns are: Finished, Slot Result, Spin Result, Multiplier, Payout.
    // Never read the Top Slot column as the winning wheel outcome.
    const spinCell = cellInfo[2];
    const multiplierCell = cellInfo[3];
    const candidates = [];
    if (spinCell) candidates.push(spinCell.attrs.join(' '), spinCell.text);
    if (multiplierCell) candidates.push(multiplierCell.attrs.join(' '), multiplierCell.text);

    let outcome = null;
    for (const candidate of candidates) {
      const normalized = normalizeCTOutcome(candidate);
      if (normalized) { outcome = normalized; break; }
      const m = String(candidate || '').match(/(?:^|\D)(10|5|2|1)\s*x?(?:\D|$)/i);
      if (m) { outcome = normalizeCTOutcome(m[1]); break; }
    }
    if (!outcome) continue;

    const timeText = cellInfo[0] ? cellInfo[0].text : '';
    const idMatch = row.match(/\b(?:data-round-id|data-roundid|data-id|id)\s*=\s*["']([^"']+)["']/i);
    const timeMatch = row.match(/\b(?:datetime|data-time)\s*=\s*["']([^"']+)["']/i);
    let timestamp = timeMatch ? Date.parse(timeMatch[1]) : NaN;
    if (!Number.isFinite(timestamp)) {
      const parsed = timeText.match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{1,2}:\d{2})/);
      if (parsed) timestamp = Date.parse(parsed[1] + ' ' + new Date().getUTCFullYear() + ' UTC');
    }
    const roundId = idMatch ? idMatch[1] : null;
    const key = String(roundId || (Number.isFinite(timestamp) ? timestamp : timeText) || (outcome + ':' + results.length));
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      roundId: roundId || key,
      outcome,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      label: timeText.slice(0, 100),
      source: 'CasinoScores'
    });
  }
  return results.slice(0, 30);
}
app.get('/api/crazy-time/results', async (req, res) => {
  const cacheKey = 'casinoscores_crazy_time_results';
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });
  try {
    const response = await apiFetch('https://www.casino.org/casinoscores/crazy-time/', {
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; RevoFixerResultReader/1.0)',
        'accept': 'text/html,application/xhtml+xml'
      }
    }, 12000);
    if (!response.ok) return res.status(502).json({ error: 'CasinoScores returned HTTP ' + response.status, source: 'CasinoScores', results: [] });
    const html = await response.text();
    const results = extractCasinoScoresResults(html);
    const payload = {
      ok: results.length > 0,
      source: 'CasinoScores',
      sourceUrl: 'https://www.casino.org/casinoscores/crazy-time/',
      fetchedAt: new Date().toISOString(),
      latest: results[0] || null,
      results,
      message: results.length ? 'Parsed results from public page markup' : 'No confirmed result rows were exposed in the public page HTML; live data is not guessed'
    };
    if (results.length) cache.set(cacheKey, payload, 15);
    log('CASINOSCORES', results.length ? ('parsed ' + results.length + ' result rows') : 'no parseable result rows in page HTML');
    res.json(payload);
  } catch (e) {
    log('CASINOSCORES', 'ERROR: ' + e.message);
    res.status(502).json({ error: 'CasinoScores fetch failed: ' + e.message, source: 'CasinoScores', results: [] });
  }
});

// ─── HEALTH ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));
// --- ROOT (INDEX PAGE)
app.get("/", (req, res) => {
  res.sendFile(require("path").join(__dirname, "public", "index.html"));
});
// ─── START ───────────────────────────────────────────────────
// ─────────────────────────────────────────────
// MASTER SIMPLE PREDICTION (BUTTON വേണ്ടി)
// ─────────────────────────────────────────────
app.get('/api/predict', async (req, res) => {
  const feed = cache.get('casinoscores_crazy_time_results');
  const results = feed && Array.isArray(feed.results) ? feed.results : [];
  if (!results.length) {
    return res.status(503).json({
      ok: false,
      error: 'No verified CasinoScores results are cached yet. Load /api/crazy-time/results first.',
      source: 'CasinoScores'
    });
  }

  const outcomes = ['1','2','5','10','Coin Flip','Pachinko','Cash Hunt','Crazy Time'];
  const wheelCounts = {'1':21,'2':13,'5':7,'10':4,'Coin Flip':4,'Pachinko':2,'Cash Hunt':2,'Crazy Time':1};
  const counts = Object.assign({}, wheelCounts);
  results.slice(0, 30).forEach(item => {
    const outcome = normalizeCTOutcome(item.outcome);
    if (outcome && counts[outcome] !== undefined) counts[outcome] += 1;
  });
  const signal = outcomes.reduce((best, current) =>
    counts[current] > counts[best] ? current : best, outcomes[0]);
  return res.json({
    ok: true,
    signal,
    confidence: null,
    basis: 'Descriptive wheel-frequency baseline plus the latest verified CasinoScores sample',
    source: 'CasinoScores',
    sourceTimestamp: feed.fetchedAt || null,
    sampleSize: results.length,
    disclaimer: 'This is not a reliable prediction. Crazy Time outcomes are random and past results do not determine the next spin.'
  });
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("==================================");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("==================================");
});

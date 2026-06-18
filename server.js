// ═══════════════════════════════════════════════════
// Super Picks Trading — Express Server
// superpickstrading.com
// ═══════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const { runScan } = require('./scanner');
const { runAlphaScan } = require('./alpha-scanner');
const { runFundamentalsScan } = require('./fundamentals-scanner');
const { computeSentiment } = require('./sentiment');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'sp-dev-key-change-me';

// ── JSON File Database (no native deps — works on Render free tier) ──
const DB_PATH = path.join(__dirname, 'data');
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });

function loadJSON(file, fallback) {
  const fp = path.join(DB_PATH, file);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(path.join(DB_PATH, file), JSON.stringify(data, null, 2));
}

// Data stores
let picks = loadJSON('picks.json', []);
let history = loadJSON('history.json', []);
let scanLogs = loadJSON('scanlogs.json', []);
let alpha = loadJSON('alpha.json', []);
let alphaHistory = loadJSON('alpha-history.json', []);
let fundamentals = loadJSON('fundamentals.json', []);
let nextId = loadJSON('nextid.json', { pick: 1, hist: 1, alpha: 1 });

function persist() {
  saveJSON('picks.json', picks);
  saveJSON('history.json', history);
  saveJSON('scanlogs.json', scanLogs);
  saveJSON('alpha.json', alpha);
  saveJSON('alpha-history.json', alphaHistory);
  saveJSON('fundamentals.json', fundamentals);
  saveJSON('nextid.json', nextId);
}

// ── Middleware ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (key !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

// ═══════════════════════════════════════════════════
// PUBLIC READ ENDPOINTS
// ═══════════════════════════════════════════════════

// GET /api/picks — Current live picks
app.get('/api/picks', (req, res) => {
  const sorted = [...picks].sort((a, b) => b.composite_score - a.composite_score);
  res.json({ timestamp: new Date().toISOString(), count: sorted.length, picks: sorted });
});

// GET /api/signals — Trading signals for bots / Robinhood
app.get('/api/signals', (req, res) => {
  const sorted = [...picks].sort((a, b) => b.composite_score - a.composite_score);
  const signals = sorted.map((p) => ({
    symbol: p.symbol,
    action: p.composite_score >= 6 ? 'STRONG_BUY' : p.composite_score >= 2 ? 'BUY' : 'HOLD',
    signal: p.overall_signal,
    score: p.composite_score,
    price: p.price,
    change_pct: p.daily_change,
    confidence: Math.min(1, Math.max(0, (p.composite_score + 10) / 20)),
    updated: p.updated_at,
  }));
  res.json({ timestamp: new Date().toISOString(), market_open: isMarketOpen(), count: signals.length, signals });
});

// GET /api/history — Historical performance
app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const status = req.query.status || 'all';
  let filtered = status === 'all' ? history : history.filter((h) => h.status === status);
  filtered = filtered.sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date)).slice(0, limit);
  res.json({ timestamp: new Date().toISOString(), count: filtered.length, history: filtered });
});

// GET /api/stats — Overall performance statistics
app.get('/api/stats', (req, res) => {
  const closed = history.filter((h) => h.status === 'closed');
  const active = history.filter((h) => h.status === 'active');

  const winners = closed.filter((h) => h.return_pct > 0).length;
  const losers = closed.length - winners;
  const avgReturn = closed.length > 0 ? closed.reduce((s, h) => s + h.return_pct, 0) / closed.length : 0;
  const bestTrade = closed.length > 0 ? Math.max(...closed.map((h) => h.return_pct)) : 0;
  const worstTrade = closed.length > 0 ? Math.min(...closed.map((h) => h.return_pct)) : 0;
  const winReturns = closed.filter((h) => h.return_pct > 0);
  const lossReturns = closed.filter((h) => h.return_pct <= 0);
  const avgWin = winReturns.length > 0 ? winReturns.reduce((s, h) => s + h.return_pct, 0) / winReturns.length : 0;
  const avgLoss = lossReturns.length > 0 ? lossReturns.reduce((s, h) => s + h.return_pct, 0) / lossReturns.length : 0;
  const bestPeak = history.length > 0 ? Math.max(0, ...history.map((h) => h.peak_return_pct || 0)) : 0;
  const winRate = closed.length > 0 ? parseFloat(((winners / closed.length) * 100).toFixed(1)) : 0;

  const avgScore = picks.length > 0 ? r2(picks.reduce((s, p) => s + p.composite_score, 0) / picks.length) : 0;

  res.json({
    current: { picks_count: picks.length, avg_score: avgScore },
    performance: {
      total_trades: closed.length, winners, losers, win_rate: winRate,
      avg_return: r2(avgReturn), best_trade: r2(bestTrade), worst_trade: r2(worstTrade),
      avg_win: r2(avgWin), avg_loss: r2(avgLoss), best_peak: r2(bestPeak),
    },
    active_positions: active.length,
    recent_scans: scanLogs.slice(-10).reverse(),
  });
});

// GET /api/alpha — Alpha Engine smart money picks
app.get('/api/alpha', (req, res) => {
  res.json({ timestamp: new Date().toISOString(), count: alpha.length, picks: alpha });
});

// GET /api/fundamentals — Long-term fundamentals scores
app.get('/api/fundamentals', (req, res) => {
  res.json({ timestamp: new Date().toISOString(), count: fundamentals.length, stocks: fundamentals });
});

// GET /api/sentiment — Market sentiment gauge
app.get('/api/sentiment', async (req, res) => {
  try {
    const data = await computeSentiment();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(),
    data: {
      picks: picks.length, alpha: alpha.length, fundamentals: fundamentals.length,
      history: history.length,
    },
  });
});

// ═══════════════════════════════════════════════════
// AUTHENTICATED WRITE ENDPOINTS (from Expo app)
// ═══════════════════════════════════════════════════

// POST /api/picks — Push new picks from the app
app.post('/api/picks', requireApiKey, (req, res) => {
  const { picks: newPicks, scanMeta } = req.body;
  if (!Array.isArray(newPicks) || newPicks.length === 0) {
    return res.status(400).json({ error: 'picks must be a non-empty array' });
  }

  const batchId = `scan_${Date.now()}`;
  const now = new Date().toISOString();

  // Build map of currently active history entries
  const activeMap = {};
  history.filter((h) => h.status === 'active').forEach((h) => { activeMap[h.symbol] = h; });

  const newSymbols = new Set(newPicks.map((p) => p.symbol));

  // Replace current picks
  picks = newPicks.map((p) => ({
    id: nextId.pick++,
    symbol: p.symbol || '',
    name: p.name || p.symbol || '',
    composite_score: p.compositeScore || 0,
    overall_signal: p.overallSignal || 'Neutral',
    price: p.price || 0,
    daily_change: p.dailyChange || 0,
    momentum_score: p.indicators?.momentum?.score || 0,
    momentum_label: p.indicators?.momentum?.label || '',
    macd_score: p.indicators?.macd?.score || 0,
    macd_label: p.indicators?.macd?.label || '',
    sma_score: p.indicators?.sma?.score || 0,
    sma_label: p.indicators?.sma?.label || '',
    stoch_score: p.indicators?.stochastic?.score || 0,
    stoch_label: p.indicators?.stochastic?.label || '',
    volume_score: p.indicators?.volume?.score || 0,
    volume_label: p.indicators?.volume?.label || '',
    cci_score: p.indicators?.cci?.score || 0,
    cci_label: p.indicators?.cci?.label || '',
    willr_score: p.indicators?.williamsR?.score || 0,
    willr_label: p.indicators?.williamsR?.label || '',
    rsi_value: p.indicators?.rsi?.value || 0,
    updated_at: now,
  }));

  // Add new symbols to history
  for (const p of newPicks) {
    if (!activeMap[p.symbol]) {
      history.push({
        id: nextId.hist++,
        symbol: p.symbol,
        name: p.name || p.symbol,
        composite_score: p.compositeScore || 0,
        overall_signal: p.overallSignal || 'Neutral',
        entry_price: p.price || 0,
        entry_date: now,
        exit_price: 0,
        exit_date: null,
        return_pct: 0,
        peak_price: p.price || 0,
        peak_return_pct: 0,
        status: 'active',
        scan_batch: batchId,
      });
    }
  }

  // Close picks that dropped off
  let closedCount = 0;
  for (const sym of Object.keys(activeMap)) {
    if (!newSymbols.has(sym)) {
      const h = history.find((x) => x.symbol === sym && x.status === 'active');
      if (h) {
        h.status = 'closed';
        h.exit_price = h.peak_price || h.entry_price;
        h.exit_date = now;
        h.return_pct = h.entry_price > 0 ? ((h.exit_price - h.entry_price) / h.entry_price) * 100 : 0;
        closedCount++;
      }
    }
  }

  // Log scan
  const avgScore = newPicks.reduce((s, p) => s + (p.compositeScore || 0), 0) / newPicks.length;
  scanLogs.push({
    batch_id: batchId,
    total_scanned: scanMeta?.totalScanned || 0,
    picks_found: newPicks.length,
    avg_score: r2(avgScore),
    scan_time_ms: scanMeta?.scanTimeMs || 0,
    created_at: now,
  });
  if (scanLogs.length > 100) scanLogs = scanLogs.slice(-100);

  persist();

  console.log(`[API] Received ${newPicks.length} picks (batch: ${batchId})`);
  res.json({ success: true, batch_id: batchId, picks_count: newPicks.length, closed_count: closedCount });
});

// POST /api/picks/:symbol/update-price
app.post('/api/picks/:symbol/update-price', requireApiKey, (req, res) => {
  const { symbol } = req.params;
  const { price } = req.body;
  if (!price || price <= 0) return res.status(400).json({ error: 'Valid price required' });

  const active = history.find((h) => h.symbol === symbol && h.status === 'active');
  if (!active) return res.status(404).json({ error: 'No active pick for this symbol' });

  active.peak_price = Math.max(active.peak_price || 0, price);
  active.peak_return_pct = active.entry_price > 0
    ? ((active.peak_price - active.entry_price) / active.entry_price) * 100 : 0;

  const pick = picks.find((p) => p.symbol === symbol);
  if (pick) { pick.price = price; pick.updated_at = new Date().toISOString(); }

  persist();
  res.json({ success: true, symbol, price, peak_price: active.peak_price });
});

// ═══════════════════════════════════════════════════
// SCANNER — runs TA on server, no app needed
// ═══════════════════════════════════════════════════

// GET /api/scan — trigger a scan manually
app.get('/api/scan', requireApiKey, async (req, res) => {
  try {
    const result = await runScan(
      () => ({ picks, history, scanLogs, nextId }),
      persist
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let scanning = false;
async function autoScan() {
  if (scanning) return;
  scanning = true;
  try {
    // Run all scanners in sequence (to avoid overloading Yahoo)
    console.log('\n[AutoScan] Starting full scan...');
    await runScan(() => ({ picks, history, scanLogs, nextId }), persist);
    await runAlphaScan(() => ({ alpha, alphaHistory, nextId }), persist);
    await runFundamentalsScan(() => ({ fundamentals, nextId }), persist);
    console.log('[AutoScan] All scans complete.\n');
  } catch (err) {
    console.error('[AutoScan] Error:', err.message);
  }
  scanning = false;
}

// ═══════════════════════════════════════════════════
// Serve frontend
// ═══════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Helpers ──
function r2(v) { return v != null ? Math.round(v * 100) / 100 : 0; }

function isMarketOpen() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const t = ny.getHours() * 60 + ny.getMinutes();
  return day >= 1 && day <= 5 && t >= 570 && t < 960;
}

// ── Start server ──
app.listen(PORT, () => {
  console.log(`\n  Super Picks Trading Server`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Signals:    http://localhost:${PORT}/api/signals`);
  console.log(`  Picks: ${picks.length} | History: ${history.length}\n`);

  // Run first scan 5 seconds after startup
  setTimeout(autoScan, 5000);

  // Re-scan every 15 minutes
  setInterval(autoScan, 15 * 60 * 1000);
});

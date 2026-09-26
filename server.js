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
const { runFundamentalsScan } = require('./fundamentals-scanner');
const { computeSentiment } = require('./sentiment');
const { runSectorScan, startSectorSchedulers, sectorStatus } = require('./sector-scanner');
const sectorMap = require('./engines/sectorMap');
const screener = require('./engines/screenerService');
const { createStore, seedFromFiles } = require('./engines/store');
const { buildPnL, toCSV } = require('./engines/pnl');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'sp-dev-key-change-me';

// ── Persistence ──
//
// Postgres when DATABASE_URL is set, JSON files otherwise. Render's free tier
// wipes the container filesystem on every deploy, so on the JSON path the
// forward-recorded history does not survive a redeploy — see engines/store.js.
const DB_PATH = path.join(__dirname, 'data');
const store = createStore({ dir: DB_PATH, databaseUrl: process.env.DATABASE_URL });

// In-memory working copies. Every route and scanner reads and mutates these
// exactly as before; the store only decides where they are read from at boot
// and written to afterwards.
let picks = [];
let history = [];
let scanLogs = [];
let alpha = [];              // retired with Unusual Whales; kept so /api/health reads
let fundamentals = [];
// Sector rotation, keyed by asset class: { equity: {...}, crypto: {...} }.
let sectors = {};
let nextId = { pick: 1, hist: 1, alpha: 1 };

async function loadAll() {
  await store.init();
  await seedFromFiles(store, DB_PATH);
  picks = await store.load('picks', []);
  history = await store.load('history', []);
  scanLogs = await store.load('scanlogs', []);
  fundamentals = await store.load('fundamentals', []);
  sectors = await store.load('sectors', {});
  nextId = await store.load('nextid', { pick: 1, hist: 1, alpha: 1 });
}

// persist() is called from synchronous code all over the scanners, so it stays
// synchronous in signature and schedules the write. Writes are coalesced: a
// scan calls this repeatedly and one round trip per burst is plenty.
let writeTimer = null;
let writing = false;
let dirty = false;

async function flush() {
  if (writing) { dirty = true; return; }
  writing = true;
  try {
    await Promise.all([
      store.save('picks', picks),
      store.save('history', history),
      store.save('scanlogs', scanLogs),
      store.save('fundamentals', fundamentals),
      store.save('sectors', sectors),
      store.save('nextid', nextId),
    ]);
  } catch (err) {
    // A failed write must not take the scan down with it — the in-memory copy
    // is still correct and the next persist() will try again.
    console.error('[Store] Write failed:', err.message);
  }
  writing = false;
  if (dirty) { dirty = false; flush(); }
}

function persist() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 250);
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
//
// Only rows written by the corrected bookkeeping are counted. Anything
// closed by the old code was closed at its peak price, so its return could
// not be negative; averaging those together with honest rows would produce a
// number that looks like performance and isn't. They are reported separately
// as `excluded_legacy` rather than silently dropped.
app.get('/api/stats', (req, res) => {
  const MEASURED = 2;
  const measured = history.filter((h) => h.measurement_version >= MEASURED);
  const legacy = history.filter((h) => !(h.measurement_version >= MEASURED));

  const closed = measured.filter((h) => h.status === 'closed' && h.return_pct != null);
  const active = measured.filter((h) => h.status === 'active');

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const rets = closed.map((h) => h.return_pct);

  // Every closed trade that has a SPY leg, so "did this beat holding the
  // index" is answerable over exactly the windows the signals were open.
  const benched = closed.filter((h) => h.excess_return_pct != null);
  const excess = benched.map((h) => h.excess_return_pct);
  const benchRets = benched.map((h) => h.bench_return_pct);

  const winners = closed.filter((h) => h.return_pct > 0).length;
  const beatBench = benched.filter((h) => h.excess_return_pct > 0).length;
  const stoppedOut = closed.filter((h) => h.exit_reason === 'stopped-out').length;

  const pct = (n, d) => (d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null);
  const avgScore = picks.length > 0 ? r2(picks.reduce((s, p) => s + p.composite_score, 0) / picks.length) : 0;

  res.json({
    current: { picks_count: picks.length, avg_score: avgScore },
    performance: {
      total_trades: closed.length,
      winners,
      losers: closed.length - winners,
      // Null rather than 0 when nothing has closed yet: an empty record is
      // not a 0% win rate, and showing one invites reading noise as a result.
      win_rate: pct(winners, closed.length),
      avg_return: closed.length ? r2(mean(rets)) : null,
      best_trade: closed.length ? r2(Math.max(...rets)) : null,
      worst_trade: closed.length ? r2(Math.min(...rets)) : null,
      avg_win: r2(mean(rets.filter((r) => r > 0))),
      avg_loss: r2(mean(rets.filter((r) => r <= 0))),
      stopped_out: stoppedOut,
    },
    // The comparison that makes the numbers above mean something.
    vs_benchmark: {
      symbol: 'SPY',
      trades_with_benchmark: benched.length,
      spy_avg_return: benched.length ? r2(mean(benchRets)) : null,
      avg_excess_return: benched.length ? r2(mean(excess)) : null,
      beat_benchmark: beatBench,
      beat_benchmark_rate: pct(beatBench, benched.length),
    },
    // Highest price reached while open. Useful for sizing a target; it is
    // NOT a return anyone could have captured, so it is kept well away from
    // the performance block.
    peaks: {
      avg_peak_return: measured.length ? r2(mean(measured.map((h) => h.peak_return_pct || 0))) : null,
      best_peak: measured.length ? r2(Math.max(0, ...measured.map((h) => h.peak_return_pct || 0))) : null,
    },
    excluded_legacy: {
      count: legacy.length,
      reason: legacy.length
        ? 'Closed at peak price by the pre-fix scanner; returns could not go negative, so these are not comparable.'
        : null,
    },
    active_positions: active.length,
    recent_scans: scanLogs.slice(-10).reverse(),
  });
});

// GET /api/alpha — Alpha Engine smart money picks
app.get('/api/alpha', (req, res) => {
  // Retired with the Unusual Whales subscription. Kept so existing callers
  // get a valid empty response rather than a 404.
  res.json({ timestamp: new Date().toISOString(), count: 0, picks: [], retired: true });
});

// GET /api/fundamentals — Long-term fundamentals scores
app.get('/api/fundamentals', (req, res) => {
  res.json({ timestamp: new Date().toISOString(), count: fundamentals.length, stocks: fundamentals });
});

// ═══════════════════════════════════════════════════
// P&L record
// ═══════════════════════════════════════════════════

// GET /api/pnl — the permanent record of closed signals.
//   ?from=YYYY-MM-DD   only count trades closed on or after this date
app.get('/api/pnl', (req, res) => {
  try {
    res.json(buildPnL(history, { from: req.query.from }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pnl.csv — the same ledger as a file, so the record can live
// somewhere that isn't this server.
app.get('/api/pnl.csv', (req, res) => {
  try {
    const csv = toCSV(buildPnL(history, { from: req.query.from }));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="superpicks-pnl-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════
// Sector rotation
// ═══════════════════════════════════════════════════

// GET /api/sectors — the whole Sectors tab in one response.
//   ?class=equity|crypto   which scan (default equity)
//   ?period=1D|1W|1M|…     the return window every view is sorted by
//                          (SINCE = change since the last checkpoint)
// The heavy lifting already happened in the scheduled scan; this only
// re-aggregates stored rows, so it is cheap enough to call per tab click.
app.get('/api/sectors', (req, res) => {
  const assetClass = req.query.class === 'crypto' ? 'crypto' : 'equity';
  const scan = sectors[assetClass];
  const status = sectorStatus({ sectors }, assetClass);

  if (!scan || !scan.rows?.length) {
    return res.json({ ...status, ready: false, rows: [], sectors: [], etfs: [] });
  }

  const valid = new Set([...sectorMap.PERIODS.map((p) => p.key), sectorMap.SINCE_KEY]);
  const period = valid.has(req.query.period) ? req.query.period : '1M';
  const rows = scan.rows;

  // Every view below is a different ordering of the same 341 rows, so
  // sending the row objects inside each one ships the whole universe half a
  // dozen times over (400KB a click). The views carry tickers instead and
  // the browser looks them up in `rows`, which is sent once.
  const tick = (list) => (list || []).map((r) => r.ticker);
  const map = sectorMap.buildMap(rows, period, assetClass).map((s) => ({
    ...s,
    subsectors: s.subsectors.map((sub) => ({ ...sub, members: tick(sub.members) })),
  }));
  const movers = sectorMap.buildMovers(rows, period);
  Object.keys(movers).forEach((k) => { movers[k] = tick(movers[k]); });
  const sinceMovers = sectorMap.buildSinceMovers(rows);

  res.json({
    ...status,
    ready: true,
    period,
    periods: sectorMap.PERIODS.map((p) => ({ key: p.key, label: p.label })),
    sinceKey: sectorMap.SINCE_KEY,
    heatScale: sectorMap.heatScaleFor(assetClass),
    benchmark: sectorMap.benchmarkFor(assetClass),
    style: sectorMap.SECTOR_STYLE,
    setups: sectorMap.SETUPS,
    signals: sectorMap.SIGNALS,
    sectors: map,
    etfs: sectorMap.buildETFRanking(rows, period, assetClass)
      .map(({ row, ...e }) => e),
    flow: sectorMap.buildRotationFlow(rows, '3M', '1W', assetClass),
    movers,
    justChanged: tick(sectorMap.buildJustChanged(rows)),
    sinceMovers: { up: tick(sinceMovers.up), down: tick(sinceMovers.down) },
    read: sectorMap.buildRotationRead(rows, period, assetClass),
    rows,
  });
});

// GET /api/sectors/scan — force a rotation scan outside the checkpoint clock.
app.get('/api/sectors/scan', requireApiKey, async (req, res) => {
  const assetClass = req.query.class === 'crypto' ? 'crypto' : 'equity';
  try {
    const result = await runSectorScan(assetClass, () => ({ sectors }), persist);
    res.json({ success: true, assetClass, asof: result.asof, rows: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ── Screener (ported from the app's screenerService) ──
const screenerCache = {}; // { type: { at, data } }
const SCREENER_TTL = 5 * 60 * 1000; // 5 min — screener hits Unusual Whales

// GET /api/screener?type=stocks|options|analysts
app.get('/api/screener', async (req, res) => {
  const type = (req.query.type || 'stocks').toLowerCase();
  const fnMap = {
    stocks: screener.screenStocks,
    options: screener.screenOptions,
    analysts: screener.screenAnalysts,
  };
  const fn = fnMap[type];
  if (!fn) return res.status(400).json({ error: 'type must be stocks, options, or analysts' });
  try {
    const cached = screenerCache[type];
    if (cached && Date.now() - cached.at < SCREENER_TTL) {
      return res.json({ timestamp: new Date(cached.at).toISOString(), cached: true, type, count: cached.data.length, results: cached.data });
    }
    const data = (await fn()) || [];
    screenerCache[type] = { at: Date.now(), data };
    res.json({ timestamp: new Date().toISOString(), cached: false, type, count: data.length, results: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/movers — Unusual Whales market movers (gainers/losers/active)
app.get('/api/movers', async (req, res) => {
  try {
    const data = await screener.getUWMovers();
    res.json({ timestamp: new Date().toISOString(), movers: data });
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

// GET /api/scan — trigger a full TA scan manually (Granny Shots universe, score>=6)
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
    // Super Picks: web computes them itself using the app's exact TA engine over the
    // Granny Shots universe at score >= 6 (./engines). The app's POST /api/picks
    // remains available as an optional override/fallback.
    await runScan(() => ({ picks, history, scanLogs, nextId }), persist);

    // Fundamentals move quarterly and FMP's free tier allows ~50 calls a
    // day, so this does not belong on the 15-minute loop — every tick would
    // be a chance to spend quota re-reading numbers that have not changed.
    if (Date.now() - lastFundamentalsScan > FUNDAMENTALS_EVERY_MS) {
      lastFundamentalsScan = Date.now();
      await runFundamentalsScan(() => ({ fundamentals, nextId }), persist);
    }

    console.log('[AutoScan] All scans complete.\n');
  } catch (err) {
    console.error('[AutoScan] Error:', err.message);
  }
  scanning = false;
}

// Alpha depended entirely on Unusual Whales, which the app no longer
// subscribes to. Running it would fire seven dead endpoints every 15
// minutes. The route stays so nothing 404s, and answers empty.
const FUNDAMENTALS_EVERY_MS = 6 * 60 * 60 * 1000;
let lastFundamentalsScan = 0;

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
//
// The store is read before the first request, so nothing can serve an empty
// history that is merely still loading and then quietly overwrite the real
// one on the next persist().
loadAll()
  .then(() => {
    console.log(`[Store] Loaded — picks ${picks.length}, history ${history.length}, `
      + `sectors ${Object.keys(sectors).length}`);
  })
  .catch((err) => {
    console.error('[Store] Load failed, starting empty:', err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n  Super Picks Trading Server`);
      console.log(`  Dashboard:  http://localhost:${PORT}`);
      console.log(`  Signals:    http://localhost:${PORT}/api/signals`);
      console.log(`  Picks: ${picks.length} | History: ${history.length}\n`);

      // Run first scan 5 seconds after startup
      setTimeout(autoScan, 5000);

      // Re-scan every 15 minutes
      setInterval(autoScan, 15 * 60 * 1000);

      // Sector rotation runs on its own checkpoint clock — see sector-scanner.js.
      // It stands aside while the TA scan is mid-flight so the two never hit
      // Yahoo together.
      startSectorSchedulers(() => ({ sectors }), persist, () => !scanning);
    });
  });

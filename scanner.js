// ═══════════════════════════════════════════════════
// Super Picks Scanner — Server-side TA Engine
// Uses the SAME logic as the mobile app: the app's exact
// technicalAnalysis.js engine over the Granny Shots holdings PLUS the
// app's full sector-map universe, keeping composite score >= 6 (the
// app's Super Picks bar). Ported engines live in ./engines/.
// ═══════════════════════════════════════════════════

const { getAllHoldings } = require('./engines/holdings');
const { analyzeStocks } = require('./engines/technicalAnalysis');
const { EQUITY_UNIVERSE, sectorFor } = require('./engines/universe');

const SUPER_PICK_MIN_SCORE = 6; // matches the app's DashboardScreen threshold

// Map the app engine's analyzeStock result -> the server's pick shape
// (identical field names to what POST /api/picks stores, so the frontend
// and /api/picks, /api/signals all keep working unchanged).
function mapPick(holding, r) {
  const meta = sectorFor(r.symbol || holding?.symbol);
  const price = r.price || 0;
  const prevClose = r.prevClose || 0;
  const dailyChange = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  const s = r.signals || {};
  const ind = r.indicators || {};
  return {
    symbol: r.symbol || holding?.symbol,
    name: holding?.name || r.name || r.symbol || holding?.symbol,
    sector: holding?.sector || meta.sector || '',
    composite_score: r.compositeScore,
    overall_signal: r.overallSignal,
    price: Math.round(price * 100) / 100,
    daily_change: Math.round(dailyChange * 100) / 100,
    momentum_score: s.momentum?.score ?? 0, momentum_label: s.momentum?.label || '',
    macd_score: s.macd?.score ?? 0, macd_label: s.macd?.label || '',
    sma_score: s.sma?.score ?? 0, sma_label: s.sma?.label || '',
    stoch_score: s.stochastic?.score ?? 0, stoch_label: s.stochastic?.label || '',
    volume_score: s.volume?.score ?? 0, volume_label: s.volume?.label || '',
    cci_score: s.cci?.score ?? 0, cci_label: s.cci?.label || '',
    willr_score: s.williamsR?.score ?? 0, willr_label: s.williamsR?.label || '',
    rsi_value: ind.rsi ?? 0,
  };
}

/**
 * Run a full TA scan over the Granny Shots holdings and update the store.
 * @param {Function} getStore - returns { picks, history, scanLogs, nextId }
 * @param {Function} persist - saves data to disk
 */
async function runScan(getStore, persist) {
  const startTime = Date.now();

  const holdings = getAllHoldings();
  const holdingBySymbol = {};
  holdings.forEach((h) => { if (!holdingBySymbol[h.symbol]) holdingBySymbol[h.symbol] = h; });

  // ETF holdings first, then everything else the app's sector map covers.
  const symbols = [...new Set([...Object.keys(holdingBySymbol), ...EQUITY_UNIVERSE])];

  console.log(`[Scanner] Starting TA scan of ${symbols.length} symbols `
    + `(${Object.keys(holdingBySymbol).length} ETF holdings + ${EQUITY_UNIVERSE.length} sector universe)...`);

  const taResults = await analyzeStocks(symbols, { batchSize: 8 });

  const picks = symbols
    .filter((sym) => taResults[sym] && typeof taResults[sym].compositeScore === 'number')
    .map((sym) => mapPick(holdingBySymbol[sym], taResults[sym]))
    .filter((p) => p.composite_score >= SUPER_PICK_MIN_SCORE)
    .sort((a, b) => b.composite_score - a.composite_score);

  const scanTimeMs = Date.now() - startTime;
  console.log(`[Scanner] Complete: ${symbols.length} analyzed, ${picks.length} picks (${(scanTimeMs / 1000).toFixed(1)}s)`);

  // ── Update store (same bookkeeping as before) ──
  const store = getStore();
  const batchId = `scan_${Date.now()}`;
  const now = new Date().toISOString();

  const activeMap = {};
  store.history.filter((h) => h.status === 'active').forEach((h) => { activeMap[h.symbol] = h; });
  const newSymbols = new Set(picks.map((p) => p.symbol));

  // Replace current picks
  store.picks.length = 0;
  picks.forEach((p) => {
    p.id = store.nextId.pick++;
    p.updated_at = now;
    store.picks.push(p);
  });

  // Add new symbols to history / update peak for existing
  for (const p of picks) {
    if (!activeMap[p.symbol]) {
      store.history.push({
        id: store.nextId.hist++,
        symbol: p.symbol,
        name: p.name,
        composite_score: p.composite_score,
        overall_signal: p.overall_signal,
        entry_price: p.price,
        entry_date: now,
        exit_price: 0, exit_date: null,
        return_pct: 0, peak_price: p.price, peak_return_pct: 0,
        status: 'active', scan_batch: batchId,
      });
    } else {
      const h = store.history.find((x) => x.symbol === p.symbol && x.status === 'active');
      if (h && p.price > (h.peak_price || 0)) {
        h.peak_price = p.price;
        h.peak_return_pct = h.entry_price > 0 ? ((p.price - h.entry_price) / h.entry_price) * 100 : 0;
      }
    }
  }

  // Close dropped picks
  for (const sym of Object.keys(activeMap)) {
    if (!newSymbols.has(sym)) {
      const h = store.history.find((x) => x.symbol === sym && x.status === 'active');
      if (h) {
        h.status = 'closed';
        h.exit_price = h.peak_price || h.entry_price;
        h.exit_date = now;
        h.return_pct = h.entry_price > 0 ? ((h.exit_price - h.entry_price) / h.entry_price) * 100 : 0;
      }
    }
  }

  // Log scan
  const avgScore = picks.length > 0 ? picks.reduce((s, p) => s + p.composite_score, 0) / picks.length : 0;
  store.scanLogs.push({
    batch_id: batchId, total_scanned: symbols.length, picks_found: picks.length,
    avg_score: Math.round(avgScore * 100) / 100, scan_time_ms: scanTimeMs, created_at: now,
  });
  if (store.scanLogs.length > 100) store.scanLogs.splice(0, store.scanLogs.length - 100);

  persist();
  return { total: symbols.length, picks: picks.length, timeMs: scanTimeMs };
}

module.exports = { runScan };

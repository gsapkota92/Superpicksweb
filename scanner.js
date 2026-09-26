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
const { getRegime } = require('./engines/regime');

const SUPER_PICK_MIN_SCORE = 6; // matches the app's DashboardScreen threshold

// Every signal is benchmarked against buying SPY at the same moment and
// holding it for the same window. A win rate means nothing on its own —
// "62% of picks went up" during a quarter when SPY went up 70% of the days
// is a losing strategy described flatteringly.
const BENCHMARK = 'SPY';

// Marks records written by the corrected bookkeeping. Rows without it were
// closed at their peak price by the old code and cannot be compared to
// anything, so the stats endpoint excludes them rather than quietly mixing
// honest and dishonest returns in one average.
const MEASUREMENT_VERSION = 2;

// ── Universe hygiene ──
//
// Applied before scoring, because most bad signals in a scanner come from the
// universe rather than the maths: a thin, cheap name can print a textbook
// setup that nobody could actually trade at the price shown.
//
// These are floors, not opinions — they are set low enough to remove the
// untradeable rather than to express a view about what is worth owning.
const MIN_PRICE = 5;                      // no sub-$5 names
const MIN_DOLLAR_VOLUME = 20_000_000;     // $20M/day, averaged over 20 sessions

// ── Regime ──
//
// When SPY is below its own 200-day average the bar goes up rather than to
// infinity. A hard cutoff would empty the list and read as a broken app,
// telling you nothing about which names were holding up; raising the
// threshold keeps the strongest few visible and cuts the count hard. Every
// pick carries the regime it was found in, so the record can later answer
// how risk-off picks actually did.
const RISK_OFF_SCORE_PENALTY = 1.0;

/**
 * Where the signal is wrong. Entry minus 2x ATR(14), or the low of the last
 * ten sessions, whichever is nearer the entry — the tighter of "normal
 * volatility" and "the last place buyers actually showed up".
 */
function stopFor(price, ind) {
  const atr = ind.atr;
  const swing = ind.swingLow;
  const byAtr = atr != null ? price - 2 * atr : null;
  const bySwing = swing != null && swing < price ? swing : null;

  if (byAtr == null && bySwing == null) return { stop: null, stop_basis: null };
  if (bySwing == null) return { stop: r2(byAtr), stop_basis: '2x ATR(14)' };
  if (byAtr == null) return { stop: r2(bySwing), stop_basis: '10-session swing low' };

  return byAtr >= bySwing
    ? { stop: r2(byAtr), stop_basis: '2x ATR(14)' }
    : { stop: r2(bySwing), stop_basis: '10-session swing low' };
}

function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }

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
    atr: ind.atr ?? null,
    avg_dollar_volume: ind.avgDollarVolume20 ?? null,
    ...stopFor(price, ind),
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

  // SPY rides along so every open and close can be priced against it. It is
  // scanned, never picked.
  const scanList = symbols.includes(BENCHMARK) ? symbols : [...symbols, BENCHMARK];

  console.log(`[Scanner] Starting TA scan of ${symbols.length} symbols `
    + `(${Object.keys(holdingBySymbol).length} ETF holdings + ${EQUITY_UNIVERSE.length} sector universe)...`);

  const taResults = await analyzeStocks(scanList, { batchSize: 8 });
  const benchPrice = taResults[BENCHMARK]?.price ?? null;

  // The regime is read once per scan, off its own cached SPY history, and
  // fails open: an 'unknown' answer filters nothing.
  const regime = await getRegime();
  const riskOff = regime.state === 'risk-off';
  const minScore = SUPER_PICK_MIN_SCORE + (riskOff ? RISK_OFF_SCORE_PENALTY : 0);

  const scored = symbols
    .filter((sym) => sym !== BENCHMARK)
    .filter((sym) => taResults[sym] && typeof taResults[sym].compositeScore === 'number')
    .map((sym) => mapPick(holdingBySymbol[sym], taResults[sym]));

  // Hygiene first, so the counts below describe what was actually eligible.
  const rejected = { price: 0, liquidity: 0, unknown_liquidity: 0 };
  const eligible = scored.filter((p) => {
    if (!(p.price >= MIN_PRICE)) { rejected.price++; return false; }
    if (p.avg_dollar_volume == null) { rejected.unknown_liquidity++; return true; } // fail open
    if (p.avg_dollar_volume < MIN_DOLLAR_VOLUME) { rejected.liquidity++; return false; }
    return true;
  });

  const picks = eligible
    .filter((p) => p.composite_score >= minScore)
    .map((p) => ({ ...p, regime: regime.state }))
    .sort((a, b) => b.composite_score - a.composite_score);

  // What the bar cost, so a short list is explicable rather than mysterious.
  const wouldHaveQualified = riskOff
    ? eligible.filter((p) => p.composite_score >= SUPER_PICK_MIN_SCORE).length
    : picks.length;

  const scanTimeMs = Date.now() - startTime;
  console.log(`[Scanner] Complete: ${symbols.length} analyzed, ${picks.length} picks `
    + `(${(scanTimeMs / 1000).toFixed(1)}s) — regime ${regime.state}`
    + (riskOff ? `, bar raised to ${minScore} (${wouldHaveQualified} would have passed at ${SUPER_PICK_MIN_SCORE})` : '')
    + `; filtered out ${rejected.price} on price, ${rejected.liquidity} on liquidity`);

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

  // ── Open new signals ──
  //
  // Everything needed to judge this signal later is written down now, at
  // generation time: entry, the stop that invalidates it, and what SPY cost
  // at the same instant. Nothing here is recomputed afterwards.
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
        stop: p.stop ?? null,
        stop_basis: p.stop_basis ?? null,
        atr_at_entry: p.atr ?? null,
        // Written down at entry so the record can later answer how picks
        // found in a risk-off tape actually did — the question the filter is
        // a bet on, and one you can only settle with data you kept.
        regime_at_entry: regime.state,
        dollar_volume_at_entry: p.avg_dollar_volume ?? null,
        bench_symbol: BENCHMARK,
        bench_entry_price: benchPrice,
        bench_exit_price: null,
        bench_return_pct: null,
        excess_return_pct: null,
        exit_price: null, exit_date: null, exit_reason: null,
        return_pct: null,
        peak_price: p.price, peak_return_pct: 0,
        stop_hit: false,
        status: 'active', scan_batch: batchId,
        measurement_version: MEASUREMENT_VERSION,
      });
    }
    // Peaks and stops for existing positions are handled below, over every
    // open row rather than only the ones still qualifying.
  }

  // ── Mark peaks and stop breaches on every open position ──
  //
  // This runs over all open rows, not just the ones still qualifying. A
  // position that falls through its stop usually stops qualifying in the
  // same scan, so checking only the still-qualifying ones would miss exactly
  // the cases the stop exists for.
  for (const h of store.history) {
    if (h.status !== 'active') continue;
    const cur = taResults[h.symbol]?.price;
    if (cur == null) continue;
    if (cur > (h.peak_price || 0)) {
      h.peak_price = r2(cur);
      h.peak_return_pct = h.entry_price > 0 ? r2(((cur - h.entry_price) / h.entry_price) * 100) : 0;
    }
    if (!h.stop_hit && h.stop != null && cur <= h.stop) h.stop_hit = true;
  }

  // ── Close signals that dropped off the list ──
  //
  // At the last price the scan actually saw, not the best price the position
  // ever reached. Closing at the peak was the old behaviour and it made
  // return_pct arithmetically incapable of being negative, which pinned the
  // reported win rate at 100% no matter how the picks really did.
  for (const sym of Object.keys(activeMap)) {
    if (newSymbols.has(sym)) continue;
    const h = store.history.find((x) => x.symbol === sym && x.status === 'active');
    if (!h) continue;

    // The symbol is still scanned even when it stops qualifying, so there is
    // a real current price for almost every close. The rare exception is a
    // fetch failure, which is recorded honestly rather than guessed at.
    const last = taResults[sym]?.price ?? null;

    h.status = 'closed';
    h.exit_date = now;

    // A position opened before the fix but closed after it is honest end to
    // end: entry prices were always recorded correctly, only exits were not.
    // Promote it rather than discard a real data point. It carries no
    // benchmark leg, so it counts toward return stats and not toward the
    // versus-SPY ones, which filter on excess_return_pct being present.
    if (!(h.measurement_version >= MEASUREMENT_VERSION)) {
      h.measurement_version = MEASUREMENT_VERSION;
      h.entry_provenance = 'pre-fix entry, no benchmark leg';
    }

    if (last == null) {
      h.exit_price = null;
      h.return_pct = null;
      h.exit_reason = 'no-price';
    } else {
      h.exit_price = r2(last);
      h.return_pct = h.entry_price > 0 ? r2(((last - h.entry_price) / h.entry_price) * 100) : null;
      h.exit_reason = h.stop_hit ? 'stopped-out' : 'signal-ended';
    }

    // The same window, in SPY. Excess return is the number that says whether
    // the signal was worth acting on rather than just holding the index.
    h.bench_exit_price = benchPrice;
    if (h.bench_entry_price > 0 && benchPrice != null) {
      h.bench_return_pct = r2(((benchPrice - h.bench_entry_price) / h.bench_entry_price) * 100);
      if (h.return_pct != null) {
        h.excess_return_pct = r2(h.return_pct - h.bench_return_pct);
      }
    }
  }

  // Log scan
  const avgScore = picks.length > 0 ? picks.reduce((s, p) => s + p.composite_score, 0) / picks.length : 0;
  store.scanLogs.push({
    batch_id: batchId, total_scanned: symbols.length, picks_found: picks.length,
    avg_score: Math.round(avgScore * 100) / 100, scan_time_ms: scanTimeMs, created_at: now,
    regime: regime.state,
    min_score: minScore,
    filtered_price: rejected.price,
    filtered_liquidity: rejected.liquidity,
  });
  if (store.scanLogs.length > 100) store.scanLogs.splice(0, store.scanLogs.length - 100);

  persist();
  return {
    total: symbols.length,
    picks: picks.length,
    timeMs: scanTimeMs,
    regime: regime.state,
    minScore,
    filtered: rejected,
    wouldHaveQualified,
  };
}

module.exports = { runScan };

// ═══════════════════════════════════════════════════
// Alpha Scanner — wrapper around the app's full Alpha engine
// Uses the ported ./engines/alphaEngine.js (7 Unusual Whales
// endpoints + Yahoo enrichment + conviction scoring), the SAME
// logic as the mobile app. Maps the engine output to the store
// shape the dashboard already expects.
// ═══════════════════════════════════════════════════

const { runAlphaScan: engineAlphaScan } = require('./engines/alphaEngine');

/**
 * @param {Function} getStore - returns { alpha, alphaHistory, nextId }
 * @param {Function} persist - saves data to disk
 */
async function runAlphaScan(getStore, persist) {
  const startTime = Date.now();
  console.log('[Alpha] Starting Unusual Whales scan (app engine)...');

  let picks = [];
  try {
    picks = (await engineAlphaScan()) || [];
  } catch (err) {
    console.error('[Alpha] Engine error:', err.message);
    picks = [];
  }

  const timestamp = new Date().toISOString();

  // Map engine picks -> dashboard store shape.
  // Frontend reads: symbol, name, price, dailyChange, conviction, tier, sources.
  const mapped = picks.map((p) => ({
    symbol: p.symbol,
    name: p.name || p.symbol,
    price: p.price || 0,
    dailyChange: p.dayChange || 0,
    conviction: p.conviction || 0,
    tier: p.tier || 'WATCH',
    sources: Array.isArray(p.signals)
      ? p.signals.map((s) => s.text || s.category).filter(Boolean)
      : [],
    // richer fields preserved (frontend ignores unknown keys)
    signalCount: p.signalCount || 0,
    rank: p.rank,
    totalFlowPremium: p.totalFlowPremium,
    darkPoolNotional: p.darkPoolNotional,
    insiderBuyValue: p.insiderBuyValue,
    updatedAt: timestamp,
  }));

  const store = getStore();
  store.alpha.length = 0;
  store.alpha.push(...mapped);

  if (!Array.isArray(store.alphaHistory)) store.alphaHistory = [];
  store.alphaHistory.push({
    scannedAt: timestamp,
    pickCount: mapped.length,
    topPick: mapped[0]?.symbol || 'N/A',
    topConviction: mapped[0]?.conviction || 0,
  });
  if (store.alphaHistory.length > 50) {
    store.alphaHistory.splice(0, store.alphaHistory.length - 50);
  }

  persist();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Alpha] Scan complete in ${elapsed}s — ${mapped.length} picks${mapped[0] ? ` (top: ${mapped[0].symbol} @ ${mapped[0].conviction})` : ''}`);

  return {
    pickCount: mapped.length,
    elapsed: parseFloat(elapsed),
    topPick: mapped[0]?.symbol || null,
  };
}

module.exports = { runAlphaScan };

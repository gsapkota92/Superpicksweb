// ═══════════════════════════════════════════════════
// Fundamentals Scanner — wrapper around the app's engine
// Uses the ported ./engines/fundamentalsService.js
// (analyzeLongTermStocks) — the SAME long-term/fundamentals
// scoring the mobile app uses (Yahoo quoteSummary + chart).
// ═══════════════════════════════════════════════════

const { analyzeLongTermStocks } = require('./engines/fundamentalsService');

/**
 * @param {Function} getStore - returns { fundamentals, nextId }
 * @param {Function} persist - saves data to disk
 */
async function runFundamentalsScan(getStore, persist) {
  const startTime = Date.now();
  console.log('[Fundamentals] Starting long-term scan (app engine)...');

  let results = [];
  try {
    results = (await analyzeLongTermStocks()) || [];
  } catch (err) {
    console.error('[Fundamentals] Engine error:', err.message);
    results = [];
  }

  const timestamp = new Date().toISOString();
  const enriched = results.map((r) => ({ ...r, updatedAt: timestamp }));

  const store = getStore();
  store.fundamentals.length = 0;
  store.fundamentals.push(...enriched);

  persist();

  const scanTimeMs = Date.now() - startTime;
  const strongBuys = enriched.filter((r) => r.overallLabel === 'Strong Buy').length;
  const buys = enriched.filter((r) => r.overallLabel === 'Buy').length;
  console.log(`[Fundamentals] Scan complete: ${enriched.length} analyzed, ${strongBuys} Strong Buy / ${buys} Buy (${(scanTimeMs / 1000).toFixed(1)}s)`);

  return { total: enriched.length, strongBuys, buys, timeMs: scanTimeMs };
}

module.exports = { runFundamentalsScan };

// ═══════════════════════════════════════════════════
// Super Picks Sector Scanner — server-side rotation engine
//
// Runs the app's Sector Map scan on the server so the dashboard shows the
// same rotation numbers the phone does, without every browser tab firing
// its own 380 requests at Yahoo.
//
// Two independent scans on two clocks, exactly as the app splits them:
//   equities  vs SPY, at 10:00 / 13:00 / 16:00 ET on weekdays (noon on
//             weekends, so a Sunday map isn't a week stale)
//   crypto    vs BTC, every two hours, every day
//
// A scan is ~380 Yahoo chart calls at range=2y, so it deliberately does not
// share the 15-minute TA loop; it also stands aside while that loop is
// running rather than doubling up on the same host.
// ═══════════════════════════════════════════════════

const {
  loadSectorScan, applyDeltas, getUniverse, benchmarkFor,
} = require('./engines/sectorMap');
const {
  lastCheckpoint, nextCheckpoint, untilText, startCheckpointScheduler,
} = require('./engines/sectorSchedule');

// The server has no phone battery to protect, so it always scans the full
// universe — the app's 'core' tier exists for cold starts on cellular.
const TIER = 'full';

/**
 * What we keep from the previous checkpoint. applyDeltas only reads these
 * five fields, and storing whole rows twice would double sectors.json for
 * nothing.
 */
function slimPrev(scan) {
  return {
    asof: scan.asof,
    ranAt: scan.ranAt,
    checkpoint: scan.checkpoint || null,
    rows: (scan.rows || []).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      trendScore: r.trendScore,
      signals: r.signals || [],
      setup: r.setup,
    })),
  };
}

/**
 * Run one asset class and fold the result into the store.
 *
 * @param {'equity'|'crypto'} assetClass
 * @param {function} getStore  () => ({ sectors })
 * @param {function} persist
 * @param {object} [checkpoint] the checkpoint this run belongs to
 */
async function runSectorScan(assetClass, getStore, persist, checkpoint = null) {
  const started = Date.now();
  const universe = getUniverse(TIER, assetClass);
  const label = checkpoint ? ` for ${checkpoint.label}` : '';
  console.log(`[Sectors] ${assetClass} scan${label}: `
    + `${universe.length} symbols vs ${benchmarkFor(assetClass)}...`);

  const scan = await loadSectorScan({ tier: TIER, assetClass, force: true });

  const store = getStore();
  const previous = store.sectors[assetClass] || null;

  // The scan that was on screen becomes "before", so every row can carry
  // what changed since the last scheduled update rather than since some
  // arbitrary page load.
  const prev = previous ? (previous.prev && !checkpoint ? previous.prev : slimPrev(previous)) : null;
  const rows = prev ? applyDeltas(scan.rows, prev) : scan.rows;

  store.sectors[assetClass] = {
    assetClass,
    tier: TIER,
    asof: scan.asof,
    live: scan.live,
    ranAt: new Date().toISOString(),
    checkpoint: checkpoint ? { key: checkpoint.key, label: checkpoint.label, ts: checkpoint.ts } : null,
    scanMs: Date.now() - started,
    failed: scan.failed || [],
    rows,
    prev,
  };
  persist();

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[Sectors] ${assetClass} complete: ${rows.length} rows, `
    + `as of ${scan.asof}, ${(scan.failed || []).length} failed (${secs}s)`);

  return store.sectors[assetClass];
}

/**
 * Start both clocks.
 *
 * @param {function} getStore  () => ({ sectors })
 * @param {function} persist
 * @param {function} [canRun]  return false to defer (e.g. the TA scan is
 *                             mid-flight); the checkpoint is retried on the
 *                             next 60-second poll rather than skipped.
 * @returns {function} stop
 */
function startSectorSchedulers(getStore, persist, canRun = () => true) {
  const stops = ['equity', 'crypto'].map((assetClass) => {
    const status = nextCheckpoint(Date.now(), assetClass);
    console.log(`[Sectors] ${assetClass} scheduler armed — next ${status ? status.label : '?'}`
      + (status ? ` (${untilText(status.ts)})` : ''));

    return startCheckpointScheduler({
      assetClass,
      getRanKey: () => getStore().sectors[assetClass]?.checkpoint?.key || null,
      onCheckpoint: async (cp) => {
        if (!canRun()) {
          // Throwing leaves the checkpoint unmarked, so the next poll picks
          // it up once the other scanner is done.
          throw new Error('deferred: another scan is running');
        }
        await runSectorScan(assetClass, getStore, persist, cp);
      },
    });
  });

  return () => stops.forEach((s) => s());
}

/** Small header for /api/sectors and the dashboard's "next update" line. */
function sectorStatus(store, assetClass) {
  const s = store.sectors[assetClass];
  const next = nextCheckpoint(Date.now(), assetClass);
  const last = lastCheckpoint(Date.now(), assetClass);
  return {
    assetClass,
    asof: s?.asof || null,
    ranAt: s?.ranAt || null,
    live: s?.live || false,
    rows: s?.rows?.length || 0,
    checkpoint: s?.checkpoint || null,
    lastCheckpoint: last ? { key: last.key, label: last.label, ts: last.ts } : null,
    nextCheckpoint: next ? { key: next.key, label: next.label, ts: next.ts } : null,
    nextIn: next ? untilText(next.ts) : null,
    pending: !!(last && s?.checkpoint?.key !== last.key),
  };
}

module.exports = { runSectorScan, startSectorSchedulers, sectorStatus, TIER };

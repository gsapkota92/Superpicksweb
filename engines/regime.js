// ═══════════════════════════════════════════════════
// Market regime
//
// One question: is the index above its own 200-day moving average?
//
// It is the bluntest filter in the book and the best documented — the bulk of
// large drawdowns happen while the index is below that line, and standing
// aside through those does more for a strategy's worst month than any
// indicator tweak. It costs one extra request.
//
// The TA scan fetches three months per symbol, which is ~63 bars and nowhere
// near enough to compute a 200-day average, so this fetches SPY's own year
// of history separately and caches it.
//
// Fails OPEN. If the regime cannot be determined — a bad fetch, a short
// series — the answer is 'unknown' and nothing is filtered. A network blip
// must never silently empty the pick list and leave it looking like the
// market had no opportunities.
// ═══════════════════════════════════════════════════

const BENCHMARK = 'SPY';
const TTL_MS = 2 * 60 * 60 * 1000;   // the 200-day line does not move fast
const MA_PERIOD = 200;
const SLOPE_LOOKBACK = 20;           // bars back, for "is the line itself rising"

let cache = { at: 0, value: null };

async function fetchCloses(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
    + '?range=2y&interval=1d';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const closes = (r?.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  const dates = r?.timestamp || [];
  if (closes.length < MA_PERIOD + SLOPE_LOOKBACK) {
    throw new Error(`only ${closes.length} bars, need ${MA_PERIOD + SLOPE_LOOKBACK}`);
  }
  return { closes, lastDate: dates.length ? dates[dates.length - 1] * 1000 : null };
}

function sma(values, period, offsetFromEnd = 0) {
  const end = values.length - offsetFromEnd;
  if (end < period) return null;
  const slice = values.slice(end - period, end);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** @returns {{state:'risk-on'|'risk-off'|'unknown', ...}} */
async function getRegime({ force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;

  let value;
  try {
    const { closes, lastDate } = await fetchCloses(BENCHMARK);
    const price = closes[closes.length - 1];
    const ma200 = sma(closes, MA_PERIOD);
    const ma200Prev = sma(closes, MA_PERIOD, SLOPE_LOOKBACK);
    const above = price > ma200;

    value = {
      state: above ? 'risk-on' : 'risk-off',
      benchmark: BENCHMARK,
      price: Math.round(price * 100) / 100,
      ma200: Math.round(ma200 * 100) / 100,
      pct_vs_ma200: Math.round(((price / ma200 - 1) * 100) * 100) / 100,
      ma200_rising: ma200Prev != null ? ma200 > ma200Prev : null,
      asof: lastDate ? new Date(lastDate).toISOString() : null,
      checked_at: new Date().toISOString(),
      reason: above
        ? `${BENCHMARK} is above its 200-day average`
        : `${BENCHMARK} is below its 200-day average`,
    };
  } catch (err) {
    // Fail open — see the note at the top of this file.
    value = {
      state: 'unknown',
      benchmark: BENCHMARK,
      price: null, ma200: null, pct_vs_ma200: null, ma200_rising: null,
      asof: null,
      checked_at: new Date().toISOString(),
      reason: `Could not determine the regime (${err.message}) — no filtering applied.`,
    };
  }

  cache = { at: Date.now(), value };
  return value;
}

function cachedRegime() { return cache.value; }

module.exports = { getRegime, cachedRegime, BENCHMARK, MA_PERIOD };

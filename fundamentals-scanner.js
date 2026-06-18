// ═══════════════════════════════════════════════════
// Fundamentals Scanner — Server-side Scoring Engine
// Fetches Yahoo Finance fundamental data and scores
// stocks on valuation, growth, profitability, health,
// dividends, and trend to produce a 1-10 rating.
// ═══════════════════════════════════════════════════

// ── Stock Universe ──
const SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','META','NVDA','AVGO','ORCL','CRM','ADBE',
  'JPM','V','MA','BAC','GS','BRK-B','UNH','LLY','JNJ','ABBV',
  'MRK','PFE','WMT','COST','PG','KO','PEP','NKE','MCD','CAT',
  'GE','XOM','CVX','NEE','NFLX','AMD','TSLA','SHOP','PLTR','COIN','SQ',
];

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const SCAN_CACHE_MS = 10 * 60 * 1000; // 10-minute cache
const BATCH_SIZE = 3;                  // concurrent requests per batch
const BATCH_DELAY_MS = 200;            // delay between batches

// ═══════════════════════════════════════════════════
// Utility Helpers
// ═══════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse a Yahoo Finance value that may be a plain number
 * or an object like { raw: 12.34, fmt: "12.34" }.
 */
function pf(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && v.raw != null) return parseFloat(v.raw) || 0;
  return parseFloat(v) || 0;
}

// ═══════════════════════════════════════════════════
// Yahoo Finance Data Fetchers
// ═══════════════════════════════════════════════════

/**
 * Fetch v8 chart data (1-year monthly) for price history,
 * returns, moving averages, and company name.
 */
async function fetchChartData(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1mo`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = (quotes.close || []).filter((v) => v != null);

    if (closes.length < 2) return null;

    const price = meta.regularMarketPrice || closes[closes.length - 1] || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
    const name = meta.shortName || meta.longName || symbol;

    // 1-year return (first close vs current)
    const firstClose = closes[0];
    const return1Y = firstClose > 0 ? ((price - firstClose) / firstClose) * 100 : 0;

    // 6-month return (approx midpoint of monthly closes)
    const midIdx = Math.floor(closes.length / 2);
    const midClose = closes[midIdx] || firstClose;
    const return6M = midClose > 0 ? ((price - midClose) / midClose) * 100 : 0;

    // Daily change
    const dailyChange = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    // Simple moving averages from monthly closes
    // Approximate 50-day as ~2-3 month MA, 200-day as ~10 month MA
    const sma50 = closes.length >= 3
      ? closes.slice(-3).reduce((s, v) => s + v, 0) / 3
      : null;
    const sma200 = closes.length >= 10
      ? closes.slice(-10).reduce((s, v) => s + v, 0) / 10
      : null;

    return {
      price: Math.round(price * 100) / 100,
      name,
      return1Y: Math.round(return1Y * 100) / 100,
      return6M: Math.round(return6M * 100) / 100,
      dailyChange: Math.round(dailyChange * 100) / 100,
      sma50,
      sma200,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch v10 quoteSummary for fundamental metrics:
 * PE, forward PE, EPS, margins, ROE, debt/equity,
 * dividend yield, market cap, revenue growth, sector.
 */
async function fetchQuoteSummary(symbol) {
  try {
    const modules = 'summaryDetail,defaultKeyStatistics,financialData,summaryProfile';
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;

    const summary = result.summaryDetail || {};
    const keyStats = result.defaultKeyStatistics || {};
    const financial = result.financialData || {};
    const profile = result.summaryProfile || {};

    return {
      pe: pf(summary.trailingPE),
      forwardPE: pf(summary.forwardPE || keyStats.forwardPE),
      eps: pf(keyStats.trailingEps),
      dividendYield: pf(summary.dividendYield) * 100,       // convert to percentage
      marketCap: pf(summary.marketCap),
      profitMargin: pf(financial.profitMargins) * 100,       // convert to percentage
      returnOnEquity: pf(financial.returnOnEquity) * 100,    // convert to percentage
      debtToEquity: pf(financial.debtToEquity),
      revenueGrowth: pf(financial.revenueGrowth) * 100,     // convert to percentage
      sector: profile.sector || 'Unknown',
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════
// Fundamental Scoring Engine (1-10 scale)
// ═══════════════════════════════════════════════════

/**
 * Compute a fundamental score from 1-10 based on:
 * - Valuation (PE ratio)
 * - Growth (price returns, revenue growth)
 * - Profitability (margin, ROE)
 * - Financial Health (debt-to-equity)
 * - Dividends (yield)
 * - Trend (price vs moving averages)
 *
 * Returns { score, label, signals }
 */
function computeFundamentalScore(chart, fundamentals) {
  let score = 5; // start at midpoint
  const signals = {};

  // ── Valuation (PE) ──
  const pe = fundamentals.pe;
  if (pe > 0) {
    if (pe < 15)       { score += 2;    signals.valuation = 'Undervalued (PE < 15)'; }
    else if (pe <= 25) { score += 1;    signals.valuation = 'Fair Value (PE 15-25)'; }
    else if (pe <= 40) { score += 0;    signals.valuation = 'Growth Premium (PE 25-40)'; }
    else if (pe <= 80) { score -= 0.5;  signals.valuation = 'Expensive (PE 40-80)'; }
    else               { score -= 1;    signals.valuation = 'Very Expensive (PE > 80)'; }
  } else {
    signals.valuation = 'No PE (negative earnings)';
  }

  // ── Growth ──
  const ret1Y = chart.return1Y;
  if (ret1Y > 50)       { score += 2;    signals.priceGrowth = 'Exceptional 1Y Return (> 50%)'; }
  else if (ret1Y > 20)  { score += 1.5;  signals.priceGrowth = 'Strong 1Y Return (> 20%)'; }
  else if (ret1Y > 5)   { score += 0.5;  signals.priceGrowth = 'Positive 1Y Return (> 5%)'; }
  else if (ret1Y < -20) { score -= 1.5;  signals.priceGrowth = 'Deep Decline (< -20%)'; }
  else if (ret1Y < -5)  { score -= 0.5;  signals.priceGrowth = 'Negative 1Y Return (< -5%)'; }
  else                   { score += 0;    signals.priceGrowth = 'Flat 1Y Return'; }

  const revGrowth = fundamentals.revenueGrowth;
  if (revGrowth > 20) {
    score += 0.5;
    signals.revenueGrowth = 'Strong Revenue Growth (> 20%)';
  } else {
    signals.revenueGrowth = revGrowth > 0
      ? `Moderate Revenue Growth (${revGrowth.toFixed(1)}%)`
      : `Revenue Decline (${revGrowth.toFixed(1)}%)`;
  }

  // ── Profitability ──
  const margin = fundamentals.profitMargin;
  if (margin > 25)      { score += 1.5;  signals.profitability = 'High Margin (> 25%)'; }
  else if (margin > 15) { score += 1;    signals.profitability = 'Good Margin (> 15%)'; }
  else if (margin > 5)  { score += 0.5;  signals.profitability = 'Moderate Margin (> 5%)'; }
  else if (margin < 0)  { score -= 1;    signals.profitability = 'Negative Margin'; }
  else                   { score += 0;    signals.profitability = 'Thin Margin (0-5%)'; }

  const roe = fundamentals.returnOnEquity;
  if (roe > 20) {
    score += 0.5;
    signals.roe = 'Strong ROE (> 20%)';
  } else {
    signals.roe = roe > 0
      ? `Moderate ROE (${roe.toFixed(1)}%)`
      : `Negative ROE (${roe.toFixed(1)}%)`;
  }

  // ── Financial Health (Debt-to-Equity) ──
  const de = fundamentals.debtToEquity;
  if (de >= 0) {
    if (de < 50)        { score += 1;    signals.health = 'Low Debt (D/E < 50)'; }
    else if (de < 100)  { score += 0.5;  signals.health = 'Moderate Debt (D/E 50-100)'; }
    else if (de < 200)  { score += 0;    signals.health = 'High Debt (D/E 100-200)'; }
    else                { score -= 1;    signals.health = 'Very High Debt (D/E > 200)'; }
  } else {
    signals.health = 'D/E Not Available';
  }

  // ── Dividends ──
  const divYield = fundamentals.dividendYield;
  if (divYield > 3)       { score += 1;   signals.dividend = `High Yield (${divYield.toFixed(2)}%)`; }
  else if (divYield > 1.5) { score += 0.5; signals.dividend = `Moderate Yield (${divYield.toFixed(2)}%)`; }
  else if (divYield > 0)   { signals.dividend = `Low Yield (${divYield.toFixed(2)}%)`; }
  else                      { signals.dividend = 'No Dividend'; }

  // ── Trend (price vs moving averages) ──
  if (chart.sma50 != null) {
    if (chart.price > chart.sma50) {
      score += 0.5;
      signals.trend50d = 'Above 50-day MA';
    } else {
      score -= 0.5;
      signals.trend50d = 'Below 50-day MA';
    }
  }

  if (chart.sma200 != null) {
    if (chart.price > chart.sma200) {
      score += 0.5;
      signals.trend200d = 'Above 200-day MA';
    } else {
      score -= 0.5;
      signals.trend200d = 'Below 200-day MA';
    }
  }

  // Clamp to 1-10
  score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));

  // Label
  let label;
  if (score >= 8)        label = 'Strong Buy';
  else if (score >= 6.5) label = 'Buy';
  else if (score >= 5.5) label = 'Hold';
  else if (score >= 4)   label = 'Weak';
  else                    label = 'Avoid';

  return { score, label, signals };
}

// ═══════════════════════════════════════════════════
// Analyze a Single Symbol
// ═══════════════════════════════════════════════════

async function analyzeSymbol(symbol) {
  // Phase 1: Fetch chart data (always needed)
  const chart = await fetchChartData(symbol);
  if (!chart || chart.price <= 0) return null;

  // Phase 2: Fetch quoteSummary (may fail for some symbols)
  let fundamentals;
  try {
    fundamentals = await fetchQuoteSummary(symbol);
  } catch {
    fundamentals = null;
  }

  // Use defaults if quoteSummary failed
  if (!fundamentals) {
    fundamentals = {
      pe: 0, forwardPE: 0, eps: 0, dividendYield: 0,
      marketCap: 0, profitMargin: 0, returnOnEquity: 0,
      debtToEquity: -1, revenueGrowth: 0, sector: 'Unknown',
    };
  }

  // Phase 3: Score
  const { score, label, signals } = computeFundamentalScore(chart, fundamentals);

  return {
    symbol,
    name: chart.name,
    sector: fundamentals.sector,
    price: chart.price,
    return1Y: chart.return1Y,
    return6M: chart.return6M,
    dailyChange: chart.dailyChange,
    marketCap: fundamentals.marketCap,
    pe: fundamentals.pe,
    forwardPE: fundamentals.forwardPE,
    eps: fundamentals.eps,
    dividendYield: Math.round(fundamentals.dividendYield * 100) / 100,
    profitMargin: Math.round(fundamentals.profitMargin * 100) / 100,
    returnOnEquity: Math.round(fundamentals.returnOnEquity * 100) / 100,
    debtToEquity: Math.round(fundamentals.debtToEquity * 100) / 100,
    fundamentalScore: score,
    overallLabel: label,
    signals,
  };
}

// ═══════════════════════════════════════════════════
// Main Export — runFundamentalsScan
// ═══════════════════════════════════════════════════

let lastScanTime = 0;

/**
 * Run a full fundamentals scan of all symbols.
 * Updates store.fundamentals with scored results.
 *
 * @param {Function} getStore - returns the data store object
 * @param {Function} persist  - saves the store to disk
 */
async function runFundamentalsScan(getStore, persist) {
  // ── Cache guard ──
  const now = Date.now();
  if (now - lastScanTime < SCAN_CACHE_MS) {
    const secsLeft = Math.round((SCAN_CACHE_MS - (now - lastScanTime)) / 1000);
    console.log(`[Fundamentals] Scan cached — next scan available in ${secsLeft}s`);
    return;
  }

  const startTime = Date.now();
  console.log('[Fundamentals] ══════════════════════════════════════════');
  console.log(`[Fundamentals] Starting fundamentals scan of ${SYMBOLS.length} symbols...`);
  console.log('[Fundamentals] ══════════════════════════════════════════');

  const results = [];

  // Process in batches of BATCH_SIZE with delay between batches
  for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
    const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((sym) => analyzeSymbol(sym)));
    for (const r of batchResults) {
      if (r) results.push(r);
    }

    // Progress log every few batches
    if ((i / BATCH_SIZE) % 4 === 0 || i + BATCH_SIZE >= SYMBOLS.length) {
      console.log(`[Fundamentals]   Processed ${Math.min(i + BATCH_SIZE, SYMBOLS.length)}/${SYMBOLS.length} symbols...`);
    }

    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < SYMBOLS.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Sort by fundamental score descending
  results.sort((a, b) => b.fundamentalScore - a.fundamentalScore);

  const scanTimeMs = Date.now() - startTime;

  // ── Persist to store ──
  const store = getStore();
  const timestamp = new Date().toISOString();

  const enriched = results.map((r) => ({
    ...r,
    updatedAt: timestamp,
  }));
  store.fundamentals.length = 0;
  store.fundamentals.push(...enriched);

  persist();
  lastScanTime = Date.now();

  // ── Summary log ──
  const strongBuys = results.filter((r) => r.overallLabel === 'Strong Buy').length;
  const buys = results.filter((r) => r.overallLabel === 'Buy').length;
  const holds = results.filter((r) => r.overallLabel === 'Hold').length;
  const weak = results.filter((r) => r.overallLabel === 'Weak').length;
  const avoids = results.filter((r) => r.overallLabel === 'Avoid').length;

  const elapsed = (scanTimeMs / 1000).toFixed(1);
  console.log('[Fundamentals] ══════════════════════════════════════════');
  console.log(`[Fundamentals] Scan complete in ${elapsed}s`);
  console.log(`[Fundamentals]   Total analyzed: ${results.length}`);
  console.log(`[Fundamentals]   Strong Buy: ${strongBuys} | Buy: ${buys} | Hold: ${holds} | Weak: ${weak} | Avoid: ${avoids}`);
  for (const r of results.slice(0, 5)) {
    console.log(`[Fundamentals]   ${r.overallLabel.padEnd(11)} | ${r.symbol.padEnd(6)} | score ${r.fundamentalScore} | $${r.price} | PE ${r.pe || 'N/A'} | margin ${r.profitMargin}%`);
  }
  if (results.length > 5) {
    console.log(`[Fundamentals]   ... and ${results.length - 5} more`);
  }
  console.log('[Fundamentals] ══════════════════════════════════════════');

  return {
    total: results.length,
    strongBuys,
    buys,
    holds,
    weak,
    avoids,
    timeMs: scanTimeMs,
  };
}

module.exports = { runFundamentalsScan, SYMBOLS };

// ═══════════════════════════════════════════
// Fundamentals Service — Long-Term Stock Analysis
// Uses Yahoo Finance quoteSummary for all fundamental data
// One API call per symbol — no UW rate limit issues
// Scores stocks 1-10 on combined fundamentals
//
// CommonJS server-side port of the mobile app's
// src/data/fundamentalsService.js. Scoring logic is identical.
// Uses Node 18+ global fetch and YAHOO_HEADERS from ./config.
// ═══════════════════════════════════════════

const { YAHOO_HEADERS } = require('./config');

// ─── Curated Long-Term Stock Universe ───
const LONG_TERM_UNIVERSE = [
  // Mega cap tech
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'ADBE',
  // Financials
  'JPM', 'V', 'MA', 'BAC', 'GS', 'BRK-B',
  // Healthcare
  'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'PFE',
  // Consumer
  'WMT', 'COST', 'PG', 'KO', 'PEP', 'NKE', 'MCD',
  // Industrial / Energy
  'CAT', 'GE', 'XOM', 'CVX', 'NEE',
  // Growth
  'NFLX', 'AMD', 'TSLA', 'SHOP', 'PLTR', 'COIN', 'SQ',
];

// ── Yahoo crumb/cookie auth (v7 now requires it) ──
let _yahooCrumb = null;
let _yahooCookie = null;
let _crumbFetched = false;

async function getYahooCrumb() {
  if (_crumbFetched) return { crumb: _yahooCrumb, cookie: _yahooCookie };
  _crumbFetched = true;
  try {
    // Step 1: hit consent page to get cookies
    const consentRes = await fetch('https://fc.yahoo.com/', {
      headers: YAHOO_HEADERS,
      redirect: 'manual',
    });
    const setCookies = consentRes.headers?.get('set-cookie') || '';
    _yahooCookie = setCookies.split(';')[0] || '';

    // Step 2: fetch crumb using the cookie
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        ...YAHOO_HEADERS,
        'Cookie': _yahooCookie,
      },
    });
    if (crumbRes.ok) {
      _yahooCrumb = await crumbRes.text();
      console.log(`[Fund] Yahoo crumb obtained: ${_yahooCrumb ? 'yes' : 'no'}`);
    }
  } catch (e) {
    console.log(`[Fund] Crumb fetch failed: ${e.message}`);
  }
  return { crumb: _yahooCrumb, cookie: _yahooCookie };
}

/**
 * Fetch fundamentals for a single stock using Yahoo v10/quoteSummary + v8/chart
 * All data comes from these two endpoints — no v7 needed.
 */
async function fetchFundamentals(symbol) {
  try {
    const pf = (v) => {
      if (v == null) return 0;
      if (typeof v === 'object' && v.raw != null) return parseFloat(v.raw) || 0;
      return parseFloat(v) || 0;
    };

    // ── Fetch Yahoo chart for price + 1Y returns ──
    let price = 0, prevClose = 0, return1Y = 0, return6M = 0;
    let name = '', fiftyDayAvg = 0, twoHundredDayAvg = 0;

    try {
      const chartRes = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1mo`,
        { headers: YAHOO_HEADERS }
      );
      if (chartRes.ok) {
        const chartJson = await chartRes.json();
        const meta = chartJson?.chart?.result?.[0]?.meta || {};
        const closes = chartJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        price = meta.regularMarketPrice || 0;
        prevClose = meta.chartPreviousClose || meta.previousClose || price;
        fiftyDayAvg = meta.fiftyDayAverage || 0;
        twoHundredDayAvg = meta.twoHundredDayAverage || 0;
        name = meta.shortName || meta.longName || symbol;

        const validCloses = closes.filter((c) => c != null && c > 0);
        if (validCloses.length > 0 && price > 0) {
          const yearAgoPrice = validCloses[0];
          return1Y = yearAgoPrice > 0 ? ((price - yearAgoPrice) / yearAgoPrice) * 100 : 0;
          const sixMonthIdx = Math.max(0, Math.floor(validCloses.length / 2));
          const sixMonthPrice = validCloses[sixMonthIdx] || yearAgoPrice;
          return6M = sixMonthPrice > 0 ? ((price - sixMonthPrice) / sixMonthPrice) * 100 : 0;
        }
      }
    } catch {}

    if (price <= 0) return null;

    // ── Fetch quoteSummary for ALL fundamentals (PE, EPS, margins, etc.) ──
    let pe = 0, forwardPE = 0, eps = 0, epsForward = 0, marketCap = 0;
    let dividendYield = 0, priceToBook = 0, beta = 1;
    let profitMargin = 0, debtToEquity = 0, returnOnEquity = 0, revenue = 0;
    let revenueGrowth = 0;
    let sector = '', industry = '', analystRating = '', earningsDate = '';

    // Try quoteSummary with expanded modules for ALL fundamental data
    const modules = 'summaryDetail,defaultKeyStatistics,financialData,summaryProfile,calendarEvents';
    const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];

    for (const host of hosts) {
      try {
        const { crumb, cookie } = await getYahooCrumb();
        const crumbParam = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
        const headers = { ...YAHOO_HEADERS };
        if (cookie) headers['Cookie'] = cookie;

        const summaryRes = await fetch(
          `https://${host}/v10/finance/quoteSummary/${symbol}?modules=${modules}${crumbParam}`,
          { headers }
        );

        if (!summaryRes.ok) {
          console.log(`[Fund] ${symbol} quoteSummary ${host}: ${summaryRes.status}`);
          continue;
        }

        const sJson = await summaryRes.json();
        const r = sJson?.quoteSummary?.result?.[0];
        if (!r) continue;

        const sd = r.summaryDetail || {};
        const ks = r.defaultKeyStatistics || {};
        const fd = r.financialData || {};
        const sp = r.summaryProfile || {};
        const cal = r.calendarEvents || {};

        // ── PE & EPS from summaryDetail + defaultKeyStatistics ──
        pe = pf(sd.trailingPE) || pf(fd.currentPrice) / (pf(ks.trailingEps) || 1) || 0;
        forwardPE = pf(sd.forwardPE) || pf(ks.forwardPE) || 0;
        eps = pf(ks.trailingEps) || 0;
        epsForward = pf(ks.forwardEps) || 0;

        // ── Market Cap ──
        marketCap = pf(sd.marketCap) || 0;

        // ── Dividend Yield ──
        dividendYield = pf(sd.dividendYield) || pf(sd.trailingAnnualDividendYield) || 0;
        if (dividendYield > 0 && dividendYield < 1) dividendYield *= 100;

        // ── Price to Book & Beta ──
        priceToBook = pf(sd.priceToBook) || pf(ks.priceToBook) || 0;
        beta = pf(sd.beta) || pf(ks.beta3Year) || 1;

        // ── Profitability from financialData ──
        profitMargin = pf(fd.profitMargins) || pf(ks.profitMargins) || 0;
        if (profitMargin > 0 && profitMargin < 1) profitMargin *= 100;
        if (profitMargin < 0 && profitMargin > -1) profitMargin *= 100;

        debtToEquity = pf(fd.debtToEquity) || 0;

        returnOnEquity = pf(fd.returnOnEquity) || 0;
        if (returnOnEquity > 0 && returnOnEquity < 1) returnOnEquity *= 100;
        if (returnOnEquity < 0 && returnOnEquity > -1) returnOnEquity *= 100;

        revenue = pf(fd.totalRevenue) || 0;

        const rg = pf(fd.revenueGrowth) || 0;
        revenueGrowth = (rg !== 0 && Math.abs(rg) < 1) ? rg * 100 : rg;

        // ── EPS growth as fallback for revenue growth ──
        if (revenueGrowth === 0 && eps > 0 && epsForward > 0) {
          revenueGrowth = ((epsForward - eps) / Math.abs(eps)) * 100;
        }

        analystRating = fd.recommendationKey || '';
        sector = sp.sector || '';
        industry = sp.industry || '';

        if (cal.earnings?.earningsDate) {
          const dates = cal.earnings.earningsDate;
          const dateVal = Array.isArray(dates) ? dates[0] : dates;
          earningsDate = dateVal?.fmt || '';
        }

        // Got data, stop trying hosts
        break;
      } catch (e) {
        console.log(`[Fund] ${symbol} quoteSummary error (${host}): ${e.message}`);
      }
    }

    // ── Moving average signals from chart ──
    if (!fiftyDayAvg) fiftyDayAvg = 0;
    if (!twoHundredDayAvg) twoHundredDayAvg = 0;
    const aboveFiftyDay = fiftyDayAvg > 0 ? price > fiftyDayAvg : null;
    const aboveTwoHundredDay = twoHundredDayAvg > 0 ? price > twoHundredDayAvg : null;

    const gotData = pe > 0 || profitMargin !== 0 || eps !== 0;
    console.log(`[Fund] ${symbol} ${gotData ? '✓' : '⚠'} PE=${pe.toFixed(1)} PM=${profitMargin.toFixed(1)}% ROE=${returnOnEquity.toFixed(1)}%`);

    return {
      symbol,
      name: name || symbol,
      sector,
      industry,
      price,
      return1Y,
      return6M,
      dailyChange: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      marketCap,
      pe,
      forwardPE,
      eps,
      epsForward,
      dividendYield,
      priceToBook,
      profitMargin,
      debtToEquity,
      returnOnEquity,
      revenueGrowth,
      revenue,
      beta,
      aboveFiftyDay,
      aboveTwoHundredDay,
      earningsDate,
      analystRating,
      earningsHistory: null,
      dividendHistory: null,
    };
  } catch (err) {
    console.log(`[Fund] ${symbol} error: ${err.message}`);
    return null;
  }
}

/**
 * Score a stock's fundamentals from 1-10
 */
function scoreFundamentals(stock) {
  let score = 5;
  const signals = {};

  // ── Valuation (P/E) ──
  const pe = stock.pe;
  let valScore = 0;
  if (pe > 0 && pe < 15) valScore = 2;
  else if (pe >= 15 && pe < 25) valScore = 1;
  else if (pe >= 25 && pe < 40) valScore = 0;
  else if (pe >= 40 && pe < 80) valScore = -0.5;
  else if (pe >= 80) valScore = -1;
  score += valScore;
  signals.valuation = {
    score: valScore,
    label: pe > 0 ? (pe < 15 ? 'Undervalued' : pe < 25 ? 'Fair Value' : pe < 50 ? 'Growth Premium' : 'Expensive') : 'N/A',
    value: pe > 0 ? pe.toFixed(1) : 'N/A',
    signal: valScore > 0 ? 'bullish' : valScore < 0 ? 'bearish' : 'neutral',
  };

  // ── Growth (1Y Return + Revenue Growth) ──
  let growthScore = 0;
  if (stock.return1Y > 50) growthScore = 2;
  else if (stock.return1Y > 20) growthScore = 1.5;
  else if (stock.return1Y > 5) growthScore = 0.5;
  else if (stock.return1Y < -20) growthScore = -1.5;
  else if (stock.return1Y < -5) growthScore = -0.5;

  // Bonus for revenue growth
  if (stock.revenueGrowth > 20) growthScore += 0.5;
  else if (stock.revenueGrowth < -10) growthScore -= 0.5;

  score += growthScore;
  signals.growth = {
    score: growthScore,
    label: stock.return1Y > 30 ? 'Strong Growth' : stock.return1Y > 10 ? 'Growing' : stock.return1Y > 0 ? 'Modest' : 'Declining',
    value: `${stock.return1Y > 0 ? '+' : ''}${stock.return1Y.toFixed(1)}%`,
    signal: growthScore > 0 ? 'bullish' : growthScore < 0 ? 'bearish' : 'neutral',
  };

  // ── Profitability (Margins + ROE) ──
  let profitScore = 0;
  if (stock.profitMargin > 25) profitScore = 1.5;
  else if (stock.profitMargin > 15) profitScore = 1;
  else if (stock.profitMargin > 5) profitScore = 0.5;
  else if (stock.profitMargin < 0) profitScore = -1;
  if (stock.returnOnEquity > 20) profitScore += 0.5;
  score += profitScore;
  signals.profitability = {
    score: profitScore,
    label: stock.profitMargin > 20 ? 'High Margin' : stock.profitMargin > 10 ? 'Good Margin' : stock.profitMargin > 0 ? 'Thin Margin' : 'Unprofitable',
    value: stock.profitMargin > 0 ? `${stock.profitMargin.toFixed(1)}%` : 'N/A',
    signal: profitScore > 0 ? 'bullish' : profitScore < 0 ? 'bearish' : 'neutral',
  };

  // ── Financial Health (Debt/Equity) ──
  let healthScore = 0;
  if (stock.debtToEquity > 0 && stock.debtToEquity < 50) healthScore = 1;
  else if (stock.debtToEquity >= 50 && stock.debtToEquity < 100) healthScore = 0.5;
  else if (stock.debtToEquity >= 100 && stock.debtToEquity < 200) healthScore = 0;
  else if (stock.debtToEquity >= 200) healthScore = -1;
  score += healthScore;
  signals.health = {
    score: healthScore,
    label: stock.debtToEquity > 0 ? (stock.debtToEquity < 50 ? 'Low Debt' : stock.debtToEquity < 100 ? 'Moderate' : 'High Debt') : 'N/A',
    value: stock.debtToEquity > 0 ? `${stock.debtToEquity.toFixed(0)}%` : 'N/A',
    signal: healthScore > 0 ? 'bullish' : healthScore < 0 ? 'bearish' : 'neutral',
  };

  // ── Dividend ──
  let divScore = 0;
  if (stock.dividendYield > 3) divScore = 1;
  else if (stock.dividendYield > 1.5) divScore = 0.5;
  score += divScore;
  signals.dividend = {
    score: divScore,
    label: stock.dividendYield > 3 ? 'Strong Yield' : stock.dividendYield > 1 ? 'Pays Dividend' : 'No/Low Div',
    value: stock.dividendYield > 0 ? `${stock.dividendYield.toFixed(2)}%` : '—',
    signal: divScore > 0 ? 'bullish' : 'neutral',
  };

  // ── Trend (Price vs MAs) ──
  let trendScore = 0;
  if (stock.aboveFiftyDay === true) trendScore += 0.5;
  if (stock.aboveFiftyDay === false) trendScore -= 0.5;
  if (stock.aboveTwoHundredDay === true) trendScore += 0.5;
  if (stock.aboveTwoHundredDay === false) trendScore -= 0.5;
  score += trendScore;
  signals.trend = {
    score: trendScore,
    label: trendScore > 0.5 ? 'Uptrend' : trendScore < -0.5 ? 'Downtrend' : 'Mixed',
    value: stock.aboveTwoHundredDay ? 'Above 200D' : 'Below 200D',
    signal: trendScore > 0 ? 'bullish' : trendScore < 0 ? 'bearish' : 'neutral',
  };

  // Clamp to 1-10
  score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));

  let overallLabel;
  if (score >= 8) overallLabel = 'Strong Buy';
  else if (score >= 6.5) overallLabel = 'Buy';
  else if (score >= 5.5) overallLabel = 'Hold';
  else if (score >= 4) overallLabel = 'Weak';
  else overallLabel = 'Avoid';

  const bullishCount = Object.values(signals).filter((s) => s.signal === 'bullish').length;
  const bearishCount = Object.values(signals).filter((s) => s.signal === 'bearish').length;

  return {
    ...stock,
    fundamentalScore: score,
    overallLabel,
    signals,
    bullishCount,
    bearishCount,
  };
}

/**
 * Analyze all long-term stocks and return ranked results
 * Uses v8/chart + v10/quoteSummary per symbol (no v7 — it requires auth now)
 */
async function analyzeLongTermStocks(onProgress) {
  const results = [];

  // Pre-fetch Yahoo crumb once before looping
  await getYahooCrumb();
  console.log(`[Fund] Starting analysis of ${LONG_TERM_UNIVERSE.length} symbols...`);

  // Process in batches of 3 (each symbol makes 2 API calls: chart + quoteSummary)
  const batchSize = 3;
  for (let i = 0; i < LONG_TERM_UNIVERSE.length; i += batchSize) {
    const batch = LONG_TERM_UNIVERSE.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (sym) => {
        const data = await fetchFundamentals(sym);
        return data ? scoreFundamentals(data) : null;
      })
    );

    batchResults.forEach((r) => { if (r) results.push(r); });

    if (onProgress) {
      onProgress(Math.min(100, Math.round(((i + batchSize) / LONG_TERM_UNIVERSE.length) * 100)));
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < LONG_TERM_UNIVERSE.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`[Fund] Analysis complete: ${results.length}/${LONG_TERM_UNIVERSE.length} stocks scored`);
  results.sort((a, b) => b.fundamentalScore - a.fundamentalScore);
  return results;
}

/** Format market cap */
function formatMarketCapFund(val) {
  if (!val) return '—';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(0)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

/** Get color for fundamental score */
function getFundScoreColor(score) {
  if (score >= 8) return '#00E396';
  if (score >= 6.5) return '#7BA7FF';
  if (score >= 5.5) return '#FEB019';
  if (score >= 4) return '#FF8C00';
  return '#FF4560';
}

module.exports = {
  analyzeLongTermStocks,
  formatMarketCapFund,
  getFundScoreColor,
  fetchFundamentals,
  scoreFundamentals,
  getYahooCrumb,
  LONG_TERM_UNIVERSE,
};

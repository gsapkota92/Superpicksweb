// ═══════════════════════════════════════════════════
// Market Sentiment — Greed/Fear gauge
// Uses major index ETF option flow estimates + price action
// ═══════════════════════════════════════════════════

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const INDICES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq 100' },
  { symbol: 'DIA', name: 'Dow Jones' },
  { symbol: 'IWM', name: 'Russell 2000' },
];

const SECTORS = [
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLV', name: 'Healthcare' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLY', name: 'Consumer Disc.' },
  { symbol: 'XLP', name: 'Consumer Staples' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLU', name: 'Utilities' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLC', name: 'Communication' },
];

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchQuote(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`,
      { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter((c) => c != null && c > 0);

    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    // 5-day trend
    let trend = 0;
    if (validCloses.length >= 2) {
      const first = validCloses[0];
      const last = validCloses[validCloses.length - 1];
      trend = first > 0 ? ((last - first) / first) * 100 : 0;
    }

    return { price, change, trend, name: meta.shortName || symbol };
  } catch {
    return null;
  }
}

async function computeSentiment() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  // Fetch index data
  const indexResults = await Promise.all(INDICES.map(async (idx) => {
    const data = await fetchQuote(idx.symbol);
    return { ...idx, ...data };
  }));

  // Fetch sector data
  const sectorResults = await Promise.all(SECTORS.map(async (sec) => {
    const data = await fetchQuote(sec.symbol);
    return { ...sec, ...data };
  }));

  // Compute sentiment score (0-100 scale, 50 = neutral)
  let sentimentScore = 50;
  let positiveIndices = 0;

  for (const idx of indexResults) {
    if (!idx.price) continue;
    if (idx.change > 1) sentimentScore += 4;
    else if (idx.change > 0.3) sentimentScore += 2;
    else if (idx.change > 0) sentimentScore += 1;
    else if (idx.change < -1) sentimentScore -= 4;
    else if (idx.change < -0.3) sentimentScore -= 2;
    else if (idx.change < 0) sentimentScore -= 1;

    if (idx.trend > 2) sentimentScore += 3;
    else if (idx.trend > 0) sentimentScore += 1;
    else if (idx.trend < -2) sentimentScore -= 3;
    else if (idx.trend < 0) sentimentScore -= 1;

    if (idx.change > 0) positiveIndices++;
  }

  // Breadth bonus
  if (positiveIndices === 4) sentimentScore += 5;
  else if (positiveIndices === 0) sentimentScore -= 5;

  // Sector breadth
  const positiveSectors = sectorResults.filter((s) => s.change > 0).length;
  const sectorBreadth = sectorResults.length > 0 ? positiveSectors / sectorResults.length : 0.5;
  sentimentScore += (sectorBreadth - 0.5) * 10;

  sentimentScore = Math.max(0, Math.min(100, Math.round(sentimentScore)));

  let label, zone;
  if (sentimentScore >= 75) { label = 'Extreme Greed'; zone = 'extreme-greed'; }
  else if (sentimentScore >= 60) { label = 'Greed'; zone = 'greed'; }
  else if (sentimentScore >= 40) { label = 'Neutral'; zone = 'neutral'; }
  else if (sentimentScore >= 25) { label = 'Fear'; zone = 'fear'; }
  else { label = 'Extreme Fear'; zone = 'extreme-fear'; }

  _cache = {
    score: sentimentScore,
    label,
    zone,
    indices: indexResults.filter((i) => i.price > 0).map((i) => ({
      symbol: i.symbol, name: i.name, price: Math.round(i.price * 100) / 100,
      change: Math.round(i.change * 100) / 100, trend: Math.round(i.trend * 100) / 100,
    })),
    sectors: sectorResults.filter((s) => s.price > 0).map((s) => ({
      symbol: s.symbol, name: s.name, price: Math.round(s.price * 100) / 100,
      change: Math.round(s.change * 100) / 100,
    })).sort((a, b) => b.change - a.change),
    breadth: {
      positive_indices: positiveIndices,
      total_indices: INDICES.length,
      positive_sectors: positiveSectors,
      total_sectors: SECTORS.length,
    },
    updatedAt: new Date().toISOString(),
  };
  _cacheTime = Date.now();

  console.log(`[Sentiment] Score: ${sentimentScore} → ${label} (${positiveIndices}/${INDICES.length} indices up, ${positiveSectors}/${SECTORS.length} sectors up)`);
  return _cache;
}

module.exports = { computeSentiment };

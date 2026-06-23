// ═══════════════════════════════════════════════════════════════════
// Stock Screener Service — Powered by Unusual Whales API
// Uses UW /screener/stocks, /screener/option-contracts, /screener/analysts
// Enriched with IV rank, unusual activity, flow data
// Falls back to curated universe + Yahoo prices if UW screener unavailable
//
// CommonJS port of src/data/screenerService.js for the Node web server.
// React Native / React / expo / AsyncStorage stripped. Uses Node global
// fetch. All filter / numeric / result-shaping logic preserved EXACTLY.
// ═══════════════════════════════════════════════════════════════════

const { UW_CONFIG } = require('./config');
// Shared UW access layer (required per server architecture; the screener
// keeps its own private uwFetch below to preserve exact original behavior).
const unusualWhalesService = require('./unusualWhalesService'); // eslint-disable-line no-unused-vars

const UW_BASE = UW_CONFIG.BASE_URL;
const UW_HEADERS = {
  Accept: 'application/json',
  Authorization: `Bearer ${UW_CONFIG.API_KEY}`,
  'UW-CLIENT-API-ID': '100001',
};

async function uwFetch(path) {
  try {
    const url = `${UW_BASE}${path}`;
    const res = await fetch(url, { headers: UW_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? json;
  } catch {
    return null;
  }
}

// ─── Curated fallback universe (used when UW screener returns nothing) ───

const STOCK_DATA = [
  { symbol: 'NVDA', name: 'NVIDIA', pe: 58.2, marketCap: 2800e9, sector: 'Tech' },
  { symbol: 'TSLA', name: 'Tesla', pe: 64.5, marketCap: 780e9, sector: 'Auto' },
  { symbol: 'AMZN', name: 'Amazon', pe: 61.3, marketCap: 1950e9, sector: 'Tech' },
  { symbol: 'AAPL', name: 'Apple', pe: 32.8, marketCap: 3100e9, sector: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', pe: 35.1, marketCap: 3050e9, sector: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet', pe: 25.4, marketCap: 2100e9, sector: 'Tech' },
  { symbol: 'META', name: 'Meta', pe: 26.8, marketCap: 1300e9, sector: 'Tech' },
  { symbol: 'AVGO', name: 'Broadcom', pe: 88.5, marketCap: 820e9, sector: 'Semi' },
  { symbol: 'LLY', name: 'Eli Lilly', pe: 92.3, marketCap: 750e9, sector: 'Health' },
  { symbol: 'NFLX', name: 'Netflix', pe: 48.6, marketCap: 380e9, sector: 'Media' },
  { symbol: 'CRM', name: 'Salesforce', pe: 46.2, marketCap: 260e9, sector: 'Tech' },
  { symbol: 'AMD', name: 'AMD', pe: 42.1, marketCap: 210e9, sector: 'Semi' },
  { symbol: 'COST', name: 'Costco', pe: 52.4, marketCap: 370e9, sector: 'Retail' },
  { symbol: 'NOW', name: 'ServiceNow', pe: 72.1, marketCap: 180e9, sector: 'Tech' },
  { symbol: 'PLTR', name: 'Palantir', pe: 190.5, marketCap: 135e9, sector: 'Tech' },
  { symbol: 'PANW', name: 'Palo Alto', pe: 48.9, marketCap: 110e9, sector: 'Cyber' },
  { symbol: 'CRWD', name: 'CrowdStrike', pe: 420.0, marketCap: 85e9, sector: 'Cyber' },
  { symbol: 'SHOP', name: 'Shopify', pe: 68.2, marketCap: 95e9, sector: 'Tech' },
  { symbol: 'SNOW', name: 'Snowflake', pe: null, marketCap: 52e9, sector: 'Tech' },
  { symbol: 'ABNB', name: 'Airbnb', pe: 38.4, marketCap: 82e9, sector: 'Travel' },
  { symbol: 'UBER', name: 'Uber', pe: 36.1, marketCap: 150e9, sector: 'Transport' },
  { symbol: 'DASH', name: 'DoorDash', pe: null, marketCap: 62e9, sector: 'Transport' },
  { symbol: 'COIN', name: 'Coinbase', pe: 22.3, marketCap: 45e9, sector: 'Crypto' },
  { symbol: 'SQ', name: 'Block', pe: 54.8, marketCap: 40e9, sector: 'Fintech' },
  { symbol: 'DDOG', name: 'Datadog', pe: 250.0, marketCap: 42e9, sector: 'Tech' },
  { symbol: 'NET', name: 'Cloudflare', pe: 210.0, marketCap: 35e9, sector: 'Tech' },
  { symbol: 'ZS', name: 'Zscaler', pe: 195.0, marketCap: 28e9, sector: 'Cyber' },
  { symbol: 'TTD', name: 'Trade Desk', pe: 135.0, marketCap: 48e9, sector: 'AdTech' },
  { symbol: 'MELI', name: 'MercadoLibre', pe: 62.5, marketCap: 88e9, sector: 'E-comm' },
  { symbol: 'LULU', name: 'Lululemon', pe: 28.3, marketCap: 38e9, sector: 'Retail' },
  { symbol: 'CMG', name: 'Chipotle', pe: 51.2, marketCap: 72e9, sector: 'Food' },
  { symbol: 'BKNG', name: 'Booking', pe: 31.5, marketCap: 155e9, sector: 'Travel' },
  { symbol: 'SPOT', name: 'Spotify', pe: 95.0, marketCap: 82e9, sector: 'Media' },
  { symbol: 'RBLX', name: 'Roblox', pe: null, marketCap: 32e9, sector: 'Gaming' },
  { symbol: 'MSTR', name: 'MicroStrat', pe: null, marketCap: 45e9, sector: 'Crypto' },
  { symbol: 'HOOD', name: 'Robinhood', pe: 18.5, marketCap: 22e9, sector: 'Fintech' },
  { symbol: 'SOFI', name: 'SoFi', pe: 85.0, marketCap: 15e9, sector: 'Fintech' },
  { symbol: 'JPM', name: 'JPMorgan', pe: 12.1, marketCap: 620e9, sector: 'Finance' },
  { symbol: 'V', name: 'Visa', pe: 30.5, marketCap: 570e9, sector: 'Finance' },
  { symbol: 'MA', name: 'Mastercard', pe: 34.2, marketCap: 430e9, sector: 'Finance' },
  { symbol: 'GS', name: 'Goldman', pe: 14.8, marketCap: 160e9, sector: 'Finance' },
  { symbol: 'BAC', name: 'Bank of Am', pe: 12.5, marketCap: 310e9, sector: 'Finance' },
  { symbol: 'WMT', name: 'Walmart', pe: 36.8, marketCap: 590e9, sector: 'Retail' },
  { symbol: 'HD', name: 'Home Depot', pe: 24.6, marketCap: 370e9, sector: 'Retail' },
  { symbol: 'PG', name: 'P&G', pe: 27.2, marketCap: 390e9, sector: 'Consumer' },
  { symbol: 'KO', name: 'Coca-Cola', pe: 26.5, marketCap: 270e9, sector: 'Consumer' },
  { symbol: 'MRK', name: 'Merck', pe: 14.2, marketCap: 260e9, sector: 'Health' },
  { symbol: 'ABBV', name: 'AbbVie', pe: 15.8, marketCap: 310e9, sector: 'Health' },
  { symbol: 'UNH', name: 'UnitedHealth', pe: 19.5, marketCap: 480e9, sector: 'Health' },
  { symbol: 'XOM', name: 'Exxon', pe: 13.8, marketCap: 460e9, sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron', pe: 14.5, marketCap: 280e9, sector: 'Energy' },
  { symbol: 'BA', name: 'Boeing', pe: null, marketCap: 140e9, sector: 'Defense' },
  { symbol: 'CAT', name: 'Caterpillar', pe: 17.2, marketCap: 175e9, sector: 'Indust.' },
  { symbol: 'GE', name: 'GE Aero', pe: 38.5, marketCap: 195e9, sector: 'Indust.' },
  { symbol: 'RTX', name: 'RTX Corp', pe: 33.6, marketCap: 155e9, sector: 'Defense' },
  { symbol: 'ORCL', name: 'Oracle', pe: 37.8, marketCap: 390e9, sector: 'Tech' },
  { symbol: 'INTC', name: 'Intel', pe: null, marketCap: 105e9, sector: 'Semi' },
  { symbol: 'QCOM', name: 'Qualcomm', pe: 17.5, marketCap: 185e9, sector: 'Semi' },
  { symbol: 'AMAT', name: 'Applied Mat', pe: 21.3, marketCap: 150e9, sector: 'Semi' },
  { symbol: 'NKE', name: 'Nike', pe: 22.8, marketCap: 110e9, sector: 'Consumer' },
];

// ─── UW-Powered Screeners ───

/**
 * Fetch stock screener results from UW API
 * Returns stocks with options flow, IV, and fundamental data
 */
async function screenUWStocks() {
  const data = await uwFetch('/screener/stocks');
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  return data.map((d) => ({
    symbol: d.ticker || d.symbol || '',
    name: d.name || d.company_name || '',
    sector: d.sector || '',
    industry: d.industry || '',
    price: parseFloat(d.price || d.last_price || d.close) || 0,
    change: parseFloat(d.change_percent || d.day_change || d.pct_change) || 0,
    volume: parseInt(d.volume || d.avg_volume) || 0,
    marketCap: parseFloat(d.market_cap || d.marketcap) || 0,
    pe: parseFloat(d.pe_ratio || d.pe || d.trailing_pe) || null,
    ivRank: parseFloat(d.iv_rank) || null,
    ivPercentile: parseFloat(d.iv_percentile) || null,
    optionsVolume: parseInt(d.options_volume || d.total_options_volume) || 0,
    putCallRatio: parseFloat(d.put_call_ratio || d.pc_ratio) || null,
    shortInterest: parseFloat(d.short_interest || d.si_percent) || null,
    earningsDate: d.earnings_date || d.next_earnings || null,
    analystRating: d.analyst_rating || d.consensus || null,
    unusualActivity: d.has_unusual_activity || d.unusual || false,
  })).filter((s) => s.symbol);
}

/**
 * Fetch hottest option contracts from UW screener
 */
async function screenUWOptions() {
  const data = await uwFetch('/screener/option-contracts');
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  return data.map((d) => ({
    symbol: d.ticker || d.underlying_symbol || d.symbol || '',
    type: (d.put_call || d.option_type || 'CALL').toUpperCase(),
    strike: parseFloat(d.strike || d.strike_price) || 0,
    expiry: d.expiration_date || d.expires || '',
    premium: parseFloat(d.total_premium || d.premium || d.cost_basis) || 0,
    volume: parseInt(d.volume || d.trade_count) || 0,
    openInterest: parseInt(d.open_interest || d.oi) || 0,
    iv: parseFloat(d.implied_volatility || d.iv) || 0,
    isSweep: d.is_sweep || d.option_activity_type === 'SWEEP',
    isBlock: d.is_block || d.option_activity_type === 'BLOCK',
    sentiment: d.sentiment || d.trade_sentiment || '',
    underlyingPrice: parseFloat(d.underlying_price || d.stock_price) || 0,
  })).filter((o) => o.symbol);
}

/**
 * Fetch analyst ratings from UW screener
 */
async function screenUWAnalysts() {
  const data = await uwFetch('/screener/analysts');
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  return data.map((d) => ({
    symbol: d.ticker || d.symbol || '',
    name: d.name || d.company_name || '',
    rating: d.rating || d.consensus || d.analyst_rating || '',
    priceTarget: parseFloat(d.price_target || d.avg_price_target || d.target) || 0,
    currentPrice: parseFloat(d.price || d.current_price || d.last) || 0,
    upside: parseFloat(d.upside || d.upside_percent) || 0,
    numAnalysts: parseInt(d.num_analysts || d.analyst_count) || 0,
    buys: parseInt(d.buy_count || d.strong_buy) || 0,
    holds: parseInt(d.hold_count || d.hold) || 0,
    sells: parseInt(d.sell_count || d.strong_sell) || 0,
  })).filter((a) => a.symbol);
}

/**
 * Fetch market movers from UW
 */
async function getUWMovers() {
  const data = await uwFetch('/market/movers');
  if (!data) return null;
  const normalize = (list) => {
    if (!list || !Array.isArray(list)) return [];
    return list.map((d) => ({
      symbol: d.ticker || d.symbol || '',
      name: d.name || d.company_name || '',
      price: parseFloat(d.price || d.last) || 0,
      change: parseFloat(d.change_percent || d.pct_change || d.change) || 0,
      volume: parseInt(d.volume) || 0,
    }));
  };
  return {
    gainers: normalize(data.gainers || data.top_gainers),
    losers: normalize(data.losers || data.top_losers),
    active: normalize(data.most_active || data.active),
  };
}

/**
 * Enrich a stock symbol with IV rank data
 */
async function getIVRankData(symbol) {
  const data = await uwFetch(`/stock/${symbol}/iv-rank`);
  if (!data) return null;
  const entry = Array.isArray(data) ? data[data.length - 1] : data;
  return {
    ivRank: parseFloat(entry.iv_rank ?? entry.rank) || null,
    ivPercentile: parseFloat(entry.iv_percentile ?? entry.percentile) || null,
    currentIV: parseFloat(entry.current_iv ?? entry.iv) || null,
    iv52High: parseFloat(entry.iv_high ?? entry.high) || null,
    iv52Low: parseFloat(entry.iv_low ?? entry.low) || null,
  };
}

// ─── Fallback Yahoo Price Fetch ───

async function fetchYahooPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d&includePrePost=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta || {};
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
    const price = meta.regularMarketPrice || 0;
    const volume = meta.regularMarketVolume || 0;
    const change = prevClose > 0 ? (price - prevClose) / prevClose : 0;
    return { price, volume, change };
  } catch {
    return null;
  }
}

// ─── Main Screener (Hybrid UW + Fallback) ───

/**
 * Screen stocks — tries UW screener API first, falls back to curated list
 * Returns enriched stock data array
 */
async function screenStocks(onProgress) {
  // Try UW screener first
  if (onProgress) onProgress(5);
  const uwStocks = await screenUWStocks();

  if (uwStocks && uwStocks.length >= 10) {
    // UW screener worked — enrich with movers data
    if (onProgress) onProgress(60);
    const movers = await getUWMovers();
    if (onProgress) onProgress(90);

    // Merge mover data if available
    const moverMap = {};
    if (movers) {
      [...(movers.gainers || []), ...(movers.losers || []), ...(movers.active || [])].forEach((m) => {
        if (m.symbol) moverMap[m.symbol] = m;
      });
    }

    const results = uwStocks.map((stock) => {
      const mover = moverMap[stock.symbol];
      return {
        ...stock,
        price: stock.price || (mover ? mover.price : 0),
        change: stock.change || (mover ? mover.change : 0),
        volume: stock.volume || (mover ? mover.volume : 0),
        isMover: !!mover,
        source: 'UW',
      };
    }).filter((s) => s.price > 0);

    if (onProgress) onProgress(100);
    return results;
  }

  // Fallback: curated list + Yahoo prices
  const results = [];
  const batchSize = 6;
  for (let i = 0; i < STOCK_DATA.length; i += batchSize) {
    const batch = STOCK_DATA.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (stock) => {
        // Try UW stock-state first, then Yahoo
        const uwState = await uwFetch(`/stock/${stock.symbol}/stock-state`);
        if (uwState) {
          const entry = Array.isArray(uwState) ? uwState[0] : uwState;
          const price = parseFloat(entry.price || entry.last || entry.close) || 0;
          const prevClose = parseFloat(entry.prev_close || entry.previous_close) || 0;
          if (price > 0) {
            return {
              ...stock,
              price,
              volume: parseInt(entry.volume) || 0,
              change: prevClose > 0 ? (price - prevClose) / prevClose : 0,
              source: 'UW',
            };
          }
        }
        const live = await fetchYahooPrice(stock.symbol);
        if (!live || live.price <= 0) return null;
        return { ...stock, ...live, source: 'Yahoo' };
      })
    );
    batchResults.forEach((r) => { if (r) results.push(r); });
    if (onProgress) {
      onProgress(Math.min(100, Math.round(((i + batchSize) / STOCK_DATA.length) * 100)));
    }
  }
  return results;
}

/**
 * Screen options — hottest unusual options activity
 */
async function screenOptions(onProgress) {
  if (onProgress) onProgress(20);
  const options = await screenUWOptions();
  if (onProgress) onProgress(100);
  return options || [];
}

/**
 * Screen analysts — top rated stocks by analysts
 */
async function screenAnalysts(onProgress) {
  if (onProgress) onProgress(20);
  const analysts = await screenUWAnalysts();
  if (onProgress) onProgress(100);
  return analysts || [];
}

// ─── Formatting Helpers ───

function formatMarketCap(value) {
  if (!value) return 'N/A';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

function formatVolume(value) {
  if (!value) return 'N/A';
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toLocaleString();
}

function formatIVRank(rank) {
  if (rank == null) return 'N/A';
  if (rank >= 80) return { text: `${rank.toFixed(0)}%`, color: '#FF4560', label: 'High IV' };
  if (rank >= 50) return { text: `${rank.toFixed(0)}%`, color: '#FEB019', label: 'Moderate IV' };
  if (rank >= 20) return { text: `${rank.toFixed(0)}%`, color: '#00E396', label: 'Low IV' };
  return { text: `${rank.toFixed(0)}%`, color: '#00B8D9', label: 'Very Low IV' };
}

module.exports = {
  screenUWStocks,
  screenUWOptions,
  screenUWAnalysts,
  getUWMovers,
  getIVRankData,
  fetchYahooPrice,
  screenStocks,
  screenOptions,
  screenAnalysts,
  formatMarketCap,
  formatVolume,
  formatIVRank,
};

// ═══════════════════════════════════════════════════
// Super Picks Scanner — Server-side TA Engine
// Runs independently, fetches Yahoo data, computes scores
// ═══════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

// ── Stock Universe (from ETF holdings) ──
const SYMBOLS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','BRK-B','JPM',
  'LLY','V','UNH','XOM','MA','COST','HD','PG','JNJ','ABBV','WMT','NFLX',
  'BAC','CRM','ORCL','CVX','MRK','KO','AMD','PEP','TMO','LIN','ADBE',
  'ACN','CSCO','MCD','ABT','PM','IBM','GE','ISRG','INTU','VZ','CMCSA',
  'NOW','AMGN','GS','CAT','TXN','QCOM','BLK','PFE','T','NEE','UNP',
  'RTX','LOW','SPGI','AXP','HON','COP','BKNG','AMAT','BA','DE','SBUX',
  'MDLZ','PLD','GILD','MMC','SCHW','ADI','TJX','SYK','ADP','LRCX',
  'VRTX','ETN','FI','CB','BMY','MU','SO','INTC','REGN','PYPL','PLTR',
  'ABNB','COIN','SQ','SHOP','SMCI','MARA','RIOT','SOFI','HOOD','AFRM',
  'RKLB','IONQ','RIVN','LCID','OPEN','UPST','DKNG','MSTR','ARM','CRWD',
];

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// ═══════════════════════════════════════════════════
// Technical Indicator Computations
// ═══════════════════════════════════════════════════

function computeSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computeEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  if (ema12 == null || ema26 == null) return null;
  const macdLine = ema12 - ema26;

  // Compute signal line (9-period EMA of MACD values)
  const macdValues = [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let e12 = closes.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
  for (let i = 12; i < closes.length; i++) {
    e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) {
      e26 = closes[i] * k26 + e26 * (1 - k26);
      macdValues.push(e12 - e26);
    }
  }
  const signalLine = macdValues.length >= 9 ? computeEMA(macdValues, 9) : 0;
  const histogram = macdLine - signalLine;

  return { macdLine, signalLine, histogram };
}

function computeStochastic(highs, lows, closes, kPeriod = 14) {
  if (closes.length < kPeriod) return null;
  const recentHighs = highs.slice(-kPeriod);
  const recentLows = lows.slice(-kPeriod);
  const highestHigh = Math.max(...recentHighs);
  const lowestLow = Math.min(...recentLows);
  const range = highestHigh - lowestLow;
  if (range === 0) return { k: 50, d: 50 };
  const k = ((closes[closes.length - 1] - lowestLow) / range) * 100;
  return { k, d: k }; // simplified
}

function computeCCI(highs, lows, closes, period = 20) {
  if (closes.length < period) return null;
  const tps = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    tps.push((highs[i] + lows[i] + closes[i]) / 3);
  }
  const mean = tps.reduce((s, v) => s + v, 0) / period;
  const meanDev = tps.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
  if (meanDev === 0) return 0;
  return (tps[tps.length - 1] - mean) / (0.015 * meanDev);
}

function computeWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;
  const recentHighs = highs.slice(-period);
  const recentLows = lows.slice(-period);
  const hh = Math.max(...recentHighs);
  const ll = Math.min(...recentLows);
  if (hh === ll) return -50;
  return ((hh - closes[closes.length - 1]) / (hh - ll)) * -100;
}

// ═══════════════════════════════════════════════════
// Signal Scoring (-1 to +1 per indicator)
// ═══════════════════════════════════════════════════

function scoreMomentum(closes) {
  if (closes.length < 20) return { score: 0, label: 'N/A' };
  const price = closes[closes.length - 1];
  const rsi = computeRSI(closes);
  const ema8 = computeEMA(closes, 8);
  const ema21 = computeEMA(closes, 21);

  let score = 0;
  if (ema8 && ema21) {
    if (ema8 > ema21) score += 0.4; else score -= 0.4;
    if (price > ema8) score += 0.2; else score -= 0.2;
  }
  if (rsi != null) {
    if (rsi > 60 && rsi < 80) score += 0.3;
    else if (rsi > 50) score += 0.1;
    else if (rsi < 30) score -= 0.3;
    else if (rsi < 40) score -= 0.1;
  }
  score = Math.max(-1, Math.min(1, score));
  const label = score > 0.3 ? 'Bullish' : score < -0.3 ? 'Bearish' : 'Neutral';
  return { score, label, rsiValue: rsi };
}

function scoreMACD(closes) {
  const macd = computeMACD(closes);
  if (!macd) return { score: 0, label: 'N/A' };
  let score = 0;
  if (macd.histogram > 0) score += 0.4; else score -= 0.4;
  if (macd.macdLine > macd.signalLine) score += 0.3; else score -= 0.3;
  if (macd.macdLine > 0) score += 0.2; else score -= 0.2;
  score = Math.max(-1, Math.min(1, score));
  const label = score > 0.3 ? 'Bullish Crossover' : score < -0.3 ? 'Bearish Crossover' : 'Neutral';
  return { score, label };
}

function scoreSMA(closes) {
  if (closes.length < 200) return { score: 0, label: 'N/A' };
  const price = closes[closes.length - 1];
  const sma20 = computeSMA(closes, 20);
  const sma50 = computeSMA(closes, 50);
  const sma200 = computeSMA(closes, 200);
  let score = 0;
  if (price > sma20) score += 0.25; else score -= 0.25;
  if (price > sma50) score += 0.35; else score -= 0.35;
  if (price > sma200) score += 0.4; else score -= 0.4;
  score = Math.max(-1, Math.min(1, score));
  const label = score > 0.3 ? 'Above SMA' : score < -0.3 ? 'Below SMA' : 'Mixed';
  return { score, label };
}

function scoreStochastic(highs, lows, closes) {
  const stoch = computeStochastic(highs, lows, closes);
  if (!stoch) return { score: 0, label: 'N/A' };
  let score = 0;
  if (stoch.k < 20) score = 0.6;       // Oversold = bullish
  else if (stoch.k < 40) score = 0.3;
  else if (stoch.k > 80) score = -0.6;  // Overbought = bearish
  else if (stoch.k > 60) score = -0.2;
  else score = 0;
  const label = stoch.k < 20 ? 'Oversold' : stoch.k > 80 ? 'Overbought' : stoch.k < 50 ? 'Bullish' : 'Neutral';
  return { score, label };
}

function scoreVolume(volumes) {
  if (volumes.length < 20) return { score: 0, label: 'N/A' };
  const recent = volumes[volumes.length - 1];
  const avg20 = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const ratio = avg20 > 0 ? recent / avg20 : 1;
  let score = 0;
  if (ratio > 1.5) score = 0.8;
  else if (ratio > 1.2) score = 0.4;
  else if (ratio < 0.5) score = -0.4;
  else score = 0;
  const label = ratio > 1.5 ? 'High Volume' : ratio > 1.2 ? 'Above Avg' : ratio < 0.5 ? 'Low Volume' : 'Normal';
  return { score, label };
}

function scoreCCI(highs, lows, closes) {
  const cci = computeCCI(highs, lows, closes);
  if (cci == null) return { score: 0, label: 'N/A' };
  let score = 0;
  if (cci < -100) score = 0.6;
  else if (cci < -50) score = 0.3;
  else if (cci > 100) score = -0.5;
  else if (cci > 50) score = -0.2;
  const label = cci < -100 ? 'Oversold' : cci > 100 ? 'Overbought' : 'Neutral';
  return { score, label };
}

function scoreWilliamsR(highs, lows, closes) {
  const wr = computeWilliamsR(highs, lows, closes);
  if (wr == null) return { score: 0, label: 'N/A' };
  let score = 0;
  if (wr < -80) score = 0.6;
  else if (wr < -50) score = 0.2;
  else if (wr > -20) score = -0.6;
  else if (wr > -40) score = -0.2;
  const label = wr < -80 ? 'Oversold' : wr > -20 ? 'Overbought' : 'Neutral';
  return { score, label };
}

// ═══════════════════════════════════════════════════
// Main Scanner
// ═══════════════════════════════════════════════════

async function fetchCandles(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const quotes = result.indicators?.quote?.[0] || {};
    const meta = result.meta || {};
    const timestamps = result.timestamp || [];

    const closes = (quotes.close || []).map((v) => v ?? 0);
    const highs = (quotes.high || []).map((v) => v ?? 0);
    const lows = (quotes.low || []).map((v) => v ?? 0);
    const volumes = (quotes.volume || []).map((v) => v ?? 0);

    return {
      closes, highs, lows, volumes,
      price: meta.regularMarketPrice || closes[closes.length - 1] || 0,
      prevClose: meta.chartPreviousClose || meta.previousClose || 0,
      name: meta.shortName || meta.longName || symbol,
    };
  } catch {
    return null;
  }
}

async function analyzeSymbol(symbol) {
  const candles = await fetchCandles(symbol);
  if (!candles || candles.closes.length < 50) return null;

  const { closes, highs, lows, volumes, price, prevClose, name } = candles;
  if (price <= 0) return null;

  const momentum = scoreMomentum(closes);
  const macd = scoreMACD(closes);
  const sma = scoreSMA(closes);
  const stoch = scoreStochastic(highs, lows, closes);
  const volume = scoreVolume(volumes);
  const cci = scoreCCI(highs, lows, closes);
  const willr = scoreWilliamsR(highs, lows, closes);

  // Weighted composite — same weights as the app
  // Momentum 28%, MACD 23%, SMA 17.5%, Stoch 11.5%, Vol 11.5%, CCI 6%, WillR 2.5%
  const weights = { momentum: 2.8, macd: 2.3, sma: 1.75, stoch: 1.15, volume: 1.15, cci: 0.6, willr: 0.25 };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const raw = (
    momentum.score * weights.momentum +
    macd.score * weights.macd +
    sma.score * weights.sma +
    stoch.score * weights.stoch +
    volume.score * weights.volume +
    cci.score * weights.cci +
    willr.score * weights.willr
  ) / totalWeight;

  // Normalize to -10 to +10
  const compositeScore = Math.round(raw * 10 * 5) / 10;
  const clampedScore = Math.max(-10, Math.min(10, Math.round(compositeScore * 10) / 10));

  let overallSignal = 'Neutral';
  if (clampedScore > 6) overallSignal = 'Strong Buy';
  else if (clampedScore > 2) overallSignal = 'Buy';
  else if (clampedScore > -2) overallSignal = 'Neutral';
  else if (clampedScore > -6) overallSignal = 'Sell';
  else overallSignal = 'Strong Sell';

  const dailyChange = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

  return {
    symbol,
    name,
    composite_score: clampedScore,
    overall_signal: overallSignal,
    price: Math.round(price * 100) / 100,
    daily_change: Math.round(dailyChange * 100) / 100,
    momentum_score: momentum.score, momentum_label: momentum.label,
    macd_score: macd.score, macd_label: macd.label,
    sma_score: sma.score, sma_label: sma.label,
    stoch_score: stoch.score, stoch_label: stoch.label,
    volume_score: volume.score, volume_label: volume.label,
    cci_score: cci.score, cci_label: cci.label,
    willr_score: willr.score, willr_label: willr.label,
    rsi_value: momentum.rsiValue || 0,
  };
}

/**
 * Run a full scan of all symbols and update the data store
 * @param {Function} getStore - returns { picks, history, scanLogs, nextId }
 * @param {Function} persist - saves data to disk
 */
async function runScan(getStore, persist) {
  const startTime = Date.now();
  console.log(`[Scanner] Starting scan of ${SYMBOLS.length} symbols...`);

  const results = [];
  const batchSize = 5;

  for (let i = 0; i < SYMBOLS.length; i += batchSize) {
    const batch = SYMBOLS.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((sym) => analyzeSymbol(sym)));
    batchResults.forEach((r) => { if (r) results.push(r); });

    // Small delay between batches
    if (i + batchSize < SYMBOLS.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Filter for picks (score >= 2 to show Buy and Strong Buy)
  const picks = results
    .filter((r) => r.composite_score >= 2)
    .sort((a, b) => b.composite_score - a.composite_score);

  const scanTimeMs = Date.now() - startTime;
  console.log(`[Scanner] Complete: ${results.length} analyzed, ${picks.length} picks (${(scanTimeMs / 1000).toFixed(1)}s)`);

  // Update store
  const store = getStore();
  const batchId = `scan_${Date.now()}`;
  const now = new Date().toISOString();

  // Build active map
  const activeMap = {};
  store.history.filter((h) => h.status === 'active').forEach((h) => { activeMap[h.symbol] = h; });
  const newSymbols = new Set(picks.map((p) => p.symbol));

  // Update picks with timestamp
  store.picks.length = 0;
  picks.forEach((p) => {
    p.id = store.nextId.pick++;
    p.updated_at = now;
    store.picks.push(p);
  });

  // Add new symbols to history
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
      // Update peak price for active picks
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
    batch_id: batchId, total_scanned: results.length, picks_found: picks.length,
    avg_score: Math.round(avgScore * 100) / 100, scan_time_ms: scanTimeMs, created_at: now,
  });
  if (store.scanLogs.length > 100) store.scanLogs.splice(0, store.scanLogs.length - 100);

  persist();
  return { total: results.length, picks: picks.length, timeMs: scanTimeMs };
}

module.exports = { runScan, SYMBOLS };

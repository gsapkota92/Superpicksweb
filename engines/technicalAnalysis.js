// ═══════════════════════════════════════════════════════════════════
// Technical Analysis Engine — Hybrid UW API + Local Calculation
// Uses Unusual Whales /stock/{ticker}/technical-indicator/{fn} API
// with local computation as fallback. Adds ADX, OBV, VWAP, CCI,
// Williams %R, Aroon, MFI to the existing indicator suite.
//
// Server-side CommonJS port of TradingAppFresh/src/data/technicalAnalysis.js.
// ES import/export → require/module.exports. Uses Node 18+ global fetch.
// Scoring math (weights/thresholds/formulas/indicators) is unchanged.
// ═══════════════════════════════════════════════════════════════════

const { UW_CONFIG } = require('./config');

const UW_BASE = UW_CONFIG.BASE_URL;
const UW_HEADERS = {
  Accept: 'application/json',
  Authorization: `Bearer ${UW_CONFIG.API_KEY}`,
  'UW-CLIENT-API-ID': '100001',
};

// ─── UW API Technical Indicator Fetcher ───

async function fetchUWIndicator(symbol, fn, params = {}) {
  try {
    const qs = Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const url = `${UW_BASE}/stock/${symbol}/technical-indicator/${fn}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, { headers: UW_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? json;
  } catch {
    return null;
  }
}

/**
 * Fetch all UW server-side indicators in parallel for a symbol
 * Returns object with all indicator data or nulls for failed ones
 */
async function fetchAllUWIndicators(symbol) {
  const [sma20, sma50, ema12, ema26, rsi, macd, bbands, stoch, adx, atr, obv, vwap, cci, willr, aroon, mfi] =
    await Promise.all([
      fetchUWIndicator(symbol, 'SMA', { time_period: 20 }),
      fetchUWIndicator(symbol, 'SMA', { time_period: 50 }),
      fetchUWIndicator(symbol, 'EMA', { time_period: 12 }),
      fetchUWIndicator(symbol, 'EMA', { time_period: 26 }),
      fetchUWIndicator(symbol, 'RSI', { time_period: 14 }),
      fetchUWIndicator(symbol, 'MACD', { fast_period: 12, slow_period: 26, signal_period: 9 }),
      fetchUWIndicator(symbol, 'BBANDS', { time_period: 20, nbdevup: 2, nbdevdn: 2 }),
      fetchUWIndicator(symbol, 'STOCH', { fastk_period: 14, slowk_period: 3, slowd_period: 3 }),
      fetchUWIndicator(symbol, 'ADX', { time_period: 14 }),
      fetchUWIndicator(symbol, 'ATR', { time_period: 14 }),
      fetchUWIndicator(symbol, 'OBV'),
      fetchUWIndicator(symbol, 'VWAP'),
      fetchUWIndicator(symbol, 'CCI', { time_period: 20 }),
      fetchUWIndicator(symbol, 'WILLR', { time_period: 14 }),
      fetchUWIndicator(symbol, 'AROON', { time_period: 14 }),
      fetchUWIndicator(symbol, 'MFI', { time_period: 14 }),
    ]);
  return { sma20, sma50, ema12, ema26, rsi, macd, bbands, stoch, adx, atr, obv, vwap, cci, willr, aroon, mfi };
}

/** Extract the latest numeric value from a UW indicator response */
function uwLatest(data) {
  if (data == null) return null;
  if (typeof data === 'number') return data;
  if (Array.isArray(data)) {
    const last = data[data.length - 1];
    if (typeof last === 'number') return last;
    if (last && typeof last === 'object') {
      return parseFloat(last.value ?? last.close ?? last.sma ?? last.ema ?? last.rsi ?? Object.values(last).find(v => typeof v === 'number'));
    }
    return null;
  }
  if (typeof data === 'object') {
    // Single latest value object
    return parseFloat(data.value ?? data.close ?? data.sma ?? data.ema ?? data.rsi ?? null);
  }
  return null;
}

/** Extract MACD components from UW response */
function uwMacdValues(data) {
  if (!data) return { macd: null, signal: null, hist: null };
  if (Array.isArray(data)) {
    const last = data[data.length - 1];
    if (!last) return { macd: null, signal: null, hist: null };
    return {
      macd: parseFloat(last.macd ?? last.MACD ?? last.macd_line) || null,
      signal: parseFloat(last.signal ?? last.MACD_Signal ?? last.signal_line ?? last.macd_signal) || null,
      hist: parseFloat(last.histogram ?? last.MACD_Hist ?? last.hist ?? last.macd_hist) || null,
    };
  }
  if (typeof data === 'object') {
    return {
      macd: parseFloat(data.macd ?? data.MACD ?? data.macd_line) || null,
      signal: parseFloat(data.signal ?? data.MACD_Signal ?? data.signal_line) || null,
      hist: parseFloat(data.histogram ?? data.MACD_Hist ?? data.hist) || null,
    };
  }
  return { macd: null, signal: null, hist: null };
}

/** Extract Bollinger Band components */
function uwBBValues(data) {
  if (!data) return { upper: null, middle: null, lower: null };
  const entry = Array.isArray(data) ? data[data.length - 1] : data;
  if (!entry || typeof entry !== 'object') return { upper: null, middle: null, lower: null };
  return {
    upper: parseFloat(entry.upper_band ?? entry.Real_Upper_Band ?? entry.upper) || null,
    middle: parseFloat(entry.middle_band ?? entry.Real_Middle_Band ?? entry.middle ?? entry.sma) || null,
    lower: parseFloat(entry.lower_band ?? entry.Real_Lower_Band ?? entry.lower) || null,
  };
}

/** Extract Stochastic values */
function uwStochValues(data) {
  if (!data) return { k: null, d: null };
  const entry = Array.isArray(data) ? data[data.length - 1] : data;
  if (!entry || typeof entry !== 'object') return { k: null, d: null };
  return {
    k: parseFloat(entry.slowk ?? entry.SlowK ?? entry.k ?? entry.percent_k) || null,
    d: parseFloat(entry.slowd ?? entry.SlowD ?? entry.d ?? entry.percent_d) || null,
  };
}

/** Extract Aroon values */
function uwAroonValues(data) {
  if (!data) return { up: null, down: null };
  const entry = Array.isArray(data) ? data[data.length - 1] : data;
  if (!entry || typeof entry !== 'object') return { up: null, down: null };
  return {
    up: parseFloat(entry.aroon_up ?? entry.Aroon_Up ?? entry.up) || null,
    down: parseFloat(entry.aroon_down ?? entry.Aroon_Down ?? entry.down) || null,
  };
}

// ─── Local Indicator Functions (all computed from candle data) ───

function computeSMA(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      result.push(sum / period);
    }
  }
  return result;
}

function computeEMA(closes, period) {
  const k = 2 / (period + 1);
  const result = [];
  let ema = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      ema = sum / period;
      result.push(ema);
    } else {
      ema = closes[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function computeRSI(closes, period = 14) {
  const result = [];
  if (closes.length < period + 1) return closes.map(() => null);
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  result.push(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
    result.push(null);
  }
  avgGain /= period;
  avgLoss /= period;
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = 100 - 100 / (1 + rs0);
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

function computeMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMA(closes, fast);
  const emaSlow = computeEMA(closes, slow);
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) {
      macdLine.push(emaFast[i] - emaSlow[i]);
    } else {
      macdLine.push(null);
    }
  }
  const validMacd = macdLine.filter((v) => v != null);
  const signalEMA = computeEMA(validMacd, signal);
  const signalLine = [];
  const histogram = [];
  let validIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] == null) {
      signalLine.push(null);
      histogram.push(null);
    } else {
      const sig = signalEMA[validIdx] || null;
      signalLine.push(sig);
      histogram.push(sig != null ? macdLine[i] - sig : null);
      validIdx++;
    }
  }
  return { macdLine, signalLine, histogram };
}

function computeATR(candles, period = 14) {
  if (candles.length < 2) return [];
  const trs = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trs.push(tr);
    }
  }
  const result = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += trs[j];
      result.push(sum / period);
    } else {
      result.push((result[i - 1] * (period - 1) + trs[i]) / period);
    }
  }
  return result;
}

function computeStochastic(candles, kPeriod = 14, dPeriod = 3) {
  const kValues = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      kValues.push(null);
    } else {
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - kPeriod + 1; j <= i; j++) {
        if (candles[j].high > highest) highest = candles[j].high;
        if (candles[j].low < lowest) lowest = candles[j].low;
      }
      const range = highest - lowest;
      kValues.push(range === 0 ? 50 : ((candles[i].close - lowest) / range) * 100);
    }
  }
  const validK = kValues.filter((v) => v != null);
  const dSma = computeSMA(validK, dPeriod);
  const dValues = [];
  let ki = 0;
  for (let i = 0; i < kValues.length; i++) {
    if (kValues[i] == null) {
      dValues.push(null);
    } else {
      dValues.push(dSma[ki] || null);
      ki++;
    }
  }
  return { k: kValues, d: dValues };
}

function computeBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  const sma = computeSMA(closes, period);
  const upper = [];
  const lower = [];
  const bandwidth = [];
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] == null) {
      upper.push(null);
      lower.push(null);
      bandwidth.push(null);
    } else {
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += (closes[j] - sma[i]) ** 2;
      }
      const stdDev = Math.sqrt(sumSq / period);
      upper.push(sma[i] + stdDevMultiplier * stdDev);
      lower.push(sma[i] - stdDevMultiplier * stdDev);
      bandwidth.push(sma[i] > 0 ? (stdDevMultiplier * 2 * stdDev) / sma[i] : 0);
    }
  }
  return { sma, upper, lower, bandwidth };
}

// ─── Local Extended Indicator Functions ───

function computeWilliamsR(candles, period = 14) {
  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > highest) highest = candles[j].high;
      if (candles[j].low < lowest) lowest = candles[j].low;
    }
    const range = highest - lowest;
    result.push(range === 0 ? -50 : ((highest - candles[i].close) / range) * -100);
  }
  return result;
}

function computeCCI(candles, period = 20) {
  const result = [];
  const tps = candles.map(c => (c.high + c.low + c.close) / 3);
  for (let i = 0; i < tps.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tps[j];
    const mean = sum / period;
    let devSum = 0;
    for (let j = i - period + 1; j <= i; j++) devSum += Math.abs(tps[j] - mean);
    const meanDev = devSum / period;
    result.push(meanDev === 0 ? 0 : (tps[i] - mean) / (0.015 * meanDev));
  }
  return result;
}

function computeMFI(candles, period = 14) {
  const result = [];
  if (candles.length < period + 1) return candles.map(() => null);
  const tps = candles.map(c => (c.high + c.low + c.close) / 3);
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { result.push(null); continue; }
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const rawMF = tps[j] * (candles[j].volume || 0);
      if (tps[j] > tps[j - 1]) posFlow += rawMF;
      else if (tps[j] < tps[j - 1]) negFlow += rawMF;
    }
    result.push(negFlow === 0 ? 100 : 100 - (100 / (1 + posFlow / negFlow)));
  }
  return result;
}

function computeADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) return candles.map(() => null);
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { plusDM.push(0); minusDM.push(0); tr.push(candles[i].high - candles[i].low); continue; }
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  // Smooth with Wilder's method
  const smooth = (arr) => {
    const s = []; let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i < period) { sum += arr[i]; s.push(i === period - 1 ? sum : null); }
      else { s.push(s[i - 1] - s[i - 1] / period + arr[i]); }
    }
    return s;
  };
  const sTR = smooth(tr), sPDM = smooth(plusDM), sMDM = smooth(minusDM);
  const dx = [];
  for (let i = 0; i < candles.length; i++) {
    if (sTR[i] == null || sTR[i] === 0) { dx.push(null); continue; }
    const pdi = (sPDM[i] / sTR[i]) * 100;
    const mdi = (sMDM[i] / sTR[i]) * 100;
    const diSum = pdi + mdi;
    dx.push(diSum === 0 ? 0 : Math.abs(pdi - mdi) / diSum * 100);
  }
  // Smooth DX to get ADX
  const result = [];
  let adxSum = 0, adxCount = 0, adxPrev = null;
  for (let i = 0; i < dx.length; i++) {
    if (dx[i] == null) { result.push(null); continue; }
    if (adxPrev == null) {
      adxSum += dx[i]; adxCount++;
      if (adxCount === period) { adxPrev = adxSum / period; result.push(adxPrev); }
      else result.push(null);
    } else {
      adxPrev = (adxPrev * (period - 1) + dx[i]) / period;
      result.push(adxPrev);
    }
  }
  return result;
}

function computeAroon(candles, period = 14) {
  const up = [], down = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { up.push(null); down.push(null); continue; }
    let highIdx = 0, lowIdx = 0;
    for (let j = 1; j <= period; j++) {
      if (candles[i - j + 1].high >= candles[i - highIdx].high) highIdx = j - 1;
      // Fix: track from the window start
    }
    // Recalculate properly
    let maxH = -Infinity, minL = Infinity, maxHIdx = 0, minLIdx = 0;
    for (let j = 0; j <= period; j++) {
      const idx = i - period + j;
      if (candles[idx].high > maxH) { maxH = candles[idx].high; maxHIdx = j; }
      if (candles[idx].low < minL) { minL = candles[idx].low; minLIdx = j; }
    }
    up.push((maxHIdx / period) * 100);
    down.push((minLIdx / period) * 100);
  }
  return { up, down };
}

function computeOBV(candles) {
  const result = [];
  let obv = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { result.push(0); continue; }
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume || 0;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume || 0;
    result.push(obv);
  }
  return result;
}

// ─── Signal Interpretation ───

function interpretRSI(rsi) {
  if (rsi == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  if (rsi >= 80) return { signal: 'strong_sell', label: 'Overbought', score: -2 };
  if (rsi >= 70) return { signal: 'sell', label: 'High', score: -1 };
  if (rsi <= 20) return { signal: 'strong_buy', label: 'Oversold', score: 2 };
  if (rsi <= 30) return { signal: 'buy', label: 'Low', score: 1 };
  if (rsi >= 50 && rsi < 70) return { signal: 'bullish', label: 'Bullish', score: 0.5 };
  if (rsi < 50 && rsi > 30) return { signal: 'bearish', label: 'Bearish', score: -0.5 };
  return { signal: 'neutral', label: 'Neutral', score: 0 };
}

function interpretMACD(macdLine, signalLine, histogram) {
  if (macdLine == null || signalLine == null || histogram == null) {
    return { signal: 'neutral', label: 'N/A', score: 0 };
  }
  const crossUp = macdLine > signalLine;
  const histPositive = histogram > 0;
  if (crossUp && histPositive && macdLine > 0) return { signal: 'strong_buy', label: 'Strong Bull', score: 2 };
  if (crossUp && histPositive) return { signal: 'buy', label: 'Bullish Cross', score: 1.5 };
  if (crossUp) return { signal: 'bullish', label: 'Bullish', score: 0.5 };
  if (!crossUp && !histPositive && macdLine < 0) return { signal: 'strong_sell', label: 'Strong Bear', score: -2 };
  if (!crossUp && !histPositive) return { signal: 'sell', label: 'Bearish Cross', score: -1.5 };
  if (!crossUp) return { signal: 'bearish', label: 'Bearish', score: -0.5 };
  return { signal: 'neutral', label: 'Neutral', score: 0 };
}

function interpretSMACross(price, sma20, sma50) {
  if (sma20 == null || sma50 == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  const aboveSma20 = price > sma20;
  const aboveSma50 = price > sma50;
  const goldenCross = sma20 > sma50;
  if (aboveSma20 && aboveSma50 && goldenCross) return { signal: 'strong_buy', label: 'Golden Cross', score: 2 };
  if (aboveSma20 && aboveSma50) return { signal: 'buy', label: 'Above SMAs', score: 1 };
  if (!aboveSma20 && !aboveSma50 && !goldenCross) return { signal: 'strong_sell', label: 'Death Cross', score: -2 };
  if (!aboveSma20 && !aboveSma50) return { signal: 'sell', label: 'Below SMAs', score: -1 };
  if (aboveSma20 && !aboveSma50) return { signal: 'bullish', label: 'Recovering', score: 0.5 };
  return { signal: 'bearish', label: 'Weakening', score: -0.5 };
}

function interpretVolume(volumes) {
  if (!volumes || volumes.length < 10) return { signal: 'neutral', label: 'N/A', score: 0 };
  const recent5 = volumes.slice(-5);
  const prev5 = volumes.slice(-10, -5);
  const avgRecent = recent5.reduce((a, b) => a + b, 0) / recent5.length;
  const avgPrev = prev5.reduce((a, b) => a + b, 0) / prev5.length;
  if (avgPrev === 0) return { signal: 'neutral', label: 'N/A', score: 0 };
  const ratio = avgRecent / avgPrev;
  if (ratio > 1.5) return { signal: 'strong_buy', label: 'Surge', score: 1.5 };
  if (ratio > 1.2) return { signal: 'buy', label: 'Rising', score: 0.75 };
  if (ratio < 0.6) return { signal: 'sell', label: 'Drying Up', score: -1 };
  if (ratio < 0.8) return { signal: 'bearish', label: 'Declining', score: -0.5 };
  return { signal: 'neutral', label: 'Steady', score: 0 };
}

function interpretMomentum(closes) {
  if (closes.length < 20) return { signal: 'neutral', label: 'N/A', score: 0, weekChange: 0 };
  const current = closes[closes.length - 1];
  const week1 = closes[closes.length - 6] || closes[0];
  const week2 = closes[closes.length - 11] || closes[0];
  const weekChange = (current - week1) / week1;
  const twoWeekChange = (current - week2) / week2;
  const recentAccel = weekChange > (twoWeekChange - weekChange);
  let score = 0;
  let label = 'Flat';
  if (weekChange > 0.05) { score = 2; label = 'Strong Up'; }
  else if (weekChange > 0.02) { score = 1; label = 'Up'; }
  else if (weekChange > 0) { score = 0.5; label = 'Slight Up'; }
  else if (weekChange > -0.02) { score = -0.5; label = 'Slight Down'; }
  else if (weekChange > -0.05) { score = -1; label = 'Down'; }
  else { score = -2; label = 'Strong Down'; }
  if (recentAccel && score > 0) score += 0.5;
  return {
    signal: score > 1 ? 'strong_buy' : score > 0 ? 'buy' : score < -1 ? 'strong_sell' : score < 0 ? 'sell' : 'neutral',
    label, score, weekChange,
  };
}

function interpretStochastic(k, d) {
  if (k == null || d == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  if (k > 80 && d > 80) return { signal: 'sell', label: 'Overbought', score: -1 };
  if (k < 20 && d < 20) return { signal: 'buy', label: 'Oversold', score: 1 };
  if (k > d && k < 50) return { signal: 'bullish', label: 'Cross Up', score: 0.75 };
  if (k < d && k > 50) return { signal: 'bearish', label: 'Cross Down', score: -0.75 };
  return { signal: 'neutral', label: 'Neutral', score: 0 };
}

// ─── NEW: Extended Indicator Interpreters ───

function interpretADX(adx) {
  if (adx == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  if (adx >= 50) return { signal: 'strong_buy', label: 'Very Strong Trend', score: 1.5 };
  if (adx >= 25) return { signal: 'buy', label: 'Strong Trend', score: 1 };
  if (adx >= 20) return { signal: 'neutral', label: 'Weak Trend', score: 0.25 };
  return { signal: 'bearish', label: 'No Trend', score: -0.5 };
}

function interpretCCI(cci) {
  if (cci == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  if (cci >= 200) return { signal: 'strong_sell', label: 'Extreme Overbought', score: -2 };
  if (cci >= 100) return { signal: 'sell', label: 'Overbought', score: -1 };
  if (cci <= -200) return { signal: 'strong_buy', label: 'Extreme Oversold', score: 2 };
  if (cci <= -100) return { signal: 'buy', label: 'Oversold', score: 1 };
  if (cci > 0) return { signal: 'bullish', label: 'Above Zero', score: 0.5 };
  return { signal: 'bearish', label: 'Below Zero', score: -0.5 };
}

function interpretWilliamsR(willr) {
  if (willr == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  // Williams %R ranges from -100 to 0
  if (willr >= -20) return { signal: 'sell', label: 'Overbought', score: -1 };
  if (willr <= -80) return { signal: 'buy', label: 'Oversold', score: 1 };
  if (willr >= -50) return { signal: 'bearish', label: 'Upper Half', score: -0.25 };
  return { signal: 'bullish', label: 'Lower Half', score: 0.25 };
}

function interpretMFI(mfi) {
  if (mfi == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  if (mfi >= 80) return { signal: 'sell', label: 'Money Overbought', score: -1 };
  if (mfi <= 20) return { signal: 'buy', label: 'Money Oversold', score: 1 };
  if (mfi >= 50) return { signal: 'bullish', label: 'Money Inflow', score: 0.5 };
  return { signal: 'bearish', label: 'Money Outflow', score: -0.5 };
}

function interpretAroon(up, down) {
  if (up == null || down == null) return { signal: 'neutral', label: 'N/A', score: 0 };
  const oscillator = up - down;
  if (up >= 70 && down <= 30) return { signal: 'strong_buy', label: 'Strong Uptrend', score: 2 };
  if (up >= 50 && up > down) return { signal: 'buy', label: 'Uptrend', score: 1 };
  if (down >= 70 && up <= 30) return { signal: 'strong_sell', label: 'Strong Downtrend', score: -2 };
  if (down >= 50 && down > up) return { signal: 'sell', label: 'Downtrend', score: -1 };
  return { signal: 'neutral', label: 'Consolidating', score: 0 };
}

function interpretOBV(obvData) {
  if (!obvData || !Array.isArray(obvData) || obvData.length < 3) return { signal: 'neutral', label: 'N/A', score: 0 };
  const values = obvData.filter(v => typeof v === 'number' && !isNaN(v));
  if (values.length < 3) return { signal: 'neutral', label: 'N/A', score: 0 };
  const trend = values[values.length - 1] - values[0];
  if (trend > 0) return { signal: 'buy', label: 'Accumulation', score: 0.75 };
  if (trend < 0) return { signal: 'sell', label: 'Distribution', score: -0.75 };
  return { signal: 'neutral', label: 'Flat', score: 0 };
}

// ─── Fetch & Analyze (All Local from Yahoo Candle Data) ───

/**
 * Fetch candle data and run full technical analysis.
 * All 12 indicators computed locally — zero UW API calls.
 */
async function analyzeStock(symbol) {
  try {
    // Fetch candle data (for sparkline, volume, momentum, and local fallback)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=3mo&interval=1d&includePrePost=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const opens = q.open || [];
    const highs = q.high || [];
    const lows = q.low || [];
    const closes = q.close || [];
    const volumes = q.volume || [];

    const candles = [];
    const cleanCloses = [];
    const cleanVolumes = [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] == null || opens[i] == null) continue;
      candles.push({
        timestamp: ts[i] * 1000,
        open: opens[i], high: highs[i], low: lows[i], close: closes[i],
        volume: volumes[i] || 0,
      });
      cleanCloses.push(closes[i]);
      cleanVolumes.push(volumes[i] || 0);
    }
    if (candles.length < 20) return null;

    const price = meta.regularMarketPrice || cleanCloses[cleanCloses.length - 1];
    const prevClose = meta.chartPreviousClose || meta.previousClose || 0;

    // ── All indicators computed locally from candle data (zero UW API calls) ──
    const rsiValues = computeRSI(cleanCloses, 14);
    const currentRSI = rsiValues[rsiValues.length - 1];

    const macd = computeMACD(cleanCloses, 12, 26, 9);
    const currentMACD = macd.macdLine[macd.macdLine.length - 1];
    const currentMACDSignal = macd.signalLine[macd.signalLine.length - 1];
    const currentMACDHist = macd.histogram[macd.histogram.length - 1];

    const sma20Arr = computeSMA(cleanCloses, 20);
    const currentSMA20 = sma20Arr[sma20Arr.length - 1];
    const sma50Arr = computeSMA(cleanCloses, 50);
    const currentSMA50 = sma50Arr[sma50Arr.length - 1];

    const stoch = computeStochastic(candles, 14, 3);
    const currentK = stoch.k[stoch.k.length - 1];
    const currentD = stoch.d[stoch.d.length - 1];

    const atrValues = computeATR(candles, 14);
    const currentATR = atrValues[atrValues.length - 1];

    const bb = computeBollingerBands(cleanCloses, 20, 2);
    const currentBBUpper = bb.upper[bb.upper.length - 1];
    const currentBBLower = bb.lower[bb.lower.length - 1];
    const currentBBWidth = bb.bandwidth[bb.bandwidth.length - 1];

    // Extended indicators — all local
    const adxValues = computeADX(candles, 14);
    const currentADX = adxValues[adxValues.length - 1];

    const cciValues = computeCCI(candles, 20);
    const currentCCI = cciValues[cciValues.length - 1];

    const willrValues = computeWilliamsR(candles, 14);
    const currentWILLR = willrValues[willrValues.length - 1];

    const mfiValues = computeMFI(candles, 14);
    const currentMFI = mfiValues[mfiValues.length - 1];

    const aroonData = computeAroon(candles, 14);
    const aroonVals = {
      up: aroonData.up[aroonData.up.length - 1],
      down: aroonData.down[aroonData.down.length - 1],
    };

    const obvValues = computeOBV(candles);
    const currentVWAP = null; // VWAP needs intraday data, skip for daily

    // Sparkline
    const spark = cleanCloses.slice(-5).map((c, i) => ({ x: i, y: Math.round(c * 100) / 100 }));

    // ── Interpret all indicators ──
    const rsiSignal = interpretRSI(currentRSI);
    const macdSignal = interpretMACD(currentMACD, currentMACDSignal, currentMACDHist);
    const smaSignal = interpretSMACross(price, currentSMA20, currentSMA50);
    const volumeSignal = interpretVolume(cleanVolumes);
    const momentumSignal = interpretMomentum(cleanCloses);
    const stochSignal = interpretStochastic(currentK, currentD);

    // Extended signals
    const adxSignal = interpretADX(currentADX);
    const cciSignal = interpretCCI(currentCCI);
    const willrSignal = interpretWilliamsR(currentWILLR);
    const mfiSignal = interpretMFI(currentMFI);
    const aroonSignal = interpretAroon(aroonVals.up, aroonVals.down);
    const obvSignal = obvValues.length >= 5 ? interpretOBV(obvValues.slice(-5)) : { signal: 'neutral', label: 'N/A', score: 0 };

    // ── Composite Score — original weights (minus flow), scaled to 100% ──
    // Original: Momentum 24%, MACD 20%, SMA 15%, Stoch 10%, Volume 10%, CCI 5%, WillR 2%, Flow 30%
    // Without flow (86% → 100%): Momentum 28%, MACD 23%, SMA 17.5%, Stoch 11.5%, Volume 11.5%, CCI 6%, WillR 2.5%
    const weights = {
      momentum: 2.8,
      macd: 2.3,
      sma: 1.75,
      stochastic: 1.15,
      volume: 1.15,
      cci: 0.6,
      williamsR: 0.25,
    };

    const activeWeights = { ...weights };
    if (currentCCI == null) delete activeWeights.cci;
    if (currentWILLR == null) delete activeWeights.williamsR;

    const totalWeight = Object.values(activeWeights).reduce((a, b) => a + b, 0);

    let compositeScore =
      (momentumSignal.score * activeWeights.momentum +
       macdSignal.score * activeWeights.macd +
       smaSignal.score * activeWeights.sma +
       stochSignal.score * activeWeights.stochastic +
       volumeSignal.score * activeWeights.volume +
       (activeWeights.cci ? cciSignal.score * activeWeights.cci : 0) +
       (activeWeights.williamsR ? willrSignal.score * activeWeights.williamsR : 0)) / totalWeight;

    const normalizedScore = Math.round(compositeScore * 10 * 5) / 10;
    const overallSignal = normalizedScore > 6 ? 'Strong Buy'
      : normalizedScore > 2 ? 'Buy'
      : normalizedScore > -2 ? 'Neutral'
      : normalizedScore > -6 ? 'Sell'
      : 'Strong Sell';

    const allSignals = [rsiSignal, macdSignal, smaSignal, volumeSignal, momentumSignal, stochSignal,
      adxSignal, cciSignal, willrSignal, mfiSignal, aroonSignal, obvSignal];
    const bullishCount = allSignals.filter((s) => s.score > 0).length;
    const bearishCount = allSignals.filter((s) => s.score < 0).length;

    const dataSource = 'Local';

    // Build extended breakdown
    const coreBreakdown = [
      { name: 'Momentum', weight: activeWeights.momentum, weightPct: Math.round(activeWeights.momentum / totalWeight * 100), rawScore: momentumSignal.score, weighted: Math.round(momentumSignal.score * activeWeights.momentum / totalWeight * 100) / 100, label: momentumSignal.label },
      { name: 'MACD', weight: activeWeights.macd, weightPct: Math.round(activeWeights.macd / totalWeight * 100), rawScore: macdSignal.score, weighted: Math.round(macdSignal.score * activeWeights.macd / totalWeight * 100) / 100, label: macdSignal.label },
      { name: 'RSI', weight: activeWeights.rsi, weightPct: Math.round(activeWeights.rsi / totalWeight * 100), rawScore: rsiSignal.score, weighted: Math.round(rsiSignal.score * activeWeights.rsi / totalWeight * 100) / 100, label: rsiSignal.label },
      { name: 'SMA', weight: activeWeights.sma, weightPct: Math.round(activeWeights.sma / totalWeight * 100), rawScore: smaSignal.score, weighted: Math.round(smaSignal.score * activeWeights.sma / totalWeight * 100) / 100, label: smaSignal.label },
      { name: 'Stochastic', weight: activeWeights.stochastic, weightPct: Math.round(activeWeights.stochastic / totalWeight * 100), rawScore: stochSignal.score, weighted: Math.round(stochSignal.score * activeWeights.stochastic / totalWeight * 100) / 100, label: stochSignal.label },
      { name: 'Volume', weight: activeWeights.volume, weightPct: Math.round(activeWeights.volume / totalWeight * 100), rawScore: volumeSignal.score, weighted: Math.round(volumeSignal.score * activeWeights.volume / totalWeight * 100) / 100, label: volumeSignal.label },
    ];
    // Add extended indicators that have data
    if (activeWeights.adx) coreBreakdown.push({ name: 'ADX', weight: activeWeights.adx, weightPct: Math.round(activeWeights.adx / totalWeight * 100), rawScore: adxSignal.score, weighted: Math.round(adxSignal.score * activeWeights.adx / totalWeight * 100) / 100, label: adxSignal.label });
    if (activeWeights.cci) coreBreakdown.push({ name: 'CCI', weight: activeWeights.cci, weightPct: Math.round(activeWeights.cci / totalWeight * 100), rawScore: cciSignal.score, weighted: Math.round(cciSignal.score * activeWeights.cci / totalWeight * 100) / 100, label: cciSignal.label });
    if (activeWeights.mfi) coreBreakdown.push({ name: 'MFI', weight: activeWeights.mfi, weightPct: Math.round(activeWeights.mfi / totalWeight * 100), rawScore: mfiSignal.score, weighted: Math.round(mfiSignal.score * activeWeights.mfi / totalWeight * 100) / 100, label: mfiSignal.label });
    if (activeWeights.aroon) coreBreakdown.push({ name: 'Aroon', weight: activeWeights.aroon, weightPct: Math.round(activeWeights.aroon / totalWeight * 100), rawScore: aroonSignal.score, weighted: Math.round(aroonSignal.score * activeWeights.aroon / totalWeight * 100) / 100, label: aroonSignal.label });
    if (activeWeights.williamsR) coreBreakdown.push({ name: 'Williams %R', weight: activeWeights.williamsR, weightPct: Math.round(activeWeights.williamsR / totalWeight * 100), rawScore: willrSignal.score, weighted: Math.round(willrSignal.score * activeWeights.williamsR / totalWeight * 100) / 100, label: willrSignal.label });
    if (activeWeights.obv) coreBreakdown.push({ name: 'OBV', weight: activeWeights.obv, weightPct: Math.round(activeWeights.obv / totalWeight * 100), rawScore: obvSignal.score, weighted: Math.round(obvSignal.score * activeWeights.obv / totalWeight * 100) / 100, label: obvSignal.label });

    return {
      symbol, price, prevClose, spark,
      weekChange: momentumSignal.weekChange,
      dataSource,

      indicators: {
        rsi: currentRSI != null ? Math.round(currentRSI * 10) / 10 : null,
        macd: currentMACD != null ? Math.round(currentMACD * 1000) / 1000 : null,
        macdSignal: currentMACDSignal != null ? Math.round(currentMACDSignal * 1000) / 1000 : null,
        macdHist: currentMACDHist != null ? Math.round(currentMACDHist * 1000) / 1000 : null,
        sma20: currentSMA20 != null ? Math.round(currentSMA20 * 100) / 100 : null,
        sma50: currentSMA50 != null ? Math.round(currentSMA50 * 100) / 100 : null,
        stochK: currentK != null ? Math.round(currentK * 10) / 10 : null,
        stochD: currentD != null ? Math.round(currentD * 10) / 10 : null,
        atr: currentATR != null ? Math.round(currentATR * 100) / 100 : null,
        bbUpper: currentBBUpper != null ? Math.round(currentBBUpper * 100) / 100 : null,
        bbLower: currentBBLower != null ? Math.round(currentBBLower * 100) / 100 : null,
        bbWidth: currentBBWidth != null ? Math.round(currentBBWidth * 10000) / 10000 : null,
        // New extended indicators
        adx: currentADX != null ? Math.round(currentADX * 10) / 10 : null,
        cci: currentCCI != null ? Math.round(currentCCI * 10) / 10 : null,
        williamsR: currentWILLR != null ? Math.round(currentWILLR * 10) / 10 : null,
        mfi: currentMFI != null ? Math.round(currentMFI * 10) / 10 : null,
        vwap: currentVWAP != null ? Math.round(currentVWAP * 100) / 100 : null,
        aroonUp: aroonVals.up != null ? Math.round(aroonVals.up * 10) / 10 : null,
        aroonDown: aroonVals.down != null ? Math.round(aroonVals.down * 10) / 10 : null,
      },

      signals: {
        rsi: rsiSignal, macd: macdSignal, sma: smaSignal, volume: volumeSignal,
        momentum: momentumSignal, stochastic: stochSignal,
        adx: adxSignal, cci: cciSignal, williamsR: willrSignal,
        mfi: mfiSignal, aroon: aroonSignal, obv: obvSignal,
      },

      compositeScore: Math.round(normalizedScore * 10) / 10,
      overallSignal, bullishCount, bearishCount,
      scoreBreakdown: coreBreakdown,
    };
  } catch (err) {
    console.log(`[TA] ${symbol} analysis failed:`, err.message);
    return null;
  }
}

/**
 * Analyze multiple stocks in batches with progress callback
 */
async function analyzeStocks(symbols, { batchSize = 4, onProgress = null } = {}) {
  const results = {};
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (sym) => {
        try {
          return { sym, result: await analyzeStock(sym) };
        } catch {
          return { sym, result: null };
        }
      })
    );
    batchResults.forEach(({ sym, result }) => {
      if (result) results[sym] = result;
    });
    if (onProgress) {
      onProgress({
        completed: Math.min(i + batchSize, symbols.length),
        total: symbols.length,
        results: { ...results },
      });
    }
  }
  return results;
}

/**
 * Quick single-indicator fetch from UW API (for chart overlays)
 */
async function getUWIndicator(symbol, indicator, params = {}) {
  return await fetchUWIndicator(symbol, indicator, params);
}

// ─── UI Helpers ───

function getSignalColor(signal) {
  switch (signal) {
    case 'strong_buy': return '#00E396';
    case 'buy':
    case 'bullish': return '#00E396';
    case 'strong_sell': return '#FF4560';
    case 'sell':
    case 'bearish': return '#FF4560';
    default: return '#7C7C9A';
  }
}

function getOverallColor(overallSignal) {
  if (overallSignal.includes('Buy')) return '#00E396';
  if (overallSignal.includes('Sell')) return '#FF4560';
  return '#FEB019';
}

module.exports = {
  // Primary public API (matches app named exports)
  analyzeStock,
  analyzeStocks,
  getUWIndicator,
  getSignalColor,
  getOverallColor,
  // Local indicator functions (for ChartScreen overlay use, like the app's bottom export)
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeStochastic,
  computeBollingerBands,
  computeATR,
};

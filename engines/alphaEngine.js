// ═══════════════════════════════════════════════════════════════════
// ALPHA ENGINE — Smart Money Scanner (v2 — Fast + Cached)
// Scans stocks where smart money is flowing.
// Combines 6 signal sources into a single conviction score 0-100.
//
// v2 improvements:
// - Fetch timeouts (8s per call)
// - Caching (results valid for 5 min)
// - Reduced enrichment calls (top 15, batched)
// - Graceful fallback when APIs are slow
//
// Node.js (CommonJS) port of the React Native app's src/data/alphaEngine.js.
// Logic, weights, thresholds, endpoint paths and pick assembly are unchanged.
// ═══════════════════════════════════════════════════════════════════

const { UW_CONFIG, YAHOO_HEADERS, UW_HEADERS } = require('./config');

const BASE = UW_CONFIG.BASE_URL;
const HEADERS = UW_HEADERS;

// ── Cache ──
let _cache = { data: null, time: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached() {
  if (_cache.data && Date.now() - _cache.time < CACHE_TTL) return _cache.data;
  return null;
}
function setCache(data) {
  _cache = { data, time: Date.now() };
}

// ── Fetch with timeout ──
async function uwFetch(path, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BASE}${path}`, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      if (res.status !== 404) console.log(`[Alpha-API] ${path} → ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json?.data ?? json;
  } catch (err) {
    console.log(`[Alpha-API] ${path} → ${err.name === 'AbortError' ? 'TIMEOUT' : err.message}`);
    return null;
  }
}

async function yahooFetch(url, timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { headers: YAHOO_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
// PHASE 1: Discover — Find WHERE smart money is going
// ═══════════════════════════════════════════

async function discoverAlphaTargets() {
  console.log('[Alpha] Phase 1: Discovering targets...');
  const symbolMap = new Map();

  const ensure = (sym) => {
    if (!sym || sym.length > 6) return null;
    const clean = sym.replace(/[^A-Z-]/gi, '').toUpperCase();
    if (!clean || clean.length === 0) return null;
    if (!symbolMap.has(clean)) {
      symbolMap.set(clean, {
        symbol: clean,
        flowAlerts: [],
        darkPoolPrints: [],
        insiderBuys: [],
        totalFlowPremium: 0,
        callPremium: 0,
        putPremium: 0,
        sweepCount: 0,
        blockCount: 0,
        darkPoolNotional: 0,
        darkPoolBullish: 0,
        insiderBuyValue: 0,
        signals: [],
        conviction: 0,
      });
    }
    return symbolMap.get(clean);
  };

  // Fetch all data sources in parallel (with timeouts)
  // Group A: always-available endpoints (work 24/7)
  // Group B: market-hours-only endpoints (empty after close)
  // 7 API calls total for discovery — all bulk endpoints (limit = results per call, NOT extra calls)
  const results = await Promise.allSettled([
    uwFetch('/screener/option-contracts?limit=100&order_by=total_premium&order=desc'),  // 0: hot chains
    uwFetch('/screener/stocks?limit=50&order_by=volume&order=desc'),                    // 1: stock screener
    uwFetch('/market/oi-change'),                                                        // 2: OI change
    uwFetch('/market/top-net-impact'),                                                   // 3: net impact
    uwFetch('/insider/transactions?limit=100'),                                          // 4: insiders
    uwFetch('/option-trades/flow-alerts?limit=200'),                                     // 5: flow alerts
    uwFetch('/darkpool/recent?limit=100'),                                               // 6: dark pool
  ]);

  const getValue = (r) => (r.status === 'fulfilled' ? r.value : null);
  const [hotChains, screenerStocks, oiChange, topImpact, insiders, flowAlerts, darkPool] = results.map(getValue);

  // Log which endpoints returned data
  const counts = [hotChains, screenerStocks, oiChange, topImpact, insiders, flowAlerts, darkPool]
    .map(v => Array.isArray(v) ? v.length : (v ? 'obj' : '0'));
  console.log(`[Alpha] API: chains=${counts[0]} screener=${counts[1]} oi=${counts[2]} impact=${counts[3]} insiders=${counts[4]} flow=${counts[5]} darkpool=${counts[6]}`);

  // ── Process Stock Screener (backbone — always has data) ──
  if (Array.isArray(screenerStocks)) {
    screenerStocks.forEach((s) => {
      const sym = s.ticker || s.symbol || s.ticker_symbol;
      const entry = ensure(sym);
      if (!entry) return;
      // UW screener uses various field names for change %
      const changePct = parseFloat(s.change_percent || s.price_change_percent || s.volatility_1d || s.day_change) || 0;
      entry.moverDirection = changePct > 0 ? 'up' : 'down';
      entry.moverChange = changePct;
      entry.moverName = s.name || s.company_name || s.full_name || '';
      // UW uses stock_volume, not just volume
      entry.moverVolume = parseInt(s.stock_volume || s.volume || s.avg_volume || s.avg_30_day_volume) || 0;
      entry.screenerPrice = parseFloat(s.price || s.last || s.close || s.stock_price) || 0;
      entry.screenerMarketCap = parseFloat(s.market_cap || s.marketCap || s.marketcap) || 0;
    });
  }

  // ── Process Hot Chains / Flow Alerts ──
  const allFlow = [];
  if (Array.isArray(hotChains)) allFlow.push(...hotChains);
  if (Array.isArray(flowAlerts)) allFlow.push(...flowAlerts);

  allFlow.forEach((f) => {
    // UW uses ticker_symbol (chains) or ticker (flow alerts)
    const sym = f.ticker || f.ticker_symbol || f.symbol || f.underlying_symbol;
    const entry = ensure(sym);
    if (!entry) return;

    const premium = parseFloat(f.total_premium || f.premium || f.cost_basis) || 0;
    // UW uses has_sweep (not is_sweep), sweep_volume for chains
    const isSweep = f.has_sweep || f.is_sweep || (parseInt(f.sweep_volume) > 0) || f.option_activity_type === 'SWEEP';
    // UW uses has_floor for block/floor trades
    const isBlock = f.has_floor || f.is_block || (parseInt(f.floor_volume) > 0) || f.option_activity_type === 'BLOCK';
    // UW uses 'type' field (e.g. "C" or "P"), also check put_call, option_type
    const typeStr = (f.type || f.put_call || f.option_type || '').toUpperCase();
    const isCall = typeStr.includes('C') || typeStr === 'CALL';
    const volume = parseInt(f.volume || f.size || f.trade_count || f.total_size) || 0;
    const oi = parseInt(f.open_interest || f.oi || f.prev_oi) || 0;
    // UW doesn't have sentiment field — use ask-side vs bid-side premium
    const askPrem = parseFloat(f.total_ask_side_prem || f.ask_side_volume) || 0;
    const bidPrem = parseFloat(f.total_bid_side_prem || f.bid_side_volume) || 0;
    const sentiment = (f.sentiment || f.trade_sentiment || f.aggressor || '').toUpperCase();
    const boughtAtAsk = sentiment.includes('BULLISH') || sentiment.includes('ASK') ||
                        (askPrem > 0 && askPrem > bidPrem);

    entry.flowAlerts.push({
      premium, isSweep, isBlock, isCall, volume, oi,
      strike: parseFloat(f.strike_price || f.strike) || 0,
      expiry: f.expiration_date || f.expiry || f.expires || '',
      iv: parseFloat(f.implied_volatility || f.iv || f.iv_start) || 0,
      time: f.executed_at || f.created_at || f.start_time || '',
      boughtAtAsk,
    });

    entry.totalFlowPremium += premium;
    if (isCall) entry.callPremium += premium;
    else entry.putPremium += premium;
    if (isSweep) entry.sweepCount++;
    if (isBlock) entry.blockCount++;
  });

  // ── Process Dark Pool ──
  if (Array.isArray(darkPool)) {
    darkPool.forEach((dp) => {
      const sym = dp.ticker || dp.ticker_symbol || dp.symbol;
      const entry = ensure(sym);
      if (!entry) return;

      const price = parseFloat(dp.price || dp.trade_price) || 0;
      const size = parseInt(dp.size || dp.volume || dp.shares) || 0;
      const notional = parseFloat(dp.notional_value || dp.dollar_value) || (price * size);
      const mktPrice = parseFloat(dp.underlying_price || dp.market_price || dp.nbbo_mid) || 0;
      const isBullish = mktPrice > 0 ? price >= mktPrice : true;

      entry.darkPoolPrints.push({ price, size, notional, mktPrice, isBullish });
      entry.darkPoolNotional += notional;
      if (isBullish) entry.darkPoolBullish += notional;
    });
  }

  // ── Process Insider Trades ──
  if (Array.isArray(insiders)) {
    insiders.forEach((ins) => {
      const sym = ins.ticker || ins.ticker_symbol || ins.symbol;
      const entry = ensure(sym);
      if (!entry) return;

      // UW insider API: amount > 0 = buy, amount < 0 = sell
      const amount = parseInt(ins.amount || ins.shares || ins.quantity) || 0;
      const price = parseFloat(ins.price || ins.avg_price) || 0;
      const type = (ins.transaction_type || ins.acquisition_or_disposition || ins.type || '').toUpperCase();
      const isBuy = amount > 0 || type.includes('BUY') || type.includes('PURCHASE') || type === 'A' || type.includes('ACQUI');
      // Calculate value: use total_value if available, otherwise amount * price
      const value = parseFloat(ins.total_value || ins.value || ins.cost) || (Math.abs(amount) * price);

      if (isBuy && value > 0) {
        entry.insiderBuys.push({
          name: ins.owner_name || ins.insider_name || ins.name || 'Insider',
          title: ins.insider_title || ins.title || '',
          value,
          shares: Math.abs(amount),
          date: ins.transaction_date || ins.filing_date || ins.date || '',
        });
        entry.insiderBuyValue += value;
      }
    });
  }

  // ── Process OI Change ──
  if (Array.isArray(oiChange)) {
    oiChange.forEach((oi) => {
      const sym = oi.ticker || oi.ticker_symbol || oi.symbol;
      const entry = ensure(sym);
      if (!entry) return;
      entry.oiChangeCall = parseFloat(oi.call_oi_change || oi.call_change) || 0;
      entry.oiChangePut = parseFloat(oi.put_oi_change || oi.put_change) || 0;
    });
  }

  // ── Process Top Net Impact ──
  if (Array.isArray(topImpact)) {
    topImpact.forEach((t) => {
      const sym = t.ticker || t.ticker_symbol || t.symbol;
      const entry = ensure(sym);
      if (!entry) return;
      entry.netImpact = parseFloat(t.net_impact || t.net_premium || t.value) || 0;
    });
  }

  console.log(`[Alpha] Discovered ${symbolMap.size} symbols with activity`);
  return symbolMap;
}

// ═══════════════════════════════════════════
// PHASE 2: Score — Rank by conviction
// ═══════════════════════════════════════════

function scoreAlphaTargets(symbolMap) {
  console.log('[Alpha] Phase 2: Scoring targets...');

  symbolMap.forEach((data) => {
    let conviction = 0;
    const signals = [];

    const flowScore = scoreOptionsFlow(data);
    conviction += flowScore.points;
    if (flowScore.points > 0) signals.push(...flowScore.signals);

    const dpScore = scoreDarkPool(data);
    conviction += dpScore.points;
    if (dpScore.points > 0) signals.push(...dpScore.signals);

    const insiderScore = scoreInsiders(data);
    conviction += insiderScore.points;
    if (insiderScore.points > 0) signals.push(...insiderScore.signals);

    const momScore = scoreMomentum(data);
    conviction += momScore.points;
    if (momScore.points > 0) signals.push(...momScore.signals);

    const oiScore = scoreOIChange(data);
    conviction += oiScore.points;
    if (oiScore.points > 0) signals.push(...oiScore.signals);

    // Multi-signal confluence bonus — multiple signal types = higher confidence
    const signalTypes = new Set(signals.map((s) => s.category));
    if (signalTypes.size >= 5) {
      conviction += 15;
      signals.push({ category: 'CONFLUENCE', icon: '🎯', text: '5+ signal types aligned — max confluence', points: 15 });
    } else if (signalTypes.size >= 4) {
      conviction += 12;
      signals.push({ category: 'CONFLUENCE', icon: '🎯', text: '4 signal types aligned', points: 12 });
    } else if (signalTypes.size >= 3) {
      conviction += 8;
      signals.push({ category: 'CONFLUENCE', icon: '🎯', text: '3 signal types aligned', points: 8 });
    } else if (signalTypes.size >= 2) {
      conviction += 4;
      signals.push({ category: 'CONFLUENCE', icon: '🎯', text: '2 signal types aligned', points: 4 });
    }

    data.conviction = Math.min(100, Math.max(0, conviction));
    data.signals = signals;
    data.signalCount = signalTypes.size;

  });
}

function scoreOptionsFlow(data) {
  let points = 0;
  const signals = [];

  // Baseline: having ANY flow alerts is meaningful
  const alertCount = data.flowAlerts.length;
  if (alertCount >= 10) {
    points += 8; signals.push({ category: 'FLOW', icon: '🔔', text: `${alertCount} flow alerts — heavy activity`, points: 8 });
  } else if (alertCount >= 5) {
    points += 5; signals.push({ category: 'FLOW', icon: '🔔', text: `${alertCount} flow alerts`, points: 5 });
  } else if (alertCount >= 2) {
    points += 3; signals.push({ category: 'FLOW', icon: '🔔', text: `${alertCount} flow alerts`, points: 3 });
  } else if (alertCount >= 1) {
    points += 2; signals.push({ category: 'FLOW', icon: '🔔', text: '1 flow alert', points: 2 });
  }

  // Premium — lowered thresholds (most flow alerts are $50K-$500K)
  if (data.totalFlowPremium >= 10000000) {
    points += 15; signals.push({ category: 'FLOW', icon: '🌊', text: `$${(data.totalFlowPremium / 1e6).toFixed(1)}M total premium`, points: 15 });
  } else if (data.totalFlowPremium >= 5000000) {
    points += 12; signals.push({ category: 'FLOW', icon: '🌊', text: `$${(data.totalFlowPremium / 1e6).toFixed(1)}M total premium`, points: 12 });
  } else if (data.totalFlowPremium >= 1000000) {
    points += 10; signals.push({ category: 'FLOW', icon: '🌊', text: `$${(data.totalFlowPremium / 1e6).toFixed(1)}M premium`, points: 10 });
  } else if (data.totalFlowPremium >= 500000) {
    points += 7; signals.push({ category: 'FLOW', icon: '🌊', text: `$${(data.totalFlowPremium / 1e3).toFixed(0)}K premium`, points: 7 });
  } else if (data.totalFlowPremium >= 100000) {
    points += 5; signals.push({ category: 'FLOW', icon: '🌊', text: `$${(data.totalFlowPremium / 1e3).toFixed(0)}K premium`, points: 5 });
  } else if (data.totalFlowPremium >= 25000) {
    points += 3; signals.push({ category: 'FLOW', icon: '🌊', text: `$${(data.totalFlowPremium / 1e3).toFixed(0)}K premium`, points: 3 });
  }

  // Sweeps
  if (data.sweepCount >= 5) {
    points += 10; signals.push({ category: 'FLOW', icon: '⚡', text: `${data.sweepCount} sweep orders — very aggressive`, points: 10 });
  } else if (data.sweepCount >= 2) {
    points += 6; signals.push({ category: 'FLOW', icon: '⚡', text: `${data.sweepCount} sweep orders`, points: 6 });
  } else if (data.sweepCount >= 1) {
    points += 3; signals.push({ category: 'FLOW', icon: '⚡', text: '1 sweep order', points: 3 });
  }

  // Block trades
  if (data.blockCount >= 3) {
    points += 5; signals.push({ category: 'FLOW', icon: '🏛️', text: `${data.blockCount} block trades`, points: 5 });
  } else if (data.blockCount >= 1) {
    points += 3; signals.push({ category: 'FLOW', icon: '🏛️', text: `${data.blockCount} block trade`, points: 3 });
  }

  // Bullish ask-side buying from flow alerts
  const askBuys = data.flowAlerts.filter(f => f.boughtAtAsk).length;
  if (askBuys >= 3) {
    points += 5; signals.push({ category: 'FLOW', icon: '🎯', text: `${askBuys} trades bought at ask — aggressive buying`, points: 5 });
  } else if (askBuys >= 1) {
    points += 2; signals.push({ category: 'FLOW', icon: '🎯', text: `${askBuys} trade bought at ask`, points: 2 });
  }

  // Call/put premium ratio
  if (data.callPremium > 0 && data.putPremium > 0) {
    const ratio = data.callPremium / data.putPremium;
    if (ratio >= 5) {
      points += 5; signals.push({ category: 'FLOW', icon: '📈', text: `${ratio.toFixed(1)}x call/put ratio — extreme bullish`, points: 5 });
    } else if (ratio >= 2) {
      points += 3; signals.push({ category: 'FLOW', icon: '📈', text: `${ratio.toFixed(1)}x call/put ratio — bullish`, points: 3 });
    }
  } else if (data.callPremium > 0 && data.putPremium === 0) {
    points += 4; signals.push({ category: 'FLOW', icon: '📈', text: 'All calls, zero puts', points: 4 });
  }

  return { points: Math.min(45, points), signals };
}

function scoreDarkPool(data) {
  let points = 0;
  const signals = [];

  // Lowered thresholds — any dark pool presence is notable
  if (data.darkPoolNotional >= 50000000) {
    points += 12; signals.push({ category: 'DARKPOOL', icon: '🏴', text: `$${(data.darkPoolNotional / 1e6).toFixed(0)}M dark pool volume`, points: 12 });
  } else if (data.darkPoolNotional >= 10000000) {
    points += 8; signals.push({ category: 'DARKPOOL', icon: '🏴', text: `$${(data.darkPoolNotional / 1e6).toFixed(0)}M dark pool`, points: 8 });
  } else if (data.darkPoolNotional >= 1000000) {
    points += 5; signals.push({ category: 'DARKPOOL', icon: '🏴', text: `$${(data.darkPoolNotional / 1e6).toFixed(1)}M dark pool`, points: 5 });
  } else if (data.darkPoolNotional >= 100000) {
    points += 3; signals.push({ category: 'DARKPOOL', icon: '🏴', text: `$${(data.darkPoolNotional / 1e3).toFixed(0)}K dark pool`, points: 3 });
  } else if (data.darkPoolPrints.length > 0) {
    points += 2; signals.push({ category: 'DARKPOOL', icon: '🏴', text: `${data.darkPoolPrints.length} dark pool prints`, points: 2 });
  }

  if (data.darkPoolNotional > 0) {
    const bullishPct = (data.darkPoolBullish / data.darkPoolNotional) * 100;
    if (bullishPct >= 80) {
      points += 8; signals.push({ category: 'DARKPOOL', icon: '🟢', text: `${bullishPct.toFixed(0)}% bullish dark pool prints`, points: 8 });
    } else if (bullishPct >= 60) {
      points += 4; signals.push({ category: 'DARKPOOL', icon: '🟢', text: `${bullishPct.toFixed(0)}% bullish dark pool`, points: 4 });
    }
  }

  return { points: Math.min(20, points), signals };
}

function scoreInsiders(data) {
  let points = 0;
  const signals = [];

  if (data.insiderBuys.length >= 3) {
    points += 10; signals.push({ category: 'INSIDER', icon: '👤', text: `${data.insiderBuys.length} insiders buying`, points: 10 });
  } else if (data.insiderBuys.length >= 1) {
    points += 5; signals.push({ category: 'INSIDER', icon: '👤', text: `${data.insiderBuys.length} insider buy`, points: 5 });
  }

  if (data.insiderBuyValue >= 5000000) {
    points += 5; signals.push({ category: 'INSIDER', icon: '💰', text: `$${(data.insiderBuyValue / 1e6).toFixed(1)}M insider purchase`, points: 5 });
  } else if (data.insiderBuyValue >= 500000) {
    points += 3; signals.push({ category: 'INSIDER', icon: '💰', text: `$${(data.insiderBuyValue / 1e3).toFixed(0)}K insider purchase`, points: 3 });
  }

  return { points: Math.min(15, points), signals };
}

function scoreMomentum(data) {
  let points = 0;
  const signals = [];

  if (data.moverChange) {
    const pct = Math.abs(data.moverChange) * (Math.abs(data.moverChange) < 1 ? 100 : 1);
    const dir = data.moverChange > 0 ? 'Up' : 'Down';
    if (pct >= 10) {
      points += 12; signals.push({ category: 'MOMENTUM', icon: '🚀', text: `${dir} ${pct.toFixed(1)}% today — explosive move`, points: 12 });
    } else if (pct >= 5) {
      points += 8; signals.push({ category: 'MOMENTUM', icon: '🚀', text: `${dir} ${pct.toFixed(1)}% today — strong momentum`, points: 8 });
    } else if (pct >= 2) {
      points += 5; signals.push({ category: 'MOMENTUM', icon: '📈', text: `${dir} ${pct.toFixed(1)}% today`, points: 5 });
    } else if (pct >= 1) {
      points += 3; signals.push({ category: 'MOMENTUM', icon: '📈', text: `${dir} ${pct.toFixed(1)}% today`, points: 3 });
    }
  }

  // Volume from screener — lowered thresholds
  if (data.moverVolume > 0) {
    if (data.moverVolume >= 50000000) {
      points += 7; signals.push({ category: 'MOMENTUM', icon: '🔥', text: `${(data.moverVolume / 1e6).toFixed(0)}M volume — massive activity`, points: 7 });
    } else if (data.moverVolume >= 20000000) {
      points += 5; signals.push({ category: 'MOMENTUM', icon: '🔥', text: `${(data.moverVolume / 1e6).toFixed(0)}M volume — heavy activity`, points: 5 });
    } else if (data.moverVolume >= 5000000) {
      points += 3; signals.push({ category: 'MOMENTUM', icon: '🔥', text: `${(data.moverVolume / 1e6).toFixed(0)}M volume — active`, points: 3 });
    } else if (data.moverVolume >= 1000000) {
      points += 2; signals.push({ category: 'MOMENTUM', icon: '🔥', text: `${(data.moverVolume / 1e6).toFixed(1)}M volume`, points: 2 });
    }
  }

  // Market cap bonus — large caps with unusual activity are more significant
  if (data.screenerMarketCap > 0) {
    if (data.screenerMarketCap >= 100e9) {
      points += 3; signals.push({ category: 'MOMENTUM', icon: '🏢', text: 'Mega cap stock', points: 3 });
    } else if (data.screenerMarketCap >= 10e9) {
      points += 2; signals.push({ category: 'MOMENTUM', icon: '🏢', text: 'Large cap stock', points: 2 });
    }
  }

  return { points: Math.min(22, points), signals };
}

function scoreOIChange(data) {
  let points = 0;
  const signals = [];

  if (data.oiChangeCall > 0 && data.oiChangePut !== undefined) {
    const callIncrease = data.oiChangeCall;
    if (callIncrease > 50000) {
      points += 8; signals.push({ category: 'POSITIONING', icon: '📊', text: `+${(callIncrease / 1e3).toFixed(0)}K call OI added`, points: 8 });
    } else if (callIncrease > 10000) {
      points += 5; signals.push({ category: 'POSITIONING', icon: '📊', text: `+${(callIncrease / 1e3).toFixed(0)}K call OI`, points: 5 });
    } else if (callIncrease > 2000) {
      points += 3; signals.push({ category: 'POSITIONING', icon: '📊', text: `+${(callIncrease / 1e3).toFixed(1)}K call OI`, points: 3 });
    }
  }

  if (data.netImpact > 0) {
    if (data.netImpact >= 5000000) {
      points += 8; signals.push({ category: 'POSITIONING', icon: '💎', text: `$${(data.netImpact / 1e6).toFixed(1)}M net bullish impact`, points: 8 });
    } else if (data.netImpact >= 1000000) {
      points += 5; signals.push({ category: 'POSITIONING', icon: '💎', text: `$${(data.netImpact / 1e6).toFixed(1)}M net impact`, points: 5 });
    } else if (data.netImpact >= 200000) {
      points += 3; signals.push({ category: 'POSITIONING', icon: '💎', text: `$${(data.netImpact / 1e3).toFixed(0)}K net impact`, points: 3 });
    }
  }

  return { points: Math.min(16, points), signals };
}

// ═══════════════════════════════════════════
// PHASE 3: Enrich — Add price & TA (fast, batched)
// ═══════════════════════════════════════════

async function enrichTopTargets(ranked, limit = 15) {
  console.log(`[Alpha] Phase 3: Enriching top ${limit} targets...`);

  const toEnrich = ranked.slice(0, limit);

  // Batch enrichment in groups of 5 to avoid hammering APIs
  const batchSize = 5;
  const enriched = [];

  for (let i = 0; i < toEnrich.length; i += batchSize) {
    const batch = toEnrich.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((data) => enrichSingle(data))
    );
    batchResults.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) enriched.push(r.value);
    });
  }

  return enriched;
}

async function enrichSingle(data) {
  try {
    // Use screener data first (already fetched in Phase 1 — zero extra API calls)
    if (data.screenerPrice) {
      data.price = data.screenerPrice;
      data.dayChange = data.moverChange || 0;
    }
    if (data.moverName) {
      data.name = data.moverName;
    }
    if (data.screenerMarketCap) {
      data.marketCap = data.screenerMarketCap;
    }
    if (data.moverVolume) {
      data.volume = data.moverVolume;
    }

    // Only fetch stock-state if we don't have price from screener (1 UW call max)
    if (!data.price || data.price === 0) {
      const ss = await uwFetch(`/stock/${data.symbol}/stock-state`, 5000);
      if (ss) {
        const s = Array.isArray(ss) ? ss[0] : ss;
        data.price = parseFloat(s.price || s.last || s.close || s.regularMarketPrice) || 0;
        data.prevClose = parseFloat(s.prev_close || s.previous_close || s.previousClose) || 0;
        data.volume = parseInt(s.volume || s.regularMarketVolume) || data.volume || 0;
        data.avgVolume = parseInt(s.avg_volume || s.averageDailyVolume10Day) || 0;
        data.marketCap = parseFloat(s.market_cap || s.marketCap) || data.marketCap || 0;
        data.name = s.name || s.company_name || data.name || '';
        data.dayChange = data.prevClose > 0
          ? ((data.price - data.prevClose) / data.prevClose) * 100
          : 0;
      }
    }

    // Volume surge bonus (use data we already have)
    if (data.avgVolume > 0 && data.volume > 0) {
      const volRatio = data.volume / data.avgVolume;
      if (volRatio >= 3) {
        data.conviction = Math.min(100, data.conviction + 5);
        data.signals.push({ category: 'VOLUME', icon: '📢', text: `${volRatio.toFixed(1)}x avg volume — massive surge`, points: 5 });
      } else if (volRatio >= 2) {
        data.conviction = Math.min(100, data.conviction + 3);
        data.signals.push({ category: 'VOLUME', icon: '📢', text: `${volRatio.toFixed(1)}x avg volume`, points: 3 });
      }
    }

    // Last resort: Yahoo for price (no UW call needed)
    if (!data.price || data.price === 0) {
      const yJson = await yahooFetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${data.symbol}?range=5d&interval=1d&includePrePost=true`,
        5000
      );
      if (yJson) {
        const meta = yJson?.chart?.result?.[0]?.meta || {};
        data.price = meta.regularMarketPrice || 0;
        data.prevClose = meta.chartPreviousClose || meta.previousClose || 0;
        data.name = data.name || meta.shortName || '';
        data.dayChange = data.prevClose > 0
          ? ((data.price - data.prevClose) / data.prevClose) * 100
          : 0;
      }
    }
  } catch (err) {
    console.log(`[Alpha] Enrich ${data.symbol} error:`, err.message);
  }

  console.log(`[Alpha] Enriched ${data.symbol}: price=$${data.price || 0}, name=${data.name || '?'}`);
  return data;
}

// ═══════════════════════════════════════════
// MAIN EXPORT — Run the full Alpha scan
// ═══════════════════════════════════════════

let _scanInProgress = null; // module-level lock — prevents duplicate concurrent scans

async function runAlphaScan(onProgress = null) {
  // If a scan is already running, wait for it instead of starting another
  if (_scanInProgress) {
    console.log('[Alpha] Scan already running — waiting for result');
    return _scanInProgress;
  }

  _scanInProgress = _runAlphaScanInner(onProgress);
  try {
    const result = await _scanInProgress;
    return result;
  } finally {
    _scanInProgress = null;
  }
}

async function _runAlphaScanInner(onProgress) {
  const startTime = Date.now();

  // Return cache if fresh
  const cached = getCached();
  if (cached) {
    console.log('[Alpha] Returning cached results');
    if (onProgress) onProgress({ phase: 4, message: 'Done!', pct: 100 });
    return cached;
  }

  try {
    // Phase 1: Discover
    if (onProgress) onProgress({ phase: 1, message: 'Scanning smart money flow...', pct: 10 });
    const symbolMap = await discoverAlphaTargets();

    if (symbolMap.size === 0) {
      console.log('[Alpha] No symbols discovered — API may be down');
      if (onProgress) onProgress({ phase: 4, message: 'No data available', pct: 100 });
      return [];
    }

    // Phase 2: Score
    if (onProgress) onProgress({ phase: 2, message: 'Scoring conviction levels...', pct: 40 });
    scoreAlphaTargets(symbolMap);

    // Filter — lower threshold so we get results even on quiet days
    const allTargets = Array.from(symbolMap.values());
    const ranked = allTargets
      .filter((t) => t.conviction >= 10 && t.signals.length >= 1)
      .sort((a, b) => b.conviction - a.conviction);

    console.log(`[Alpha] ${ranked.length} symbols passed conviction threshold`);

    // Phase 3: Enrich top 15 (most already have price from screener — minimal extra API calls)
    if (onProgress) onProgress({ phase: 3, message: 'Loading prices & details...', pct: 60 });
    const enriched = await enrichTopTargets(ranked, 15);

    // Final sort — include all enriched symbols (price 0 just means market closed)
    const alphaPicks = enriched
      .filter((d) => d.conviction >= 10)
      .sort((a, b) => b.conviction - a.conviction)
      .map((pick, i) => ({
        ...pick,
        rank: i + 1,
        tier: pick.conviction >= 70 ? 'FIRE' :
              pick.conviction >= 50 ? 'HOT' :
              pick.conviction >= 30 ? 'WARM' : 'WATCH',
      }));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Alpha] Scan complete: ${alphaPicks.length} picks in ${elapsed}s`);
    if (onProgress) onProgress({ phase: 4, message: 'Done!', pct: 100 });

    // Cache results
    if (alphaPicks.length > 0) setCache(alphaPicks);

    return alphaPicks;
  } catch (err) {
    console.log('[Alpha] Scan error:', err.message);
    if (onProgress) onProgress({ phase: 0, message: 'Scan failed', pct: 0 });
    return [];
  }
}

/**
 * Quick scan — faster version that skips enrichment.
 */
async function quickAlphaScan() {
  const cached = getCached();
  if (cached) return cached;

  try {
    const symbolMap = await discoverAlphaTargets();
    scoreAlphaTargets(symbolMap);
    const results = Array.from(symbolMap.values())
      .filter((t) => t.conviction >= 15)
      .sort((a, b) => b.conviction - a.conviction)
      .slice(0, 20)
      .map((pick, i) => ({
        ...pick,
        rank: i + 1,
        tier: pick.conviction >= 70 ? 'FIRE' :
              pick.conviction >= 50 ? 'HOT' :
              pick.conviction >= 30 ? 'WARM' : 'WATCH',
      }));
    if (results.length > 0) setCache(results);
    return results;
  } catch {
    return [];
  }
}

// ─── Formatting Helpers ───

function getConvictionColor(conviction) {
  if (conviction >= 70) return '#FF4500';
  if (conviction >= 50) return '#00A86B';
  if (conviction >= 30) return '#FEB019';
  return '#7C7C9A';
}

function getTierEmoji(tier) {
  switch (tier) {
    case 'FIRE': return '🔥';
    case 'HOT': return '🟢';
    case 'WARM': return '🟡';
    default: return '⚪';
  }
}

function formatConviction(conviction) {
  if (conviction >= 70) return 'FIRE';
  if (conviction >= 50) return 'HOT';
  if (conviction >= 30) return 'WARM';
  return 'WATCH';
}

module.exports = {
  runAlphaScan,
  quickAlphaScan,
  getConvictionColor,
  getTierEmoji,
  formatConviction,
};

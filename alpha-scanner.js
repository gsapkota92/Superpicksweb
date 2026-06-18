// ═══════════════════════════════════════════════════
// Alpha Scanner — Smart Money / Unusual Activity Engine
// Uses Unusual Whales API to find stocks with unusual
// options activity, dark pool trades, and insider buying
// ═══════════════════════════════════════════════════

// ── Configuration ──
const UW_API_KEY = 'b1babfa9-5705-4708-a60a-b065059c2ecf';
const UW_BASE = 'https://api.unusualwhales.com/api';
const UW_HEADERS = {
  'Authorization': `Bearer ${UW_API_KEY}`,
  'Accept': 'application/json',
};

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Top 20 most active tickers to scan option contracts for
const ACTIVE_TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AMD','INTC','MU',
  'PLTR','COIN','SQ','SOFI','HOOD','BA','NFLX','DIS','UBER','ABNB',
];

const SCAN_CACHE_MS = 5 * 60 * 1000; // 5-minute cache
const BATCH_SIZE = 3;                 // concurrent requests per batch
const BATCH_DELAY_MS = 500;           // delay between batches
const REQUEST_TIMEOUT_MS = 15000;     // per-request timeout

// ═══════════════════════════════════════════════════
// Utility helpers
// ═══════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with timeout wrapper (uses native fetch, Node 18+)
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run an array of async functions in batches of `size`, with a delay between batches.
 * Returns an array of settled results (value or null on error).
 */
async function batchRun(tasks, size = BATCH_SIZE, delayMs = BATCH_DELAY_MS) {
  const results = [];
  for (let i = 0; i < tasks.length; i += size) {
    const batch = tasks.slice(i, i + size);
    const settled = await Promise.allSettled(batch.map((fn) => fn()));
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : null);
    }
    if (i + size < tasks.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════
// Phase 1 — Discover targets from Unusual Whales
// ═══════════════════════════════════════════════════

/**
 * Fetch option contracts for a single ticker and return symbols with high volume.
 * Endpoint: GET /stock/{symbol}/option-contracts
 */
async function fetchOptionContracts(symbol) {
  try {
    const url = `${UW_BASE}/stock/${encodeURIComponent(symbol)}/option-contracts`;
    const res = await fetchWithTimeout(url, { headers: UW_HEADERS });
    if (!res.ok) {
      if (res.status === 429) console.warn(`[Alpha] Rate-limited on option-contracts for ${symbol}`);
      return [];
    }
    const json = await res.json();
    // The API may return data under various keys — try common shapes
    const contracts = json.data || json.contracts || json || [];
    if (!Array.isArray(contracts)) return [];

    // Look for contracts with notably high volume
    const highVol = contracts.filter((c) => {
      const vol = Number(c.volume || c.total_volume || c.vol || 0);
      const oi = Number(c.open_interest || c.oi || 0);
      // High volume relative to open interest signals unusual activity
      return vol > 1000 || (oi > 0 && vol / oi > 0.5);
    });

    if (highVol.length > 0) {
      // Tally calls vs puts for sentiment
      let calls = 0, puts = 0;
      for (const c of highVol) {
        const type = (c.option_type || c.type || c.contract_type || '').toLowerCase();
        if (type.startsWith('c') || type === 'call') calls++;
        else puts++;
      }
      return [{ symbol, source: 'options', callCount: calls, putCount: puts, contractCount: highVol.length }];
    }
    return [];
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[Alpha] option-contracts error for ${symbol}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch insider buying summary.
 * Endpoint: GET /insider/summary
 */
async function fetchInsiderSummary() {
  try {
    const url = `${UW_BASE}/insider/summary`;
    const res = await fetchWithTimeout(url, { headers: UW_HEADERS });
    if (!res.ok) {
      if (res.status === 429) console.warn('[Alpha] Rate-limited on insider/summary');
      return [];
    }
    const json = await res.json();
    const rows = json.data || json.insiders || json || [];
    if (!Array.isArray(rows)) return [];

    const results = [];
    for (const row of rows) {
      const sym = row.ticker || row.symbol || row.issuer_ticker || '';
      const txType = (row.transaction_type || row.filing_type || row.acquisition_or_disposition || '').toLowerCase();
      // Filter for purchases / acquisitions
      const isBuy = txType.includes('purchase') || txType.includes('buy') || txType === 'p' || txType === 'a';
      if (sym && isBuy) {
        results.push({ symbol: sym.toUpperCase(), source: 'insider' });
      }
    }
    return results;
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[Alpha] insider/summary error: ${err.message}`);
    return [];
  }
}

/**
 * Fetch recent dark pool transactions.
 * Endpoint: GET /darkpool/transactions?limit=100
 */
async function fetchDarkPoolTransactions() {
  try {
    const url = `${UW_BASE}/darkpool/transactions?limit=100`;
    const res = await fetchWithTimeout(url, { headers: UW_HEADERS });
    if (!res.ok) {
      if (res.status === 429) console.warn('[Alpha] Rate-limited on darkpool/transactions');
      return [];
    }
    const json = await res.json();
    const trades = json.data || json.transactions || json || [];
    if (!Array.isArray(trades)) return [];

    const results = [];
    for (const t of trades) {
      const sym = (t.ticker || t.symbol || '').toUpperCase();
      const vol = Number(t.volume || t.size || t.shares || 0);
      const notional = Number(t.notional_value || t.premium || t.total || 0);
      // Large dark pool print: > 50k shares or > $1M notional
      if (sym && (vol > 50000 || notional > 1000000)) {
        results.push({ symbol: sym, source: 'darkpool', volume: vol, notional });
      }
    }
    return results;
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[Alpha] darkpool/transactions error: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════
// Phase 2 — Score targets (0-100 conviction)
// ═══════════════════════════════════════════════════

/**
 * Build a scoring map from all discovered signals.
 * Returns Map<symbol, { conviction, sources, callPutRatio }>
 */
function scoreTargets(optionSignals, insiderSignals, darkpoolSignals) {
  const map = new Map(); // symbol -> { conviction, sources: Set, calls, puts, dpVolume }

  function ensure(sym) {
    if (!map.has(sym)) {
      map.set(sym, { conviction: 0, sources: new Set(), calls: 0, puts: 0, dpVolume: 0, dpNotional: 0 });
    }
    return map.get(sym);
  }

  // Options signals
  for (const sig of optionSignals) {
    if (!sig) continue;
    const entry = ensure(sig.symbol);
    entry.sources.add('options');
    entry.calls += sig.callCount || 0;
    entry.puts += sig.putCount || 0;
    entry.conviction += 20; // +20 for high options volume
  }

  // Insider buying
  for (const sig of insiderSignals) {
    if (!sig) continue;
    const entry = ensure(sig.symbol);
    entry.sources.add('insider');
    if (!entry._insiderCounted) {
      entry.conviction += 25; // +25 for insider buying (count once)
      entry._insiderCounted = true;
    }
  }

  // Dark pool
  for (const sig of darkpoolSignals) {
    if (!sig) continue;
    const entry = ensure(sig.symbol);
    entry.sources.add('darkpool');
    entry.dpVolume += sig.volume || 0;
    entry.dpNotional += sig.notional || 0;
    if (!entry._dpCounted) {
      entry.conviction += 25; // +25 for dark pool with large volume
      entry._dpCounted = true;
    }
  }

  // Multi-source bonus + sentiment bonus
  for (const [sym, entry] of map) {
    // +15 for appearing in multiple sources
    if (entry.sources.size >= 2) {
      entry.conviction += 15;
    }

    // +15 for bullish sentiment (call > put ratio)
    const totalContracts = entry.calls + entry.puts;
    if (totalContracts > 0 && entry.calls > entry.puts) {
      entry.conviction += 15;
    }

    // Clamp to 0-100
    entry.conviction = Math.max(0, Math.min(100, entry.conviction));

    // Clean up internal flags
    delete entry._insiderCounted;
    delete entry._dpCounted;
  }

  return map;
}

/**
 * Map conviction score to tier.
 */
function convictionToTier(conviction) {
  if (conviction >= 80) return 'S';
  if (conviction >= 60) return 'A';
  if (conviction >= 40) return 'B';
  if (conviction >= 20) return 'C';
  return null; // below threshold, skip
}

// ═══════════════════════════════════════════════════
// Phase 3 — Enrich top picks with Yahoo Finance data
// ═══════════════════════════════════════════════════

/**
 * Fetch 5-day price data from Yahoo Finance for a symbol.
 * Returns { price, dailyChange, name } or null.
 */
async function fetchYahooPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetchWithTimeout(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const quotes = result.indicators?.quote?.[0] || {};
    const closes = (quotes.close || []).filter((v) => v != null);

    const price = meta.regularMarketPrice || (closes.length > 0 ? closes[closes.length - 1] : 0);
    const prevClose = meta.chartPreviousClose || meta.previousClose || (closes.length > 1 ? closes[closes.length - 2] : price);
    const dailyChange = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const name = meta.shortName || meta.longName || meta.symbol || symbol;

    return {
      price: Math.round(price * 100) / 100,
      dailyChange: Math.round(dailyChange * 100) / 100,
      name,
    };
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[Alpha] Yahoo price error for ${symbol}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// Main export — runAlphaScan
// ═══════════════════════════════════════════════════

let lastScanTime = 0;

/**
 * Run the full alpha scan pipeline:
 *   Phase 1: Discover targets from UW endpoints
 *   Phase 2: Score and rank
 *   Phase 3: Enrich top 20 with Yahoo price data
 *
 * @param {Function} getStore - returns { alpha, alphaHistory, nextId }
 * @param {Function} persist  - saves the store to disk
 */
async function runAlphaScan(getStore, persist) {
  // ── Cache guard ──
  const now = Date.now();
  if (now - lastScanTime < SCAN_CACHE_MS) {
    const secsLeft = Math.round((SCAN_CACHE_MS - (now - lastScanTime)) / 1000);
    console.log(`[Alpha] Scan cached — next scan available in ${secsLeft}s`);
    return;
  }

  const startTime = Date.now();
  console.log('[Alpha] ══════════════════════════════════════════');
  console.log('[Alpha] Starting Smart Money Alpha Scan...');
  console.log('[Alpha] ══════════════════════════════════════════');

  // ────────────────────────────────────────────────
  // Phase 1 — Discover targets
  // ────────────────────────────────────────────────
  console.log('[Alpha] Phase 1: Discovering targets from Unusual Whales...');

  // 1a. Fetch option contracts for the top 20 active tickers (batched)
  const optionTasks = ACTIVE_TICKERS.map((sym) => () => fetchOptionContracts(sym));
  const optionResults = await batchRun(optionTasks, BATCH_SIZE, BATCH_DELAY_MS);
  const optionSignals = optionResults.flat().filter(Boolean);
  console.log(`[Alpha]   Options: found ${optionSignals.length} high-volume signals`);

  // 1b. Fetch insider summary (single request)
  await sleep(BATCH_DELAY_MS);
  const insiderSignals = await fetchInsiderSummary();
  console.log(`[Alpha]   Insider: found ${insiderSignals.length} buying signals`);

  // 1c. Fetch dark pool transactions (single request)
  await sleep(BATCH_DELAY_MS);
  const darkpoolSignals = await fetchDarkPoolTransactions();
  console.log(`[Alpha]   Darkpool: found ${darkpoolSignals.length} large prints`);

  // Collect all unique symbols
  const allSymbols = new Set();
  for (const s of optionSignals) if (s?.symbol) allSymbols.add(s.symbol);
  for (const s of insiderSignals) if (s?.symbol) allSymbols.add(s.symbol);
  for (const s of darkpoolSignals) if (s?.symbol) allSymbols.add(s.symbol);
  console.log(`[Alpha]   Total unique symbols discovered: ${allSymbols.size}`);

  // ────────────────────────────────────────────────
  // Phase 2 — Score targets
  // ────────────────────────────────────────────────
  console.log('[Alpha] Phase 2: Scoring targets...');

  const scoreMap = scoreTargets(optionSignals, insiderSignals, darkpoolSignals);

  // Sort by conviction descending, take top 20 (only if tier is C or above, i.e. >= 20)
  const ranked = Array.from(scoreMap.entries())
    .map(([symbol, data]) => ({
      symbol,
      conviction: data.conviction,
      tier: convictionToTier(data.conviction),
      sources: Array.from(data.sources),
    }))
    .filter((r) => r.tier !== null)
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, 20);

  console.log(`[Alpha]   Scored ${scoreMap.size} symbols, ${ranked.length} qualify (conviction >= 20)`);

  if (ranked.length === 0) {
    console.log('[Alpha] No qualifying targets found. Scan complete.');
    lastScanTime = Date.now();
    return;
  }

  // ────────────────────────────────────────────────
  // Phase 3 — Enrich with Yahoo Finance data
  // ────────────────────────────────────────────────
  console.log('[Alpha] Phase 3: Enriching top picks with Yahoo Finance price data...');

  const enrichTasks = ranked.map((pick) => () => fetchYahooPrice(pick.symbol));
  const yahooResults = await batchRun(enrichTasks, BATCH_SIZE, BATCH_DELAY_MS);

  const timestamp = new Date().toISOString();
  const enrichedPicks = [];

  for (let i = 0; i < ranked.length; i++) {
    const pick = ranked[i];
    const yahoo = yahooResults[i];

    enrichedPicks.push({
      symbol: pick.symbol,
      name: yahoo?.name || pick.symbol,
      price: yahoo?.price || 0,
      dailyChange: yahoo?.dailyChange || 0,
      conviction: pick.conviction,
      tier: pick.tier,
      sources: pick.sources,
      updatedAt: timestamp,
    });
  }

  console.log(`[Alpha]   Enriched ${enrichedPicks.length} picks`);

  // ────────────────────────────────────────────────
  // Persist to store
  // ────────────────────────────────────────────────
  const store = getStore();
  store.alpha = enrichedPicks;

  // Append a snapshot to alphaHistory (keep last 50 scans)
  if (!Array.isArray(store.alphaHistory)) store.alphaHistory = [];
  store.alphaHistory.push({
    scannedAt: timestamp,
    pickCount: enrichedPicks.length,
    topPick: enrichedPicks[0]?.symbol || 'N/A',
    topConviction: enrichedPicks[0]?.conviction || 0,
  });
  if (store.alphaHistory.length > 50) {
    store.alphaHistory.splice(0, store.alphaHistory.length - 50);
  }

  persist();
  lastScanTime = Date.now();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('[Alpha] ══════════════════════════════════════════');
  console.log(`[Alpha] Scan complete in ${elapsed}s`);
  console.log(`[Alpha]   Picks: ${enrichedPicks.length}`);
  for (const p of enrichedPicks.slice(0, 5)) {
    console.log(`[Alpha]   ${p.tier} | ${p.symbol.padEnd(6)} | conviction ${p.conviction} | $${p.price} (${p.dailyChange > 0 ? '+' : ''}${p.dailyChange}%) | ${p.sources.join(', ')}`);
  }
  if (enrichedPicks.length > 5) {
    console.log(`[Alpha]   ... and ${enrichedPicks.length - 5} more`);
  }
  console.log('[Alpha] ══════════════════════════════════════════');

  return {
    pickCount: enrichedPicks.length,
    elapsed: parseFloat(elapsed),
    topPick: enrichedPicks[0]?.symbol || null,
  };
}

module.exports = { runAlphaScan };

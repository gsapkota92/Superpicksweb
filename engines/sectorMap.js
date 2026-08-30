// ═══════════════════════════════════════════════════════════════════
// Sector Map engine — ported from the mobile app
//
// Generated from the app's src/data/sectorMapData.js and
// sectorMapService.js so both compute identical rotation numbers.
// Converted to CommonJS; the app's AsyncStorage cache is dropped here
// because the server persists through its own data/ directory instead.
//
// Two independent scans: equities benchmarked against SPY, crypto against
// BTC on its own 24/7 calendar.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// Sector Map — universe, window definitions and scan snapshot
//
// 369 symbols across 12 sectors and 54 sub-sectors, plus 13 benchmark
// ETFs. Crypto is a first-class sector: majors, alt-L1/DeFi, miners
// and treasury companies, crypto brokers, and the spot ETFs.
//
// Tickers inside each sub-sector are ordered most-liquid-first. The
// CORE tier scans the first 3 of each (fast); the FULL tier scans
// everything (slower, best breadth for spotting a turn early).
//
// SNAPSHOT is the Aug 28 2026 close scan — it seeds the screen on a
// cold start and backfills anything the live scan cannot reach.
// ═══════════════════════════════════════════════════════════════════

const SECTOR_GROUPS = {
  'TECH': {
    'Consumer tech / platforms': ['AAPL', 'PLTR', 'APP', 'SHOP', 'UBER', 'DASH'],
    'Semis': ['NVDA', 'AVGO', 'AMD', 'TSM', 'MRVL', 'QCOM', 'TXN', 'ADI', 'INTC', 'ASML', 'AMAT', 'LRCX', 'KLAC', 'ARM', 'ON', 'SMCI', 'SOXX'],
    'Memory / hardware': ['MU', 'SNDK', 'DELL', 'ANET', 'WDC', 'STX', 'NTAP', 'HPQ'],
    'Software': ['MSFT', 'ORCL', 'CRM', 'NOW', 'ADBE', 'INTU', 'SNOW', 'DDOG', 'NET', 'MDB', 'HUBS', 'TEAM', 'WDAY', 'ESTC', 'IGV'],
    'Cybersecurity': ['CRWD', 'PANW', 'ZS', 'FTNT', 'S', 'OKTA'],
  },
  'HEALTH CARE': {
    'Pharma': ['LLY', 'MRK', 'ABBV', 'JNJ', 'PFE', 'BMY', 'AZN', 'NVO', 'GSK'],
    'Biotech': ['MRNA', 'AMGN', 'GILD', 'VRTX', 'REGN', 'BIIB', 'ALNY', 'INCY', 'XBI'],
    'Life-sci tools': ['TMO', 'DHR', 'IQV', 'A', 'WAT', 'MTD', 'RVTY'],
    'Med devices': ['ISRG', 'MDT', 'BSX', 'SYK', 'ABT', 'EW', 'GEHC', 'ZBH', 'BAX'],
    'Managed care': ['UNH', 'ELV', 'CI', 'CVS', 'HUM', 'CNC'],
  },
  'FINANCIALS': {
    'Money-center banks': ['JPM', 'BAC', 'C', 'WFC'],
    'IB / brokers': ['GS', 'MS', 'SCHW', 'IBKR', 'RJF'],
    'Regionals / insurers / AM': ['BLK', 'PGR', 'KRE', 'KIE', 'PNC', 'USB', 'TFC', 'MET', 'TRV', 'CB'],
    'Exchanges / data': ['CME', 'ICE', 'SPGI', 'NDAQ', 'MCO'],
    'Payments / fintech': ['V', 'MA', 'PYPL', 'GPN', 'TOST', 'AFRM', 'SOFI'],
  },
  'ENERGY': {
    'Refiners': ['MPC', 'VLO', 'PSX', 'DINO', 'PBF', 'PARR', 'DK'],
    'E&P / Integrated': ['XOM', 'CVX', 'COP', 'EOG', 'OXY', 'FANG', 'DVN', 'APA', 'MTDR'],
    'Oil services': ['SLB', 'HAL', 'BKR', 'OII', 'INVX', 'NOV', 'RIG', 'WFRD'],
    'Tankers / Midstream': ['ET', 'KMI', 'WMB', 'OKE', 'EPD', 'INSW', 'FRO', 'STNG', 'TNK'],
    'Uranium / nuclear': ['CCJ', 'URA', 'LEU', 'SMR', 'OKLO', 'NXE'],
    'Nat gas / coal': ['EQT', 'LNG', 'AR', 'RRC', 'BTU'],
  },
  'MATERIALS': {
    'Copper': ['FCX', 'SCCO', 'TECK', 'COPX'],
    'Gold miners': ['NEM', 'GDX', 'AEM', 'KGC', 'GOLD', 'GDXJ'],
    'Silver': ['PAAS', 'SIL', 'AG', 'HL'],
    'Ag / fertilizer': ['DE', 'NTR', 'CF', 'MOS', 'ADM', 'BG'],
    'Steel / aluminum': ['NUE', 'STLD', 'CLF', 'AA', 'CENX'],
    'Chemicals': ['LIN', 'APD', 'SHW', 'DOW', 'LYB'],
    'Lithium / rare earth': ['ALB', 'MP', 'SQM', 'LAC'],
  },
  'INDUSTRIALS': {
    'Aerospace / defense': ['BA', 'RTX', 'LMT', 'GE', 'NOC', 'GD', 'LHX', 'HWM', 'LDOS', 'CACI', 'ITA'],
    'Machinery': ['CAT', 'ETN', 'PH', 'CMI', 'EMR', 'PCAR'],
    'Transports': ['UNP', 'UPS', 'FDX', 'CSX', 'NSC', 'ODFL', 'IYT'],
    'Power infra / electrical': ['GEV', 'VRT', 'PWR', 'NVT', 'AOS'],
  },
  'DISCRETIONARY': {
    'Retail': ['AMZN', 'HD', 'LOW', 'TJX', 'ROST', 'ORLY', 'AZO', 'TGT', 'BBY'],
    'Restaurants': ['MCD', 'SBUX', 'CMG', 'DRI', 'WING'],
    'Autos / EV': ['TSLA', 'GM', 'F', 'RIVN', 'LCID'],
    'Travel / leisure': ['BKNG', 'ABNB', 'MAR', 'HLT', 'RCL', 'CCL', 'DAL', 'UAL', 'LUV'],
    'Homebuilders': ['DHI', 'LEN', 'PHM', 'NVR', 'XHB'],
  },
  'COMM SERVICES': {
    'Internet / media': ['GOOGL', 'META', 'NFLX', 'DIS', 'SPOT'],
    'Intl internet': ['BABA', 'PDD', 'MELI', 'SE', 'JD'],
    'Telecom': ['TMUS', 'T', 'VZ', 'CMCSA', 'CHTR'],
    'Gaming / entertainment': ['TTWO', 'RBLX', 'LYV', 'WBD', 'PARA'],
  },
  'STAPLES': {
    'Beverages / food': ['KO', 'PEP', 'MNST', 'MDLZ', 'KDP', 'GIS', 'HSY'],
    'Household / personal': ['PG', 'CL', 'KMB', 'CHD', 'EL'],
    'Retail staples': ['WMT', 'COST', 'KR', 'DG', 'DLTR'],
    'Tobacco / alcohol': ['PM', 'MO', 'STZ', 'TAP'],
  },
  'UTILITIES': {
    'Regulated': ['NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'ED'],
    'Power / IPP': ['VST', 'CEG', 'NRG', 'TLN', 'PEG'],
  },
  'REAL ESTATE': {
    'Data centers / towers': ['EQIX', 'DLR', 'AMT', 'CCI', 'SBAC'],
    'REITs': ['PLD', 'O', 'SPG', 'PSA', 'WELL', 'VICI', 'IRM'],
  },
  'CRYPTO': {
    'Majors': ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BNB-USD', 'DOGE-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD', 'HBAR-USD', 'TRX-USD', 'DOT-USD', 'LTC-USD', 'ATOM-USD'],
    'Alt L1 / DeFi': ['ONDO-USD', 'TIA-USD', 'RENDER-USD', 'FET-USD', 'APT-USD', 'ARB-USD', 'OP-USD', 'UNI-USD', 'AAVE-USD', 'INJ-USD', 'NEAR-USD', 'ICP-USD', 'SHIB-USD'],
    'Miners / treasuries': ['MSTR', 'MARA', 'RIOT', 'CLSK', 'CIFR', 'WULF', 'HUT', 'HIVE'],
    'Crypto equities': ['COIN', 'HOOD', 'GLXY', 'BLSH'],
    'Spot ETFs': ['IBIT', 'ETHA'],
  },
};

// ─── Asset classes ───
// Equities and crypto are scanned by separate engines: they trade on
// different calendars, answer to different benchmarks, and move at
// different speeds. Everything below is keyed by class.
const ASSET_CLASSES = [
  { key: 'equity', label: 'Stocks', benchmark: 'SPY',     short: 'SPY' },
  { key: 'crypto', label: 'Crypto', benchmark: 'BTC-USD', short: 'BTC' },
];

const CRYPTO_SECTOR = 'CRYPTO';

const EQUITY_GROUPS = Object.fromEntries(
  Object.entries(SECTOR_GROUPS).filter(([k]) => k !== CRYPTO_SECTOR),
);
const CRYPTO_GROUPS = Object.fromEntries(
  Object.entries(SECTOR_GROUPS).filter(([k]) => k === CRYPTO_SECTOR),
);

function groupsFor(assetClass) {
  return assetClass === 'crypto' ? CRYPTO_GROUPS : EQUITY_GROUPS;
}

function benchmarkFor(assetClass) {
  return assetClass === 'crypto' ? 'BTC-USD' : 'SPY';
}

// Kept for anything still asking for the equity benchmark by name.
const BENCHMARK = 'SPY';

// Sector ETFs — the ranking strip at the top of the map.
// The strip at the top of the crypto map: what the rest of the sector is
// measured against, the way the sector ETFs work for equities.
const CRYPTO_BENCHMARKS = [
  { symbol: 'BTC-USD',  label: 'Bitcoin',   short: 'BTC'  },
  { symbol: 'ETH-USD',  label: 'Ethereum',  short: 'ETH'  },
  { symbol: 'SOL-USD',  label: 'Solana',    short: 'SOL'  },
  { symbol: 'XRP-USD',  label: 'XRP',       short: 'XRP'  },
  { symbol: 'IBIT',     label: 'BTC spot ETF', short: 'IBIT' },
  { symbol: 'COIN',     label: 'Coinbase',  short: 'COIN' },
];

function benchmarkStripFor(assetClass) {
  return assetClass === 'crypto' ? CRYPTO_BENCHMARKS : SECTOR_ETFS;
}

const SECTOR_ETFS = [
  { symbol: 'SPY', label: 'S&P 500', short: 'SPY' },
  { symbol: 'XLK', label: 'Technology', short: 'Tech' },
  { symbol: 'XLV', label: 'Health Care', short: 'Health' },
  { symbol: 'XLE', label: 'Energy', short: 'Energy' },
  { symbol: 'XLF', label: 'Financials', short: 'Financials' },
  { symbol: 'XLB', label: 'Materials', short: 'Materials' },
  { symbol: 'XLI', label: 'Industrials', short: 'Industrials' },
  { symbol: 'XLC', label: 'Comm Svcs', short: 'Comm' },
  { symbol: 'XLY', label: 'Discretionary', short: 'Discretionary' },
  { symbol: 'XLP', label: 'Staples', short: 'Staples' },
  { symbol: 'XLU', label: 'Utilities', short: 'Utilities' },
  { symbol: 'XLRE', label: 'Real Estate', short: 'Real Estate' },
  { symbol: 'IBIT', label: 'Bitcoin (spot)', short: 'Crypto' },
];

// Per-sector display accent (keys resolved against the theme at render).
const SECTOR_STYLE = {
  'TECH':           { icon: '▲', tint: 'accent' },
  'CRYPTO':         { icon: '◈', tint: 'purple' },
  'ENERGY':         { icon: '▮', tint: 'orange' },
  'HEALTH CARE':    { icon: '✚', tint: 'cyan' },
  'FINANCIALS':     { icon: '$', tint: 'green' },
  'MATERIALS':      { icon: '◆', tint: 'gold' },
  'INDUSTRIALS':    { icon: '⚙', tint: 'textSecondary' },
  'DISCRETIONARY':  { icon: '◐', tint: 'accentLight' },
  'COMM SERVICES':  { icon: '◎', tint: 'purple' },
  'STAPLES':        { icon: '▪', tint: 'textSecondary' },
  'UTILITIES':      { icon: '⚡', tint: 'gold' },
  'REAL ESTATE':    { icon: '▤', tint: 'textSecondary' },
};

const CORE_PER_SUB = 3;

// ─── Return windows ───
// 'session' windows count trading sessions on the benchmark's calendar,
// so a 7-day-a-week crypto chart and a 5-day-a-week stock are measured
// over the same stretch of wall-clock time. 'calendar' windows use dates.
// `n` is trading sessions for equities. Crypto has a bar every day, so the
// same window is a different number of bars: a week is 5 sessions of SPY but
// 7 days of BTC. `nCrypto` keeps both classes covering the same wall-clock span.
const WINDOWS = [
  { key: '1D',  kind: 'session',  n: 1, nCrypto: 1,   label: '1D'  },
  { key: '3D',  kind: 'session',  n: 3, nCrypto: 3,   label: '3D'  },
  { key: '1W',  kind: 'session',  n: 5, nCrypto: 7,   label: '1W'  },
  { key: '2W',  kind: 'session',  n: 10, nCrypto: 14,  label: '2W'  },
  { key: '3W',  kind: 'session',  n: 15, nCrypto: 21,  label: '3W'  },
  { key: '1M',  kind: 'calendar', n: 1,   label: '1M'  },
  { key: '3M',  kind: 'calendar', n: 3,   label: '3M'  },
  { key: '6M',  kind: 'calendar', n: 6,   label: '6M'  },
  { key: 'YTD', kind: 'ytd',      n: 0,   label: 'YTD' },
  { key: '1Y',  kind: 'calendar', n: 12,  label: '1Y'  },
];

const WINDOW_KEYS = WINDOWS.map((w) => w.key);

// Windows offered in the period selector (3W stays computed but hidden —
// the trend engine uses it, the pill bar does not need it).
const PERIODS = WINDOWS.filter((w) => w.key !== '3W');

// Approximate trading days in each window — used to convert a return
// into a pace (%/day) so windows of different length can be compared.
const WINDOW_DAYS = {
  '1D': 1, '3D': 3, '1W': 5, '2W': 10, '3W': 15,
  '1M': 21, '3M': 63, '6M': 126, 'YTD': 160, '1Y': 252,
};

// Typical move size per window — sets the heat map's color scale so a
// +3% week and a +40% year both read as "hot".
// Crypto ranges are wider than equities, so the heat map uses its own
// scale — otherwise every coin saturates to full green or full red.
const HEAT_SCALE_CRYPTO = {
  SINCE: 2.5,
  '1D': 4, '3D': 7, '1W': 10, '2W': 14, '3W': 17,
  '1M': 22, '3M': 40, '6M': 60, 'YTD': 80, '1Y': 110,
};

function heatScaleFor(assetClass) {
  return assetClass === 'crypto' ? HEAT_SCALE_CRYPTO : HEAT_SCALE;
}

const HEAT_SCALE = {
  SINCE: 1.2,
  '1D': 1.5, '3D': 2.5, '1W': 3.5, '2W': 5, '3W': 6,
  '1M': 8, '3M': 15, '6M': 30, 'YTD': 40, '1Y': 60,
};

// The "what moved since the last checkpoint" pseudo-window. It isn't
// fetched like the others — it's the change between two scans — but it
// slots into the same period selector and heat map.
const SINCE_KEY = 'SINCE';

// ─── Setup tags ───
const SETUPS = {
  'LEADER':           { label: 'Leader',   desc: 'Above a rising 50 and 200-DMA with positive 3M relative strength vs SPY' },
  'LEADER-PULLBACK':  { label: 'Entry zone', desc: 'Leader with RSI 45-60 and under 8% above its 50-DMA — the buy-the-dip window' },
  'LEADER-EXTENDED':  { label: 'Extended', desc: 'Leader with RSI over 70 or more than 18% above its 50-DMA — let it cool off' },
  'PULLBACK-WATCH':   { label: 'Watch',    desc: 'Below the 50-DMA but holding a rising 200-DMA — a dip candidate if it holds' },
  'BROKEN':           { label: 'Broken',   desc: 'Below the 200-DMA or more than 20% off its 52-week high' },
  'NEUTRAL':          { label: 'Neutral',  desc: 'No clear trend signal either way' },
};

// ─── Trend signals ───
// These are the "catch it early" flags: things that just changed, rather
// than things that have been true for months.
const SIGNALS = {
  NEW_HIGH:     { label: 'New high',    icon: '⤒', tint: 'green',  desc: 'Closed within 1% of its 52-week high' },
  BREAKOUT:     { label: 'Breakout',    icon: '↗', tint: 'green',  desc: 'Within 4% of the 52-week high, above a rising 50-DMA, positive over the last month' },
  ACCELERATING: { label: 'Accelerating',icon: '⇈', tint: 'cyan',   desc: 'Rising faster over the last month than it was over the last quarter' },
  GOLDEN_CROSS: { label: 'Golden cross',icon: '✕', tint: 'green',  desc: '50-DMA crossed above the 200-DMA within the last 30 sessions' },
  RSI_RESET:    { label: 'RSI reset',   icon: '↺', tint: 'accent', desc: 'Uptrend intact but RSI has cooled to 40-55 — the pullback entry' },
  VOL_SURGE:    { label: 'Volume surge',icon: '≋', tint: 'gold',   desc: '10-day average volume running 50% above the 50-day average' },
  STALLING:     { label: 'Stalling',    icon: '⇊', tint: 'orange', desc: 'Still up over the quarter but decelerating hard over the last month' },
  DEATH_CROSS:  { label: 'Death cross', icon: '✖', tint: 'red',    desc: '50-DMA crossed below the 200-DMA within the last 30 sessions' },
  BREAKDOWN:    { label: 'Breakdown',   icon: '↘', tint: 'red',    desc: 'Lost the 200-DMA within the last 15 sessions' },
};

const SNAPSHOT_ASOF = '2026-08-28';

const SNAPSHOT = {
  A: { sector: 'HEALTH CARE', subsector: 'Life-sci tools', 'YTD': 13.7, '6M': 27.3, '3M': 13.9, '1M': 9.5, '3W': 5.4, '2W': 3.6, '1W': -3.2, '3D': -0.6, price: 153.84, rsi14: 61, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 9.8, from52wHigh: -3.2, rs3m: 11.5, rs6m: 16, volRatio: 1.23, setup: 'LEADER' },
  ABBV: { sector: 'HEALTH CARE', subsector: 'Pharma', 'YTD': 14.5, '6M': 11.8, '3M': 17.7, '1M': -2.9, '3W': 3.8, '2W': 2.4, '1W': -3.6, '3D': -3.9, price: 255.48, rsi14: 51, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 1.7, from52wHigh: -3.9, rs3m: 18.8, rs6m: -1.7, volRatio: 0.65, setup: 'LEADER-PULLBACK' },
  AMD: { sector: 'TECH', subsector: 'Semis', 'YTD': 117.4, '6M': 132.5, '3M': -10.1, '1M': 2.4, '3W': -3.7, '2W': -9.5, '1W': -1.6, '3D': -2.8, price: 465.58, rsi14: 45, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -8, from52wHigh: -19.9, rs3m: -10.2, rs6m: 108, volRatio: 0.65, setup: 'PULLBACK-WATCH' },
  AMGN: { sector: 'HEALTH CARE', subsector: 'Biotech', 'YTD': 34.8, '6M': 12.9, '3M': 29.3, '1M': 10.6, '3W': 5.8, '2W': 4.8, '1W': -1.6, '3D': -2.2, price: 432.42, rsi14: 65, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 12, from52wHigh: -2.6, rs3m: 30, rs6m: 0.8, volRatio: 0.91, setup: 'LEADER' },
  APA: { sector: 'ENERGY', subsector: 'E&P / Integrated', 'YTD': 78, '6M': 42, '3M': 17.3, '1M': 21.8, '3W': 13, '2W': 5.1, '1W': -2, '3D': 2.9, price: 42.54, rsi14: 62, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 15.9, from52wHigh: -4.2, rs3m: 11.6, rs6m: 20.8, volRatio: 0.98, setup: 'LEADER' },
  AVGO: { sector: 'TECH', subsector: 'Semis', 'YTD': 6.9, '6M': 15.8, '3M': -13.4, '1M': -3.2, '3W': -13.8, '2W': -6.2, '1W': 0.1, '3D': 3.4, price: 368.79, rsi14: 43, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -4.5, from52wHigh: -23.3, rs3m: -21, rs6m: 3, volRatio: 0.96, setup: 'PULLBACK-WATCH' },
  BAC: { sector: 'FINANCIALS', subsector: 'Money-center banks', 'YTD': 14.5, '6M': 26.4, '3M': 23.4, '1M': -0.5, '3W': -1.3, '2W': -3.4, '1W': 1, '3D': -0.2, price: 62.32, rsi14: 51, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 2, from52wHigh: -3.8, rs3m: 19.6, rs6m: 12.2, volRatio: 0.94, setup: 'LEADER-PULLBACK' },
  BLK: { sector: 'FINANCIALS', subsector: 'Regionals / insurers / AM', 'YTD': 10, '6M': 10.8, '3M': 11.9, '1M': 6.1, '3W': 2.5, '2W': -0.8, '1W': 0.7, '3D': -1, price: 1164.48, rsi14: 60, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 7.8, from52wHigh: -1.6, rs3m: 12.8, rs6m: -2.2, volRatio: 0.74, setup: 'LEADER-PULLBACK' },
  BSX: { sector: 'HEALTH CARE', subsector: 'Med devices', 'YTD': -50.9, '6M': -39.1, '3M': -4.6, '1M': 1.7, '3W': -5, '2W': -9.6, '1W': -7, '3D': -6.1, price: 46.84, rsi14: 43, above50: true, above200: false, ma50Rising: true, ma200Rising: false, vs50dma: 0.6, from52wHigh: -56.7, rs3m: -4, rs6m: -45.5, volRatio: 1.04, setup: 'BROKEN' },
  C: { sector: 'FINANCIALS', subsector: 'Money-center banks', 'YTD': 15.6, '6M': 21.8, '3M': 7.1, '1M': 0.8, '3W': -1.6, '2W': -4.6, '1W': 0.9, '3D': -0.3, price: 132.9, rsi14: 47, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -2.2, from52wHigh: -8.3, rs3m: 1.8, rs6m: 6.9, volRatio: 0.76, setup: 'PULLBACK-WATCH' },
  CF: { sector: 'MATERIALS', subsector: 'Ag / fertilizer', 'YTD': 65, '6M': 27.5, '3M': 8.5, '1M': 2.9, '3W': 10.6, '2W': 6.3, '1W': -2.9, '3D': -1.2, price: 125.79, rsi14: 57, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 7, from52wHigh: -7.7, rs3m: 9.7, rs6m: 8, volRatio: 0.96, setup: 'LEADER-PULLBACK' },
  CI: { sector: 'HEALTH CARE', subsector: 'Managed care', 'YTD': 2.5, '6M': -2.7, '3M': -1.3, '1M': -7.4, '3W': -1.3, '2W': -1.3, '1W': 0.5, '3D': -0.2, price: 278.88, rsi14: 48, above50: false, above200: true, ma50Rising: false, ma200Rising: false, vs50dma: -1.6, from52wHigh: -8.8, rs3m: 0.6, rs6m: -13.9, volRatio: 0.79, setup: 'NEUTRAL' },
  COIN: { sector: 'CRYPTO', subsector: 'Crypto equities', 'YTD': -21, '6M': 1.6, '3M': -2, '1M': 6.4, '3W': 16.3, '2W': 20.3, '1W': -4.2, '3D': -4.6, price: 178.64, rsi14: 57, above50: true, above200: false, ma50Rising: true, ma200Rising: false, vs50dma: 11.4, from52wHigh: -53.9, rs3m: -3.8, rs6m: -14.4, volRatio: 1.39, setup: 'BROKEN' },
  COP: { sector: 'ENERGY', subsector: 'E&P / Integrated', 'YTD': 42.3, '6M': 16.5, '3M': 14.1, '1M': 15, '3W': 11.6, '2W': 3.5, '1W': -3.4, '3D': -1.1, price: 130.35, rsi14: 62, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 11.5, from52wHigh: -3.4, rs3m: 11.6, rs6m: -0.8, volRatio: 0.95, setup: 'LEADER' },
  CRM: { sector: 'TECH', subsector: 'Software', 'YTD': -2.9, '6M': 32.1, '3M': 45.7, '1M': 41, '3W': 32.8, '2W': 30.5, '1W': 22.4, '3D': 24.5, price: 256, rsi14: 81, above50: true, above200: true, ma50Rising: true, ma200Rising: false, vs50dma: 41.5, from52wHigh: -3.4, rs3m: 20.4, rs6m: 18.3, volRatio: 1.27, setup: 'NEUTRAL' },
  CRWD: { sector: 'TECH', subsector: 'Cybersecurity', 'YTD': 86.4, '6M': 134.9, '3M': 30.2, '1M': 20.1, '3W': 1.9, '2W': 0.7, '1W': 13.8, '3D': 17.8, price: 218.4, rsi14: 58, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 11.3, from52wHigh: -4.2, rs3m: 9.8, rs6m: 101.4, volRatio: 1.12, setup: 'LEADER' },
  CVX: { sector: 'ENERGY', subsector: 'E&P / Integrated', 'YTD': 36.1, '6M': 10, '3M': 11.3, '1M': 8.6, '3W': 9.1, '2W': 1.8, '1W': -1.7, '3D': 1, price: 201.86, rsi14: 61, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 8.4, from52wHigh: -2.7, rs3m: 7.8, rs6m: -3.8, volRatio: 0.88, setup: 'LEADER' },
  DE: { sector: 'MATERIALS', subsector: 'Ag / fertilizer', 'YTD': 36.1, '6M': 0.7, '3M': 17.2, '1M': -1.5, '3W': 1.5, '2W': 3.5, '1W': -2.6, '3D': -0.1, price: 630.33, rsi14: 55, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 3.3, from52wHigh: -4.3, rs3m: 14.6, rs6m: -10.8, volRatio: 1.22, setup: 'LEADER-PULLBACK' },
  DELL: { sector: 'TECH', subsector: 'Memory / hardware', 'YTD': 265.8, '6M': 209.6, '3M': 44.1, '1M': 16.4, '3W': 0.5, '2W': -7, '1W': 3.2, '3D': 1, price: 456.24, rsi14: 53, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 5.4, from52wHigh: -7.7, rs3m: -3.6, rs6m: 164.9, volRatio: 0.71, setup: 'NEUTRAL' },
  DHR: { sector: 'HEALTH CARE', subsector: 'Life-sci tools', 'YTD': -5.2, '6M': 3, '3M': 19.9, '1M': 8.6, '3W': 5.5, '2W': 6.7, '1W': -1.3, '3D': 0, price: 216.07, rsi14: 64, above50: true, above200: true, ma50Rising: true, ma200Rising: false, vs50dma: 8.6, from52wHigh: -10.4, rs3m: 18.4, rs6m: -6.5, volRatio: 0.68, setup: 'NEUTRAL' },
  DINO: { sector: 'ENERGY', subsector: 'Refiners', 'YTD': 121.5, '6M': 104.1, '3M': 47, '1M': 12.3, '3W': 23.2, '2W': 6.4, '1W': 2.5, '3D': 6.9, price: 99.71, rsi14: 67, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 18.6, from52wHigh: 0, rs3m: 39.3, rs6m: 66.6, volRatio: 0.79, setup: 'LEADER-EXTENDED' },
  ELV: { sector: 'HEALTH CARE', subsector: 'Managed care', 'YTD': 13.7, '6M': 24.5, '3M': 0.8, '1M': 2.3, '3W': 0.1, '2W': -1.5, '1W': -1.5, '3D': -1.1, price: 394.43, rsi14: 49, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -0.1, from52wHigh: -7.6, rs3m: -3.3, rs6m: 20.3, volRatio: 0.6, setup: 'PULLBACK-WATCH' },
  EOG: { sector: 'ENERGY', subsector: 'E&P / Integrated', 'YTD': 39.9, '6M': 17.3, '3M': 7.3, '1M': 2.7, '3W': 6.4, '2W': 0.5, '1W': -6.3, '3D': -2.4, price: 143.35, rsi14: 49, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 2.5, from52wHigh: -6.3, rs3m: 4, rs6m: 0.4, volRatio: 0.77, setup: 'LEADER-PULLBACK' },
  ET: { sector: 'ENERGY', subsector: 'Tankers / Midstream', 'YTD': 36.2, '6M': 17, '3M': 11.6, '1M': 7.3, '3W': 5.9, '2W': 1.2, '1W': 0.6, '3D': 1.4, price: 21.31, rsi14: 65, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 6.6, from52wHigh: -0.6, rs3m: 10.6, rs6m: 2.4, volRatio: 0.92, setup: 'LEADER' },
  FCX: { sector: 'MATERIALS', subsector: 'Copper', 'YTD': 51.6, '6M': 12.8, '3M': 16.3, '1M': 24, '3W': 9.8, '2W': 15, '1W': -0.3, '3D': -4.3, price: 76.45, rsi14: 63, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 16.6, from52wHigh: -4.3, rs3m: 12.4, rs6m: -0.2, volRatio: 1.14, setup: 'LEADER' },
  GDX: { sector: 'MATERIALS', subsector: 'Gold miners', 'YTD': 16.2, '6M': -14, '3M': 14.3, '1M': 34.3, '3W': 10.9, '2W': 10.8, '1W': -3.1, '3D': -5.6, price: 99.65, rsi14: 63, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 20.9, from52wHigh: -14, rs3m: 13.1, rs6m: -23.3, volRatio: 1.24, setup: 'LEADER-EXTENDED' },
  GILD: { sector: 'HEALTH CARE', subsector: 'Biotech', 'YTD': 20.1, '6M': -1, '3M': 7.6, '1M': 8.5, '3W': 9.4, '2W': 5.3, '1W': -0.3, '3D': -2.1, price: 145.68, rsi14: 61, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 8.6, from52wHigh: -5.3, rs3m: 10, rs6m: -12.8, volRatio: 0.76, setup: 'LEADER' },
  GS: { sector: 'FINANCIALS', subsector: 'IB / brokers', 'YTD': 18.8, '6M': 21.5, '3M': 3, '1M': 0.1, '3W': -0.5, '2W': -0.5, '1W': -0.5, '3D': -2.4, price: 1033.99, rsi14: 48, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -1.6, from52wHigh: -10.2, rs3m: -3, rs6m: 7, volRatio: 0.95, setup: 'PULLBACK-WATCH' },
  HAL: { sector: 'ENERGY', subsector: 'Oil services', 'YTD': 29.2, '6M': 1.4, '3M': -7.6, '1M': 15.9, '3W': 13.5, '2W': 5.1, '1W': 2.4, '3D': 7, price: 36.18, rsi14: 61, above50: true, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: 6.9, from52wHigh: -15.5, rs3m: -9.2, rs6m: -9.9, volRatio: 0.93, setup: 'NEUTRAL' },
  HOOD: { sector: 'CRYPTO', subsector: 'Crypto equities', 'YTD': -7.8, '6M': 37.5, '3M': 22.9, '1M': 12.4, '3W': 11.8, '2W': 9.1, '1W': -3.6, '3D': -7, price: 104.26, rsi14: 54, above50: true, above200: true, ma50Rising: true, ma200Rising: false, vs50dma: 2.9, from52wHigh: -31.6, rs3m: 13, rs6m: 17.4, volRatio: 0.97, setup: 'BROKEN' },
  IGV: { sector: 'TECH', subsector: 'Software', 'YTD': 3.6, '6M': 34.3, '3M': 14.5, '1M': 19.3, '3W': 6.6, '2W': 5.2, '1W': 5.9, '3D': 7.5, price: 109.5, rsi14: 68, above50: true, above200: true, ma50Rising: true, ma200Rising: false, vs50dma: 14.1, from52wHigh: -7, rs3m: 0, rs6m: 17.4, volRatio: 0.75, setup: 'NEUTRAL' },
  INSW: { sector: 'ENERGY', subsector: 'Tankers / Midstream', 'YTD': 122.1, '6M': 42.7, '3M': 36.1, '1M': 5.6, '3W': 6.9, '2W': 1.8, '1W': -0.7, '3D': -0.2, price: 98.81, rsi14: 58, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 9, from52wHigh: -1.1, rs3m: 30.1, rs6m: 25.1, volRatio: 0.84, setup: 'LEADER' },
  INVX: { sector: 'ENERGY', subsector: 'Oil services', 'YTD': 37.7, '6M': 14.3, '3M': 11.7, '1M': 17.5, '3W': 7.2, '2W': -3.6, '1W': 2.7, '3D': 5, price: 30.11, rsi14: 57, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 10.4, from52wHigh: -4.8, rs3m: 9.8, rs6m: 0.7, volRatio: 0.97, setup: 'LEADER' },
  IQV: { sector: 'HEALTH CARE', subsector: 'Life-sci tools', 'YTD': 16.1, '6M': 46.4, '3M': 44.5, '1M': 7.7, '3W': 9.7, '2W': 10.6, '1W': 0.7, '3D': 0.9, price: 261.75, rsi14: 72, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 18.3, from52wHigh: -0.2, rs3m: 37.8, rs6m: 33.3, volRatio: 0.91, setup: 'LEADER-EXTENDED' },
  ISRG: { sector: 'HEALTH CARE', subsector: 'Med devices', 'YTD': -34.2, '6M': -26, '3M': -12, '1M': 3, '3W': -1.6, '2W': -5.6, '1W': -1.6, '3D': 0.2, price: 372.6, rsi14: 46, above50: false, above200: false, ma50Rising: false, ma200Rising: false, vs50dma: -3, from52wHigh: -37.2, rs3m: -11.1, rs6m: -33.4, volRatio: 0.66, setup: 'BROKEN' },
  JNJ: { sector: 'HEALTH CARE', subsector: 'Pharma', 'YTD': 31.6, '6M': 9, '3M': 16.7, '1M': 1, '3W': 3.9, '2W': 3.5, '1W': -0.3, '3D': -1.9, price: 268.04, rsi14: 57, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 4.3, from52wHigh: -1.9, rs3m: 18.5, rs6m: -3.3, volRatio: 0.81, setup: 'LEADER-PULLBACK' },
  JPM: { sector: 'FINANCIALS', subsector: 'Money-center banks', 'YTD': 12.6, '6M': 20.2, '3M': 21.1, '1M': 0.1, '3W': 0, '2W': -1.4, '1W': 1.7, '3D': 0.3, price: 357.62, rsi14: 55, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 3.1, from52wHigh: -2.1, rs3m: 19.1, rs6m: 7.7, volRatio: 0.68, setup: 'LEADER-PULLBACK' },
  KIE: { sector: 'FINANCIALS', subsector: 'Regionals / insurers / AM', 'YTD': 7.2, '6M': 10.9, '3M': 15.3, '1M': -3.8, '3W': -1, '2W': -0.5, '1W': 0.8, '3D': 0.1, price: 63.91, rsi14: 52, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 1, from52wHigh: -3.8, rs3m: 14, rs6m: -2.5, volRatio: 0.79, setup: 'LEADER-PULLBACK' },
  KMI: { sector: 'ENERGY', subsector: 'Tankers / Midstream', 'YTD': 18.1, '6M': -3.4, '3M': -0.2, '1M': 0.8, '3W': 2.3, '2W': -3.8, '1W': 1.9, '3D': 2, price: 31.56, rsi14: 49, above50: false, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: -0.9, from52wHigh: -7.2, rs3m: 1.5, rs6m: -15.8, volRatio: 1.08, setup: 'PULLBACK-WATCH' },
  KRE: { sector: 'FINANCIALS', subsector: 'Regionals / insurers / AM', 'YTD': 16, '6M': 12.6, '3M': 7.5, '1M': -3.2, '3W': -2.5, '2W': -4.7, '1W': -0.7, '3D': -0, price: 74.3, rsi14: 40, above50: false, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: -1.6, from52wHigh: -4.7, rs3m: 7.6, rs6m: -1.6, volRatio: 0.99, setup: 'PULLBACK-WATCH' },
  LLY: { sector: 'HEALTH CARE', subsector: 'Pharma', 'YTD': 9.8, '6M': 12, '3M': 4.4, '1M': -3.6, '3W': -0.8, '2W': -0.5, '1W': -6.4, '3D': -4.8, price: 1174.61, rsi14: 46, above50: false, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: -0.9, from52wHigh: -8.3, rs3m: 6.9, rs6m: 2.7, volRatio: 0.92, setup: 'PULLBACK-WATCH' },
  MDT: { sector: 'HEALTH CARE', subsector: 'Med devices', 'YTD': -3.4, '6M': -5, '3M': 21.8, '1M': 5, '3W': 4.7, '2W': -0, '1W': -2.3, '3D': 0.1, price: 91.23, rsi14: 57, above50: true, above200: true, ma50Rising: true, ma200Rising: false, vs50dma: 6.8, from52wHigh: -11.3, rs3m: 22.4, rs6m: -16, volRatio: 0.86, setup: 'NEUTRAL' },
  MOS: { sector: 'MATERIALS', subsector: 'Ag / fertilizer', 'YTD': -0.2, '6M': -13.6, '3M': -1.9, '1M': 2.3, '3W': 2.3, '2W': 9.2, '1W': -3.3, '3D': -2.8, price: 23.6, rsi14: 55, above50: true, above200: false, ma50Rising: true, ma200Rising: false, vs50dma: 5.4, from52wHigh: -32.5, rs3m: -0.5, rs6m: -22.4, volRatio: 0.99, setup: 'BROKEN' },
  MPC: { sector: 'ENERGY', subsector: 'Refiners', 'YTD': 129.4, '6M': 87.3, '3M': 47.2, '1M': 20.8, '3W': 24, '2W': 4.1, '1W': 2.2, '3D': 3.9, price: 368.83, rsi14: 72, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 19.9, from52wHigh: 0, rs3m: 40.6, rs6m: 57, volRatio: 1.02, setup: 'LEADER-EXTENDED' },
  MRK: { sector: 'HEALTH CARE', subsector: 'Pharma', 'YTD': 43, '6M': 21.6, '3M': 24.6, '1M': 12.5, '3W': 15.4, '2W': 9.2, '1W': -2.8, '3D': -5.2, price: 148.35, rsi14: 63, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 12.9, from52wHigh: -5.2, rs3m: 27.6, rs6m: 10, volRatio: 1.3, setup: 'LEADER' },
  MRNA: { sector: 'HEALTH CARE', subsector: 'Biotech', 'YTD': 367.9, '6M': 157.6, '3M': 190.1, '1M': 147.3, '3W': 133.2, '2W': 117.9, '1W': -4.9, '3D': -13.1, price: 137.99, rsi14: 64, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 79.7, from52wHigh: -20.9, rs3m: 194.6, rs6m: 131.7, volRatio: 3.24, setup: 'LEADER-EXTENDED' },
  MS: { sector: 'FINANCIALS', subsector: 'IB / brokers', 'YTD': 23, '6M': 30.4, '3M': 6, '1M': 2.1, '3W': -0.7, '2W': -1.2, '1W': 0.3, '3D': -0.9, price: 214.77, rsi14: 50, above50: false, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: -0.5, from52wHigh: -5.5, rs3m: 0.6, rs6m: 15.4, volRatio: 0.72, setup: 'PULLBACK-WATCH' },
  MSFT: { sector: 'TECH', subsector: 'Software', 'YTD': 6.9, '6M': 31.3, '3M': 20.5, '1M': 30.8, '3W': 2.9, '2W': 3.9, '1W': 6.3, '3D': 4.4, price: 513.53, rsi14: 74, above50: true, above200: true, ma50Rising: true, ma200Rising: false, vs50dma: 19.4, from52wHigh: -4.5, rs3m: 9.9, rs6m: 14.8, volRatio: 0.6, setup: 'NEUTRAL' },
  MU: { sector: 'TECH', subsector: 'Memory / hardware', 'YTD': 227, '6M': 126.3, '3M': 1, '1M': 13.7, '3W': 6.3, '2W': -4, '1W': -3.5, '3D': -0, price: 932.86, rsi14: 51, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -2.3, from52wHigh: -23.1, rs3m: -11.4, rs6m: 100.7, volRatio: 0.61, setup: 'PULLBACK-WATCH' },
  NEM: { sector: 'MATERIALS', subsector: 'Gold miners', 'YTD': 28.7, '6M': -1.1, '3M': 18.2, '1M': 39.8, '3W': 13.3, '2W': 8.7, '1W': -2.7, '3D': -5.3, price: 127.98, rsi14: 64, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 22.6, from52wHigh: -5.3, rs3m: 16.3, rs6m: -11.4, volRatio: 1.03, setup: 'LEADER-EXTENDED' },
  NTR: { sector: 'MATERIALS', subsector: 'Ag / fertilizer', 'YTD': 21.1, '6M': -0.5, '3M': 6.5, '1M': 5.8, '3W': 14.1, '2W': 7.7, '1W': -2.3, '3D': 0.9, price: 73.51, rsi14: 63, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 9.4, from52wHigh: -11, rs3m: 4.9, rs6m: -12.5, volRatio: 0.9, setup: 'LEADER' },
  NUE: { sector: 'MATERIALS', subsector: 'Steel / aluminum', 'YTD': 54.5, '6M': 42.5, '3M': 0.7, '1M': -5.7, '3W': -8.1, '2W': -6.8, '1W': 2.8, '3D': 1.2, price: 250.5, rsi14: 47, above50: true, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: 1.4, from52wHigh: -8.8, rs3m: -1.8, rs6m: 23.8, volRatio: 1.07, setup: 'NEUTRAL' },
  NVDA: { sector: 'TECH', subsector: 'Semis', 'YTD': 16.8, '6M': 22.9, '3M': 1.7, '1M': 10.4, '3W': -2.9, '2W': -3.4, '1W': 1.3, '3D': 2.1, price: 217.55, rsi14: 52, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 4.4, from52wHigh: -7.6, rs3m: -4.5, rs6m: 5.9, volRatio: 1.05, setup: 'NEUTRAL' },
  OII: { sector: 'ENERGY', subsector: 'Oil services', 'YTD': 110.5, '6M': 42.5, '3M': 32.1, '1M': 5.4, '3W': 5.5, '2W': -3.1, '1W': -4.5, '3D': 1.4, price: 50.59, rsi14: 54, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 10.3, from52wHigh: -6.5, rs3m: 32.9, rs6m: 25.2, volRatio: 0.89, setup: 'LEADER' },
  ORCL: { sector: 'TECH', subsector: 'Software', 'YTD': -21.9, '6M': 4.5, '3M': -25.7, '1M': 25.8, '3W': 2.6, '2W': 0.2, '1W': 3, '3D': 4.2, price: 150.85, rsi14: 56, above50: true, above200: false, ma50Rising: false, ma200Rising: false, vs50dma: 6.7, from52wHigh: -53.5, rs3m: -40, rs6m: -9.7, volRatio: 0.6, setup: 'BROKEN' },
  PANW: { sector: 'TECH', subsector: 'Cybersecurity', 'YTD': 101.7, '6M': 149.5, '3M': 44.2, '1M': 16.5, '3W': 2.1, '2W': -3.3, '1W': 3.8, '3D': 9.3, price: 371.59, rsi14: 56, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 8.2, from52wHigh: -6.2, rs3m: 21.6, rs6m: 119.6, volRatio: 0.82, setup: 'LEADER' },
  PARR: { sector: 'ENERGY', subsector: 'Refiners', 'YTD': 124.4, '6M': 84.8, '3M': 39.6, '1M': -0.3, '3W': 18.9, '2W': -1.8, '1W': -0.2, '3D': 6.8, price: 78.85, rsi14: 54, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 10.5, from52wHigh: -8.3, rs3m: 35.8, rs6m: 51.9, volRatio: 0.81, setup: 'LEADER' },
  PBF: { sector: 'ENERGY', subsector: 'Refiners', 'YTD': 167.7, '6M': 102.3, '3M': 79.7, '1M': 17.3, '3W': 15.9, '2W': -0.8, '1W': -3.1, '3D': 7.2, price: 71.28, rsi14: 56, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 18.3, from52wHigh: -5.2, rs3m: 68.2, rs6m: 62.3, volRatio: 0.75, setup: 'LEADER-EXTENDED' },
  PFE: { sector: 'HEALTH CARE', subsector: 'Pharma', 'YTD': 18.1, '6M': 4.6, '3M': 8.8, '1M': 10.7, '3W': 4.5, '2W': 4.4, '1W': -0.4, '3D': -2.1, price: 27.96, rsi14: 64, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 10.2, from52wHigh: -2.1, rs3m: 9.2, rs6m: -5.9, volRatio: 0.77, setup: 'LEADER' },
  PSX: { sector: 'ENERGY', subsector: 'Refiners', 'YTD': 93.1, '6M': 60.1, '3M': 38.8, '1M': 19.2, '3W': 20.3, '2W': 5, '1W': 0.5, '3D': 3, price: 244.01, rsi14: 71, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 19, from52wHigh: 0, rs3m: 33.8, rs6m: 36.9, volRatio: 0.96, setup: 'LEADER-EXTENDED' },
  REGN: { sector: 'HEALTH CARE', subsector: 'Biotech', 'YTD': 3.3, '6M': 1.9, '3M': 27.9, '1M': 14.4, '3W': 1.4, '2W': -1, '1W': -4.8, '3D': -4.7, price: 794.19, rsi14: 56, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 10.9, from52wHigh: -5.5, rs3m: 30.2, rs6m: -10.6, volRatio: 0.77, setup: 'LEADER' },
  SCCO: { sector: 'MATERIALS', subsector: 'Copper', 'YTD': 50.4, '6M': -2.4, '3M': 7.7, '1M': 17.2, '3W': 5.4, '2W': 13.6, '1W': -2.9, '3D': -4.5, price: 209.8, rsi14: 59, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 12.7, from52wHigh: -4.5, rs3m: 7.9, rs6m: -13.4, volRatio: 1, setup: 'LEADER' },
  SCHW: { sector: 'FINANCIALS', subsector: 'IB / brokers', 'YTD': 11.4, '6M': 16.5, '3M': 29.4, '1M': 4.3, '3W': 2.7, '2W': -0.8, '1W': -1.9, '3D': -1.9, price: 110.16, rsi14: 57, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 6.9, from52wHigh: -3.1, rs3m: 22.4, rs6m: 3, volRatio: 0.93, setup: 'LEADER-PULLBACK' },
  SLB: { sector: 'ENERGY', subsector: 'Oil services', 'YTD': 51, '6M': 12.3, '3M': 4.6, '1M': 14.7, '3W': 13.5, '2W': 6.6, '1W': 6.4, '3D': 7.6, price: 57.33, rsi14: 71, above50: true, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: 15.3, from52wHigh: -1.2, rs3m: 3.5, rs6m: -0.2, volRatio: 0.75, setup: 'NEUTRAL' },
  SNDK: { sector: 'TECH', subsector: 'Memory / hardware', 'YTD': 525.6, '6M': 133.7, '3M': -9.5, '1M': 35.5, '3W': 22.5, '2W': -9.5, '1W': -7, '3D': 0.3, price: 1484.98, rsi14: 49, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -7.5, from52wHigh: -36.4, rs3m: -17.1, rs6m: 112.9, volRatio: 0.83, setup: 'PULLBACK-WATCH' },
  SOXX: { sector: 'TECH', subsector: 'Semis', 'YTD': 69.1, '6M': 44.5, '3M': -10.6, '1M': 3.5, '3W': -6.4, '2W': -7.6, '1W': -2.2, '3D': -1.1, price: 508.62, rsi14: 43, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -7.5, from52wHigh: -22.3, rs3m: -12.5, rs6m: 28.4, volRatio: 0.77, setup: 'PULLBACK-WATCH' },
  SPY: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 13.4, '6M': 12.7, '3M': 2.2, '1M': 3.8, '3W': -0.5, '2W': -0.9, '1W': 0.5, '3D': 0.4 },
  TMO: { sector: 'HEALTH CARE', subsector: 'Life-sci tools', 'YTD': 7.6, '6M': 19.6, '3M': 27.8, '1M': 7.9, '3W': 4.7, '2W': 5.8, '1W': -1.1, '3D': -1, price: 622.18, rsi14: 66, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 11.6, from52wHigh: -2.5, rs3m: 24, rs6m: 8.8, volRatio: 0.82, setup: 'LEADER' },
  UNH: { sector: 'HEALTH CARE', subsector: 'Managed care', 'YTD': 20.6, '6M': 35.8, '3M': 3.3, '1M': -8.4, '3W': -3.5, '2W': -2.2, '1W': 0.7, '3D': -0.9, price: 392.95, rsi14: 42, above50: false, above200: true, ma50Rising: false, ma200Rising: true, vs50dma: -4.8, from52wHigh: -9.9, rs3m: 2.3, rs6m: 19.8, volRatio: 0.78, setup: 'PULLBACK-WATCH' },
  VLO: { sector: 'ENERGY', subsector: 'Refiners', 'YTD': 119.7, '6M': 73.7, '3M': 44.5, '1M': 18.3, '3W': 18.1, '2W': 3.1, '1W': 1, '3D': 3.5, price: 352.36, rsi14: 68, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 16.6, from52wHigh: 0, rs3m: 37.8, rs6m: 46.8, volRatio: 0.71, setup: 'LEADER' },
  VRTX: { sector: 'HEALTH CARE', subsector: 'Biotech', 'YTD': 19.5, '6M': 9, '3M': 20.9, '1M': 10.5, '3W': 9.2, '2W': 7.1, '1W': -1.2, '3D': -2, price: 541.69, rsi14: 61, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 8.2, from52wHigh: -2, rs3m: 21.5, rs6m: -1.1, volRatio: 0.66, setup: 'LEADER' },
  WFC: { sector: 'FINANCIALS', subsector: 'Money-center banks', 'YTD': -5.5, '6M': 7.7, '3M': 13.7, '1M': 0.4, '3W': -0.6, '2W': -2.4, '1W': 3.4, '3D': 2.2, price: 86.69, rsi14: 53, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 1, from52wHigh: -8.6, rs3m: 11.1, rs6m: -5.8, volRatio: 0.76, setup: 'LEADER-PULLBACK' },
  XLB: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 18.2, '6M': 0.4, '3M': 3.9, '1M': 1.6, '3W': 0.6, '2W': 1.2, '1W': -0.7, '3D': -0.7 },
  XLC: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': -3.5, '6M': -3.7, '3M': -2.9, '1M': 3, '3W': 1.6, '2W': 0, '1W': 1.4, '3D': -0.2 },
  XLE: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 42.1, '6M': 13.6, '3M': 10.9, '1M': 8.9, '3W': 9, '2W': 1.2, '1W': -1.5, '3D': 1 },
  XLF: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 7, '6M': 13.9, '3M': 13.7, '1M': 0.9, '3W': 0.9, '2W': -0.1, '1W': 1.1, '3D': -0.4 },
  XLI: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 14.8, '6M': 0.5, '3M': 2.2, '1M': -2.9, '3W': -4.3, '2W': -5, '1W': -1.7, '3D': -0.7 },
  XLK: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 29.3, '6M': 34.1, '3M': -0.5, '1M': 8.5, '3W': -1.2, '2W': -2.3, '1W': 1.3, '3D': 2.2 },
  XLP: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 11.4, '6M': -3.9, '3M': 1.9, '1M': -1.8, '3W': 0.4, '2W': -0.7, '1W': -0.6, '3D': -1.2 },
  XLRE: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 11.9, '6M': 3, '3M': 1, '1M': -3.3, '3W': -1.1, '2W': -1.7, '1W': -1.3, '3D': -1.9 },
  XLU: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 1.4, '6M': -9.3, '3M': -3.6, '1M': -6.1, '3W': -2, '2W': -3.6, '1W': -0.1, '3D': -1.3 },
  XLV: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': 11.5, '6M': 7.8, '3M': 13.9, '1M': 2.3, '3W': 3.3, '2W': 2.3, '1W': -2, '3D': -2.4 },
  XLY: { sector: 'Sector ETF', subsector: 'Sector ETF', 'YTD': -1.4, '6M': 0.7, '3M': -3.8, '1M': 4.2, '3W': -2.2, '2W': -0.8, '1W': -0.7, '3D': -0.6 },
  XOM: { sector: 'ENERGY', subsector: 'E&P / Integrated', 'YTD': 32.8, '6M': 4.1, '3M': 7.3, '1M': 3.1, '3W': 3.1, '2W': -1.5, '1W': -5.1, '3D': -2.4, price: 156.71, rsi14: 49, above50: true, above200: true, ma50Rising: true, ma200Rising: true, vs50dma: 4.6, from52wHigh: -7.4, rs3m: 3.8, rs6m: -8.6, volRatio: 0.93, setup: 'LEADER-PULLBACK' },
};

// ═══════════════════════════════════════════════════════════════════
// Sector Map service — live rotation & trend scan
//
// For every symbol in the universe this pulls two years of daily bars
// from Yahoo and computes:
//   • returns over 10 windows (1D → 1Y), all measured over the same
//     stretch of wall-clock time so 7-day crypto and 5-day equities
//     are directly comparable
//   • RSI-14, 50 & 200-DMA position and slope, % vs 50-DMA,
//     % from the 52-week high, volume ratio
//   • relative strength vs SPY over 3M and 6M
//   • a setup tag, an acceleration reading, a 0-100 trend score, and
//     the "something just changed" signals (breakout, golden cross,
//     RSI reset, volume surge, stalling, breakdown)
//
// Results stream back batch by batch, cache to disk, and fall back to
// the baked-in Aug 28 2026 snapshot for anything unreachable.
// ═══════════════════════════════════════════════════════════════════



// The app caches scans in AsyncStorage so a cold start has something to
// draw before the network answers. The server persists to data/sectors.json
// instead (see sector-scanner.js), so the storage-backed helpers below are
// left in place — same code path as the app — with no store behind them.
const AsyncStorage = null;

const MEM_TTL_MS = 15 * 60 * 1000;   // a scan is "fresh" for 15 minutes
const DISK_TTL_MS = 12 * 60 * 60 * 1000; // older than this, don't seed from disk
const BATCH_SIZE = 10;
const BATCH_PAUSE_MS = 90;
const DISK_KEY = 'sectorMap:v2:';
const PREV_KEY = 'sectorMap:v2:prev:';   // the previous checkpoint's scan
const CKPT_KEY = 'sectorMap:v2:ckpt:';   // last checkpoint key already scanned

// ═══════════════════════════════════════════
// Universe
// ═══════════════════════════════════════════

const ETF_META = {};
SECTOR_ETFS.forEach((e) => { ETF_META[e.symbol] = { sector: 'Sector ETF', subsector: 'Sector ETF' }; });

// Group membership wins over the ETF strip, so IBIT maps into CRYPTO
// on the heat map while still ranking in the sector ETF row.
const TICKER_META = (() => {
  const m = { ...ETF_META };
  Object.entries(SECTOR_GROUPS).forEach(([sector, subs]) => {
    Object.entries(subs).forEach(([subsector, tickers]) => {
      tickers.forEach((t) => { m[t] = { sector, subsector }; });
    });
  });
  return m;
})();

// Universes are built per asset class. The two never share a symbol list,
// a benchmark, a cache or a checkpoint — they are separate scans that
// happen to render through the same components.
function buildUniverse(assetClass, tier) {
  const groups = groupsFor(assetClass);
  const set = new Set(benchmarkStripFor(assetClass).map((e) => e.symbol));
  set.add(benchmarkFor(assetClass));
  Object.values(groups).forEach((subs) => {
    Object.values(subs).forEach((tickers) => {
      (tier === 'full' ? tickers : tickers.slice(0, CORE_PER_SUB)).forEach((t) => set.add(t));
    });
  });
  return Array.from(set);
}

const UNIVERSES = {
  equity: { core: buildUniverse('equity', 'core'), full: buildUniverse('equity', 'full') },
  crypto: { core: buildUniverse('crypto', 'core'), full: buildUniverse('crypto', 'full') },
};

function getUniverse(tier = 'core', assetClass = 'equity') {
  return (UNIVERSES[assetClass] || UNIVERSES.equity)[tier === 'full' ? 'full' : 'core'];
}

function tiersFor(assetClass = 'equity') {
  const u = UNIVERSES[assetClass] || UNIVERSES.equity;
  return [
    { key: 'core', label: 'Core', count: u.core.length },
    { key: 'full', label: 'Full', count: u.full.length },
  ];
}

const TIERS = tiersFor('equity');

function getMeta(symbol) {
  return TICKER_META[symbol] || { sector: 'Sector ETF', subsector: 'Sector ETF' };
}

function isCrypto(symbol) {
  return getMeta(symbol).sector === 'CRYPTO';
}

// ═══════════════════════════════════════════
// Math helpers
// ═══════════════════════════════════════════

function round(v, dp = 1) {
  if (v == null || !isFinite(v)) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Wilder's RSI — pandas ewm(alpha=1/n, adjust=False) on gains/losses
function rsi14(closes, n = 14) {
  if (closes.length < n + 2) return null;
  const alpha = 1 / n;
  let up = null;
  let dn = null;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    if (up == null) { up = g; dn = l; continue; }
    up = alpha * g + (1 - alpha) * up;
    dn = alpha * l + (1 - alpha) * dn;
  }
  if (dn === 0) return up > 0 ? 100 : 50;
  return 100 - 100 / (1 + up / dn);
}

function sma(closes, n, back = 0) {
  const end = closes.length - back;
  if (end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += closes[i];
  return s / n;
}

// Rolling SMA over the last `depth` bars, oldest first
function smaTail(closes, n, depth) {
  const out = [];
  for (let back = depth - 1; back >= 0; back--) out.push(sma(closes, n, back));
  return out;
}

function pctChange(latest, base) {
  if (base == null || base === 0 || latest == null) return null;
  return (latest / base - 1) * 100;
}

function closeOnOrBefore(closes, dates, targetMs) {
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= targetMs) return closes[i];
  }
  return null;
}

function monthsAgo(dateMs, months) {
  const d = new Date(dateMs);
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

function lastYearEnd(dateMs) {
  const d = new Date(dateMs);
  return new Date(d.getFullYear() - 1, 11, 31).getTime();
}

function median(values) {
  const v = values.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

function fmtPct(v, dp = 1) {
  if (v == null || !isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

function fmtNum(v, dp = 1) {
  if (v == null || !isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}`;
}

// ═══════════════════════════════════════════
// Yahoo history
// ═══════════════════════════════════════════

async function fetchDaily(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=2y&interval=1d&_=${Date.now()}`;
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`No data for ${symbol}`);

  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const rawCloses = adj || q.close || [];
  const rawVols = q.volume || [];

  const dates = [];
  const closes = [];
  const volumes = [];
  for (let i = 0; i < ts.length; i++) {
    if (rawCloses[i] == null) continue;
    dates.push(ts[i] * 1000);
    closes.push(rawCloses[i]);
    volumes.push(rawVols[i] || 0);
  }
  if (closes.length < 40) throw new Error(`Thin history for ${symbol}`);
  return { dates, closes, volumes };
}

// ═══════════════════════════════════════════
// Per-symbol computation
// ═══════════════════════════════════════════

/**
 * Returns across every window. `calendar` is the benchmark's date array —
 * session windows resolve to the wall-clock date N trading sessions ago,
 * so a crypto chart (365 bars/yr) and a stock (252 bars/yr) cover the
 * same stretch of time.
 */
function computeReturns(series, calendar, assetClass) {
  const { dates, closes } = series;
  const last = closes[closes.length - 1];
  const lastDate = dates[dates.length - 1];
  const out = {};

  WINDOWS.forEach((w) => {
    let targetMs;
    if (w.kind === 'session') {
      const n = assetClass === 'crypto' ? (w.nCrypto ?? w.n) : w.n;
      const idx = calendar.length - 1 - n;
      targetMs = idx >= 0 ? calendar[idx] : null;
    } else if (w.kind === 'calendar') {
      targetMs = monthsAgo(lastDate, w.n);
    } else {
      targetMs = lastYearEnd(lastDate);
    }
    out[w.key] = targetMs == null
      ? null
      : round(pctChange(last, closeOnOrBefore(closes, dates, targetMs)));
  });
  return out;
}

function relStrength(series, benchSeries, calendar, sessions) {
  const idx = calendar.length - 1 - sessions;
  if (idx < 0) return null;
  const target = calendar[idx];
  const sBase = closeOnOrBefore(series.closes, series.dates, target);
  const bBase = closeOnOrBefore(benchSeries.closes, benchSeries.dates, target);
  if (sBase == null || bBase == null) return null;
  const sr = series.closes[series.closes.length - 1] / sBase;
  const br = benchSeries.closes[benchSeries.closes.length - 1] / bBase;
  return (sr / br - 1) * 100;
}

function tagSetup(r) {
  const trend = r.above50 && r.above200 && r.ma50Rising && r.ma200Rising && r.rs3m > 0;
  if (trend) {
    if (r.rsi14 > 70 || r.vs50dma > 18) return 'LEADER-EXTENDED';
    if (r.rsi14 >= 45 && r.rsi14 <= 60 && r.vs50dma < 8) return 'LEADER-PULLBACK';
    return 'LEADER';
  }
  if (!r.above50 && r.above200 && r.ma200Rising) return 'PULLBACK-WATCH';
  if (!r.above200 || r.from52wHigh < -20) return 'BROKEN';
  return 'NEUTRAL';
}

// Sessions since the 50-DMA last crossed the 200-DMA, and in which
// direction. null when no cross inside the lookback.
function findMaCross(closes, depth = 60) {
  const fast = smaTail(closes, 50, depth);
  const slow = smaTail(closes, 200, depth);
  let last = null;
  for (let i = 0; i < depth; i++) {
    if (fast[i] == null || slow[i] == null) continue;
    const sign = fast[i] > slow[i] ? 1 : -1;
    if (last != null && sign !== last.sign) {
      return { type: sign > 0 ? 'golden' : 'death', barsAgo: depth - 1 - i, sign };
    }
    last = { sign };
  }
  return null;
}

// Sessions since price last crossed its 200-DMA, and in which direction.
function find200Cross(closes, depth = 30) {
  const slow = smaTail(closes, 200, depth);
  const tail = closes.slice(-depth);
  let last = null;
  for (let i = 0; i < depth; i++) {
    if (slow[i] == null) continue;
    const sign = tail[i] > slow[i] ? 1 : -1;
    if (last != null && sign !== last.sign) {
      return { type: sign > 0 ? 'reclaim' : 'lost', barsAgo: depth - 1 - i };
    }
    last = { sign };
  }
  return null;
}

// Pace of a move in % per trading day, so windows of different length
// can be compared directly.
function pace(row, key) {
  const v = row[key];
  const d = WINDOW_DAYS[key];
  return v == null || !d ? null : v / d;
}

function computeTrend(row) {
  const p1m = pace(row, '1M');
  const p3m = pace(row, '3M');
  const p1w = pace(row, '1W');

  row.accel = (p1m != null && p3m != null) ? round(p1m - p3m, 3) : null;
  row.accelShort = (p1w != null && p1m != null) ? round(p1w - p1m, 3) : null;

  // ─ Trend score, 0-100 ─
  let score = 0;
  score += row.above50 ? 10 : 0;
  score += row.above200 ? 10 : 0;
  score += row.ma50Rising ? 5 : 0;
  score += row.ma200Rising ? 5 : 0;
  if (row.rs3m != null) score += clamp(row.rs3m / 30, -1, 1) * 15;
  if (row.rs6m != null) score += clamp(row.rs6m / 50, -1, 1) * 10;
  ['1W', '1M', '3M', '6M'].forEach((k) => { if (row[k] > 0) score += 5; });
  if (row.accel != null) score += clamp(row.accel / 0.3, -1, 1) * 15;
  if (row.from52wHigh != null) score += clamp(1 + row.from52wHigh / 20, 0, 1) * 10;
  row.trendScore = Math.round(clamp(score, 0, 100));

  // ─ Signals: what just changed ─
  const sig = [];
  if (row.from52wHigh != null && row.from52wHigh >= -1) sig.push('NEW_HIGH');
  else if (row.from52wHigh != null && row.from52wHigh >= -4
    && row.above50 && row.ma50Rising && row['1M'] > 0) sig.push('BREAKOUT');

  if (row.accel != null && row.accel > 0.15 && row['3M'] > 0 && row.rs3m > 0) sig.push('ACCELERATING');
  if (row.accel != null && row.accel < -0.15 && row['3M'] > 0) sig.push('STALLING');

  if (row.maCross?.type === 'golden' && row.maCross.barsAgo <= 30) sig.push('GOLDEN_CROSS');
  if (row.maCross?.type === 'death' && row.maCross.barsAgo <= 30) sig.push('DEATH_CROSS');

  if (row.above50 && row.above200 && row.ma200Rising && row.rs3m > 0
    && row.rsi14 >= 40 && row.rsi14 <= 55) sig.push('RSI_RESET');

  if (row.volRatio != null && row.volRatio >= 1.5) sig.push('VOL_SURGE');

  if (row.cross200?.type === 'lost' && row.cross200.barsAgo <= 15) sig.push('BREAKDOWN');

  row.signals = sig;
  return row;
}

function computeRow(symbol, series, benchSeries, calendar, assetClass = 'equity') {
  const meta = getMeta(symbol);
  const { closes, volumes, dates } = series;
  const last = closes[closes.length - 1];

  const row = {
    ticker: symbol,
    sector: meta.sector,
    subsector: meta.subsector,
    ...computeReturns(series, calendar, assetClass),
    price: round(last, last >= 100 ? 2 : last >= 1 ? 3 : 6),
    rsi14: round(rsi14(closes), 0),
    asofMs: dates[dates.length - 1],
  };

  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const ma50Prev = sma(closes, 50, 10);
  const ma200Prev = sma(closes, 200, 20);

  row.above50 = ma50 != null ? last > ma50 : null;
  row.above200 = ma200 != null ? last > ma200 : null;
  row.ma50Rising = ma50 != null && ma50Prev != null ? ma50 > ma50Prev : null;
  row.ma200Rising = ma200 != null && ma200Prev != null ? ma200 > ma200Prev : null;
  row.vs50dma = ma50 != null ? round(pctChange(last, ma50)) : null;

  // 52-week high by date, not bar count — crypto has ~365 bars a year
  const yearAgo = dates[dates.length - 1] - 365 * 24 * 3600 * 1000;
  let hi = -Infinity;
  for (let i = dates.length - 1; i >= 0 && dates[i] >= yearAgo; i--) {
    if (closes[i] > hi) hi = closes[i];
  }
  row.from52wHigh = isFinite(hi) ? round(pctChange(last, hi)) : null;

  // Relative strength is measured against the class benchmark: SPY for
  // equities, BTC for crypto — "outperforming bitcoin" is the question
  // that matters inside a crypto rotation, not "outperforming the S&P".
  const rsN = assetClass === 'crypto' ? [90, 180] : [63, 126];
  row.rs3m = benchSeries ? round(relStrength(series, benchSeries, calendar, rsN[0])) : null;
  row.rs6m = benchSeries ? round(relStrength(series, benchSeries, calendar, rsN[1])) : null;

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const a50 = avg(volumes.slice(-50));
  row.volRatio = a50 ? round(avg(volumes.slice(-10)) / a50, 2) : null;

  row.maCross = findMaCross(closes);
  row.cross200 = find200Cross(closes);
  row.setup = (row.above50 == null || row.above200 == null) ? 'NEUTRAL' : tagSetup(row);

  return computeTrend(row);
}

// ═══════════════════════════════════════════
// Snapshot & disk cache
// ═══════════════════════════════════════════

function getSnapshotRows() {
  return Object.entries(SNAPSHOT).map(([ticker, d]) => computeTrend({
    ticker, ...d, '1D': null, '1Y': null, stale: true,
  }));
}

function getSnapshotAsOf() {
  return SNAPSHOT_ASOF;
}

function slot(tier, assetClass) {
  return `${assetClass}:${tier}`;
}

async function readDisk(tier) {
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(DISK_KEY + tier);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rows?.length) return null;
    if (Date.now() - (parsed.savedAt || 0) > DISK_TTL_MS) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

async function writeDisk(tier, payload) {
  if (!AsyncStorage) return;
  try {
    await AsyncStorage.setItem(DISK_KEY + tier, JSON.stringify({
      rows: payload.rows, asof: payload.asof, live: payload.live,
      checkpointKey: payload.checkpointKey || null,
      checkpointLabel: payload.checkpointLabel || null,
      savedAt: Date.now(),
    }));
  } catch (e) { /* cache is best-effort */ }
}

/** Last scan persisted to the device, or null. Used to open on real data. */
async function loadCachedScan(tier = 'core', assetClass = 'equity') {
  const disk = await readDisk(slot(tier, assetClass));
  if (!disk) return null;
  return { ...disk, fromDisk: true };
}

// ═══════════════════════════════════════════
// The scan
// ═══════════════════════════════════════════

const _mem = {}; // tier → { rows, asof, live, failed, fetchedAt, inFlight }

async function runScan(tier, assetClass, onRows) {
  const symbols = getUniverse(tier, assetClass);
  const benchmark = benchmarkFor(assetClass);
  const series = {};
  const failed = [];
  let done = 0;

  // The benchmark goes first: it defines the calendar every window is
  // measured on, and every relative-strength number.
  let bench = null;
  try {
    bench = await fetchDaily(benchmark);
    series[benchmark] = bench;
  } catch (e) {
    failed.push(benchmark);
  }
  done++;

  const calendar = bench ? bench.dates : null;
  const rowsByTicker = {};

  // The Aug 2026 snapshot only covers equities, so it seeds that class only.
  if (assetClass !== 'crypto') {
    getSnapshotRows().forEach((r) => { rowsByTicker[r.ticker] = r; });
  }

  const emit = () => {
    if (!onRows) return;
    onRows({
      rows: Object.values(rowsByTicker),
      done,
      total: symbols.length,
    });
  };

  const absorb = (sym) => {
    if (!series[sym] || !calendar) return;
    try {
      rowsByTicker[sym] = computeRow(sym, series[sym], bench, calendar, assetClass);
    } catch (e) {
      failed.push(sym);
    }
  };

  if (bench) { absorb(benchmark); emit(); }

  const rest = symbols.filter((s) => s !== benchmark);
  for (let i = 0; i < rest.length; i += BATCH_SIZE) {
    const batch = rest.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(async (sym) => {
      try {
        series[sym] = await fetchDaily(sym);
      } catch (e) {
        failed.push(sym);
      }
      done++;
    }));
    batch.forEach(absorb);
    emit();
    if (i + BATCH_SIZE < rest.length) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  // Drop snapshot seeds for names outside the scanned tier
  const inTier = new Set(symbols);
  const rows = Object.values(rowsByTicker).filter((r) => inTier.has(r.ticker));

  return {
    rows,
    assetClass,
    asof: bench
      ? new Date(bench.dates[bench.dates.length - 1]).toISOString().slice(0, 10)
      : SNAPSHOT_ASOF,
    live: rows.some((r) => !r.stale),
    failed,
  };
}

/**
 * Run (or reuse) the scan.
 * @param {object} opts
 * @param {'core'|'full'} opts.tier
 * @param {boolean} opts.force     ignore the 15-minute memory cache
 * @param {function} opts.onRows   ({rows, done, total}) — called per batch
 */
async function loadSectorScan({ tier = 'core', assetClass = 'equity', force = false, onRows } = {}) {
  const k = slot(tier, assetClass);
  const mem = _mem[k];
  if (mem && !force && Date.now() - mem.fetchedAt < MEM_TTL_MS) return mem;
  if (mem?.inFlight) return mem.inFlight;

  const p = (async () => {
    try {
      const result = await runScan(tier, assetClass, onRows);
      _mem[k] = { ...result, fetchedAt: Date.now(), inFlight: null };
      writeDisk(k, result);
      return _mem[k];
    } catch (e) {
      const fallback = {
        rows: assetClass === 'crypto' ? [] : getSnapshotRows(),
        assetClass, asof: SNAPSHOT_ASOF, live: false,
        failed: [], fetchedAt: 0, inFlight: null,
      };
      _mem[k] = fallback;
      return fallback;
    }
  })();

  _mem[k] = { ...(mem || {}), inFlight: p };
  return p;
}

function getMemScan(tier = 'core', assetClass = 'equity') {
  const m = _mem[slot(tier, assetClass)];
  return m?.rows ? m : null;
}

// ═══════════════════════════════════════════
// Checkpoints — what changed since the last scheduled update
// ═══════════════════════════════════════════

/** The checkpoint key already scanned for this tier, or null. */
async function getRanCheckpointKey(tier = 'core', assetClass = 'equity') {
  const k = slot(tier, assetClass);
  if (!AsyncStorage) return _ranKey[k] || null;
  try {
    return await AsyncStorage.getItem(CKPT_KEY + k);
  } catch (e) {
    return _ranKey[k] || null;
  }
}

const _ranKey = {}; // in-memory mirror, so this works without AsyncStorage too

async function setRanCheckpointKey(tier, assetClass, key) {
  const k = slot(tier, assetClass);
  _ranKey[k] = key;
  if (!AsyncStorage) return;
  try { await AsyncStorage.setItem(CKPT_KEY + k, key); } catch (e) { /* best effort */ }
}

/** The scan taken at the previous checkpoint, or null. */
async function loadPrevScan(tier = 'core', assetClass = 'equity') {
  const k = slot(tier, assetClass);
  if (!AsyncStorage) return _prevMem[k] || null;
  try {
    const raw = await AsyncStorage.getItem(PREV_KEY + k);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.rows?.length ? parsed : (_prevMem[k] || null);
  } catch (e) {
    return _prevMem[k] || null;
  }
}

const _prevMem = {};

async function writePrevScan(tier, assetClass, payload) {
  const k = slot(tier, assetClass);
  _prevMem[k] = payload;
  if (!AsyncStorage) return;
  try { await AsyncStorage.setItem(PREV_KEY + k, JSON.stringify(payload)); } catch (e) { /* best effort */ }
}

/**
 * Compare a fresh scan against the previous checkpoint and hang the
 * differences off each row:
 *   SINCE        price change since that checkpoint, in %
 *   scoreDelta   trend-score move
 *   newSignals   signals firing now that were not firing then
 *   goneSignals  signals that have stopped firing
 *   setupFrom    previous setup tag, when it changed
 * Rows are copied, not mutated, so the previous scan stays intact.
 */
function applyDeltas(rows, prev) {
  if (!prev?.rows?.length) return rows;
  const before = {};
  prev.rows.forEach((r) => { before[r.ticker] = r; });

  return rows.map((r) => {
    const b = before[r.ticker];
    if (!b) return { ...r, isNew: true };
    const nowSigs = r.signals || [];
    const wasSigs = b.signals || [];
    return {
      ...r,
      [SINCE_KEY]: (b.price && r.price) ? round((r.price / b.price - 1) * 100, 2) : null,
      scoreDelta: (b.trendScore != null && r.trendScore != null) ? r.trendScore - b.trendScore : null,
      newSignals: nowSigs.filter((k) => !wasSigs.includes(k)),
      goneSignals: wasSigs.filter((k) => !nowSigs.includes(k)),
      setupFrom: b.setup !== r.setup ? b.setup : null,
      prevPrice: b.price ?? null,
    };
  });
}

/**
 * Run the scan for a checkpoint: the scan currently on disk becomes the
 * "previous" one, the fresh scan replaces it, and every row carries the
 * difference between them.
 *
 * A manual pull-to-refresh deliberately does NOT rotate, so "since 10:00 AM"
 * keeps meaning since the checkpoint rather than since you last pulled.
 */
async function runCheckpointScan(checkpoint, { tier = 'core', assetClass = 'equity', onRows } = {}) {
  const k = slot(tier, assetClass);
  const priorCurrent = (await readDisk(k))
    || (getMemScan(tier, assetClass) ? { ...getMemScan(tier, assetClass) } : null);

  const result = await loadSectorScan({ tier, assetClass, force: true, onRows });

  if (priorCurrent?.rows?.length) {
    await writePrevScan(tier, assetClass, {
      rows: priorCurrent.rows,
      asof: priorCurrent.asof,
      checkpointKey: priorCurrent.checkpointKey || null,
      checkpointLabel: priorCurrent.checkpointLabel || null,
      savedAt: priorCurrent.savedAt || Date.now(),
    });
  }

  const stamped = {
    ...result,
    checkpointKey: checkpoint?.key || null,
    checkpointLabel: checkpoint?.label || null,
  };
  _mem[k] = { ...stamped, fetchedAt: Date.now(), inFlight: null };
  await writeDisk(k, stamped);
  await setRanCheckpointKey(tier, assetClass, checkpoint?.key || '');

  const prev = await loadPrevScan(tier, assetClass);
  return { ...stamped, rows: applyDeltas(stamped.rows, prev), prev };
}

/** Names whose setup changed or that lit a new signal since the last checkpoint. */
function buildJustChanged(rows, limit = 24) {
  const changed = rows.filter((r) => r.sector !== 'Sector ETF'
    && ((r.newSignals && r.newSignals.length) || r.setupFrom));

  const weight = (r) => {
    let w = 0;
    (r.newSignals || []).forEach((k) => {
      w += ['NEW_HIGH', 'BREAKOUT', 'GOLDEN_CROSS', 'BREAKDOWN', 'DEATH_CROSS'].includes(k) ? 3 : 1;
    });
    if (r.setupFrom) w += 2;
    return w + Math.abs(r.scoreDelta || 0) / 10;
  };

  return changed
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, limit);
}

/** Biggest movers since the last checkpoint, both directions. */
function buildSinceMovers(rows, limit = 12) {
  const withDelta = rows.filter((r) => r.sector !== 'Sector ETF' && r[SINCE_KEY] != null);
  const sorted = withDelta.slice().sort((a, b) => b[SINCE_KEY] - a[SINCE_KEY]);
  return { up: sorted.slice(0, limit), down: sorted.slice(-limit).reverse() };
}

// ═══════════════════════════════════════════
// Aggregation
// ═══════════════════════════════════════════

/** sector → sub-sector → members, sorted by the chosen window. */
function buildMap(rows, period, assetClass = 'equity') {
  const byTicker = {};
  rows.forEach((r) => { byTicker[r.ticker] = r; });

  return Object.entries(groupsFor(assetClass)).map(([sector, subs]) => {
    const subsectors = Object.entries(subs).map(([subsector, tickers]) => {
      const members = tickers.map((t) => byTicker[t]).filter(Boolean);
      return {
        name: subsector,
        members: members.slice().sort((a, b) => (b[period] ?? -999) - (a[period] ?? -999)),
        median: median(members.map((m) => m[period])),
      };
    }).filter((s) => s.members.length)
      .sort((a, b) => (b.median ?? -999) - (a.median ?? -999));

    const all = subsectors.flatMap((s) => s.members);
    return {
      name: sector,
      subsectors,
      median: median(all.map((m) => m[period])),
      trendScore: median(all.map((m) => m.trendScore)),
      count: all.length,
      leaders: all.filter((m) => String(m.setup).startsWith('LEADER')).length,
      broken: all.filter((m) => m.setup === 'BROKEN').length,
      signals: all.reduce((n, m) => n + (m.signals?.length || 0), 0),
    };
  }).filter((s) => s.count)
    .sort((a, b) => (b.median ?? -999) - (a.median ?? -999));
}

function buildETFRanking(rows, period, assetClass = 'equity') {
  const bm = benchmarkFor(assetClass);
  const byTicker = {};
  rows.forEach((r) => { byTicker[r.ticker] = r; });
  const spyRet = byTicker[bm]?.[period];

  return benchmarkStripFor(assetClass)
    .filter((e) => e.symbol !== bm && byTicker[e.symbol])
    .map((e) => {
      const r = byTicker[e.symbol];
      return {
        ...e,
        ret: r[period],
        vsSpy: spyRet != null && r[period] != null ? round(r[period] - spyRet) : null,
        row: r,
      };
    })
    .sort((a, b) => (b.ret ?? -999) - (a.ret ?? -999));
}

function getBenchmarkRow(rows, assetClass = 'equity') {
  const bm = benchmarkFor(assetClass);
  return rows.find((r) => r.ticker === bm) || null;
}

/**
 * Rotation flow — rank each sector by median return over a long window
 * and a short one. A sector climbing the table is where money is moving
 * now; a sector sliding is where it is leaving.
 */
function buildRotationFlow(rows, longKey = '3M', shortKey = '1W', assetClass = 'equity') {
  const byTicker = {};
  rows.forEach((r) => { byTicker[r.ticker] = r; });

  // Crypto has one sector, so rank the sub-sectors against each other
  // instead — "money moving from majors into alt-L1s" is the same question.
  const groups = groupsFor(assetClass);
  const units = assetClass === 'crypto'
    ? Object.entries(groups[CRYPTO_SECTOR] || {}).map(([name, tickers]) => [name, { [name]: tickers }])
    : Object.entries(groups);

  const stats = units.map(([sector, subs]) => {
    const members = Object.values(subs).flat().map((t) => byTicker[t]).filter(Boolean);
    return {
      sector,
      count: members.length,
      long: median(members.map((m) => m[longKey])),
      short: median(members.map((m) => m[shortKey])),
      trendScore: median(members.map((m) => m.trendScore)),
      accel: median(members.map((m) => m.accel)),
    };
  }).filter((s) => s.count);

  const rank = (key) => {
    const order = stats.slice().sort((a, b) => (b[key] ?? -999) - (a[key] ?? -999));
    const m = {};
    order.forEach((s, i) => { m[s.sector] = i + 1; });
    return m;
  };
  const rl = rank('long');
  const rs = rank('short');

  return stats.map((s) => ({
    ...s,
    longRank: rl[s.sector],
    shortRank: rs[s.sector],
    rankDelta: rl[s.sector] - rs[s.sector], // positive = climbing
  })).sort((a, b) => b.rankDelta - a.rankDelta || (b.short ?? -999) - (a.short ?? -999));
}

/** Everything the Trend tab shows, in one pass. */
function buildMovers(rows, period = '1M', limit = 12) {
  const stocks = rows.filter((r) => r.sector !== 'Sector ETF' && !r.stale);
  const has = (r, s) => r.signals?.includes(s);
  const top = (list, key, dir = -1) => list
    .slice()
    .sort((a, b) => dir * ((a[key] ?? -999) - (b[key] ?? -999)))
    .slice(0, limit);

  return {
    accelerating: top(stocks.filter((r) => has(r, 'ACCELERATING')), 'accel'),
    stalling:     top(stocks.filter((r) => has(r, 'STALLING')), 'accel', 1),
    breakouts:    top(stocks.filter((r) => has(r, 'BREAKOUT') || has(r, 'NEW_HIGH')), 'trendScore'),
    resets:       top(stocks.filter((r) => has(r, 'RSI_RESET')), 'trendScore'),
    crosses:      top(stocks.filter((r) => has(r, 'GOLDEN_CROSS')), 'trendScore'),
    surges:       top(stocks.filter((r) => has(r, 'VOL_SURGE')), 'volRatio'),
    breakdowns:   top(stocks.filter((r) => has(r, 'BREAKDOWN') || has(r, 'DEATH_CROSS')), 'trendScore', 1),
    strongest:    top(stocks, 'trendScore'),
    weakest:      top(stocks, 'trendScore', 1),
    gainers:      top(stocks, period),
    losers:       top(stocks, period, 1),
  };
}

function countSignal(rows, key) {
  return rows.filter((r) => r.signals?.includes(key)).length;
}

/** Plain-language rotation read, recomputed from whatever is loaded. */
function buildRotationRead(rows, period, assetClass = 'equity') {
  const sectors = buildMap(rows, period, assetClass);
  const etfs = buildETFRanking(rows, period, assetClass);
  const spy = getBenchmarkRow(rows, assetClass);
  const flow = buildRotationFlow(rows, '3M', '1W', assetClass);
  const benchLabel = assetClass === 'crypto' ? 'BTC' : 'SPY';
  const notes = [];

  if (etfs.length) {
    const top = etfs.slice(0, 2);
    notes.push({
      tone: 'up',
      text: `${top.map((e) => `${e.short} ${fmtPct(e.ret)}`).join(' and ')} lead the ${period} window`
        + (spy?.[period] != null ? ` against ${benchLabel} ${fmtPct(spy[period])}.` : '.'),
    });
    const bottom = etfs[etfs.length - 1];
    notes.push({ tone: 'down', text: `${bottom.short} is the laggard at ${fmtPct(bottom.ret)}.` });
  }

  const climbing = flow.filter((f) => f.rankDelta > 0).slice(0, 2);
  const sliding = flow.filter((f) => f.rankDelta < 0).slice(-2).reverse();
  if (climbing.length) {
    notes.push({
      tone: 'up',
      text: `Money is rotating into ${climbing.map((f) => `${f.sector} (${f.longRank}→${f.shortRank})`).join(' and ')}`
        + ' — sector rank improving from the quarter to the last week.',
    });
  }
  if (sliding.length) {
    notes.push({
      tone: 'down',
      text: `Rotating out of ${sliding.map((f) => `${f.sector} (${f.longRank}→${f.shortRank})`).join(' and ')}.`,
    });
  }

  const subs = sectors.flatMap((s) => s.subsectors.map((sub) => ({ ...sub, sector: s.name })))
    .filter((s) => s.median != null)
    .sort((a, b) => b.median - a.median);
  if (subs.length) {
    notes.push({ tone: 'up', text: `Strongest sub-group: ${subs[0].sector} · ${subs[0].name} (median ${fmtPct(subs[0].median)}).` });
    const w = subs[subs.length - 1];
    notes.push({ tone: 'down', text: `Weakest sub-group: ${w.sector} · ${w.name} (median ${fmtPct(w.median)}).` });
  }

  const stocks = rows.filter((r) => r.sector !== 'Sector ETF' && r.sector !== 'Benchmark');
  if (stocks.length) {
    const leaders = stocks.filter((r) => String(r.setup).startsWith('LEADER')).length;
    const broken = stocks.filter((r) => r.setup === 'BROKEN').length;
    notes.push({
      tone: leaders >= broken ? 'up' : 'down',
      text: `Breadth: ${leaders} of ${stocks.length} names in a leadership trend, ${broken} broken.`,
    });
  }

  const accel = countSignal(stocks, 'ACCELERATING');
  const stall = countSignal(stocks, 'STALLING');
  if (accel || stall) {
    notes.push({
      tone: accel >= stall ? 'up' : 'down',
      text: `Momentum: ${accel} names accelerating, ${stall} stalling.`,
    });
  }

  const entries = stocks.filter((r) => r.setup === 'LEADER-PULLBACK').map((r) => r.ticker);
  if (entries.length) {
    notes.push({
      tone: 'neutral',
      text: `Entry zone (leader on a pullback): ${entries.slice(0, 12).join(', ')}`
        + (entries.length > 12 ? ` +${entries.length - 12} more` : ''),
    });
  }

  return notes;
}

module.exports = {
  ASSET_CLASSES,
  BENCHMARK,
  CORE_PER_SUB,
  CRYPTO_BENCHMARKS,
  CRYPTO_GROUPS,
  CRYPTO_SECTOR,
  EQUITY_GROUPS,
  HEAT_SCALE,
  HEAT_SCALE_CRYPTO,
  PERIODS,
  SECTOR_ETFS,
  SECTOR_GROUPS,
  SECTOR_STYLE,
  SETUPS,
  SIGNALS,
  SINCE_KEY,
  SNAPSHOT,
  SNAPSHOT_ASOF,
  TIERS,
  WINDOWS,
  WINDOW_DAYS,
  WINDOW_KEYS,
  applyDeltas,
  benchmarkFor,
  benchmarkStripFor,
  buildETFRanking,
  buildJustChanged,
  buildMap,
  buildMovers,
  buildRotationFlow,
  buildRotationRead,
  buildSinceMovers,
  countSignal,
  fmtNum,
  fmtPct,
  getBenchmarkRow,
  getMemScan,
  getMeta,
  getRanCheckpointKey,
  getSnapshotAsOf,
  getSnapshotRows,
  getUniverse,
  groupsFor,
  heatScaleFor,
  isCrypto,
  loadCachedScan,
  loadPrevScan,
  loadSectorScan,
  runCheckpointScan,
  tiersFor,
};

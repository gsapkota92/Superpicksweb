// ═══════════════════════════════════════════════════════════════════
// Holdings (server-side port of grannyShots.js + etfTracker fallback)
// Mirrors the mobile app's behavior when FMP is unavailable: getAllHoldings()
// returns the merged-unique GRANNY_HOLDINGS list (etfTracker.getMergedHardcoded).
// React Native / AsyncStorage / FMP-network / React-hook code stripped.
// ═══════════════════════════════════════════════════════════════════

// Holdings with weight % (where known) and which ETF(s) they belong to.
// Ported verbatim from TradingAppFresh/src/data/grannyShots.js
const GRANNY_HOLDINGS = [
  // --- GRNY Top Holdings (Large Cap) ---
  { symbol: 'NFLX', name: 'Netflix', weight: 3.31, etf: 'GRNY', sector: 'Media' },
  { symbol: 'AMD', name: 'AMD', weight: 3.10, etf: 'GRNY', sector: 'Semi' },
  { symbol: 'AMZN', name: 'Amazon', weight: 2.93, etf: 'GRNY', sector: 'Tech' },
  { symbol: 'KLAC', name: 'KLA Corp', weight: 2.91, etf: 'GRNY', sector: 'Semi' },
  { symbol: 'GEV', name: 'GE Vernova', weight: 2.87, etf: 'GRNY', sector: 'Energy' },
  { symbol: 'LRCX', name: 'Lam Research', weight: 2.80, etf: 'GRNY', sector: 'Semi' },
  { symbol: 'PNC', name: 'PNC Financial', weight: 2.75, etf: 'GRNY', sector: 'Finance' },
  { symbol: 'CAT', name: 'Caterpillar', weight: 2.70, etf: 'GRNY', sector: 'Indust.' },
  { symbol: 'GOOGL', name: 'Alphabet', weight: 2.65, etf: 'GRNY', sector: 'Tech' },
  { symbol: 'META', name: 'Meta', weight: 2.50, etf: 'GRNY', sector: 'Tech' },
  { symbol: 'AVGO', name: 'Broadcom', weight: 2.45, etf: 'GRNY', sector: 'Semi' },
  { symbol: 'AAPL', name: 'Apple', weight: 2.40, etf: 'GRNY', sector: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', weight: 2.35, etf: 'GRNY', sector: 'Tech' },
  { symbol: 'JPM', name: 'JPMorgan', weight: 2.30, etf: 'GRNY', sector: 'Finance' },
  { symbol: 'V', name: 'Visa', weight: 2.25, etf: 'GRNY', sector: 'Finance' },

  // --- GRNJ Top Holdings (Small/Mid Cap) ---
  { symbol: 'NBIS', name: 'Nebius Group', weight: 2.68, etf: 'GRNJ', sector: 'Tech' },
  { symbol: 'LITE', name: 'Lumentum', weight: 2.39, etf: 'GRNJ', sector: 'Tech' },
  { symbol: 'BE', name: 'Bloom Energy', weight: 2.36, etf: 'GRNJ', sector: 'Energy' },
  { symbol: 'FN', name: 'Fabrinet', weight: 2.20, etf: 'GRNJ', sector: 'Tech' },
  { symbol: 'FIX', name: 'Comfort Sys', weight: 2.05, etf: 'GRNJ', sector: 'Indust.' },
  { symbol: 'UTHR', name: 'United Thera', weight: 2.03, etf: 'GRNJ', sector: 'Health' },
  { symbol: 'CRS', name: 'Carpenter Tech', weight: 1.98, etf: 'GRNJ', sector: 'Materials' },
  { symbol: 'BWX', name: 'BWX Tech', weight: 1.97, etf: 'GRNJ', sector: 'Defense' },
  { symbol: 'ARRY', name: 'Array Tech', weight: 1.80, etf: 'GRNJ', sector: 'Energy' },
  { symbol: 'CARR', name: 'Carrier Global', weight: 1.75, etf: 'GRNJ', sector: 'Indust.' },
  { symbol: 'CW', name: 'Curtiss-Wright', weight: 1.70, etf: 'GRNJ', sector: 'Defense' },
  { symbol: 'DINO', name: 'HF Sinclair', weight: 1.65, etf: 'GRNJ', sector: 'Energy' },
  { symbol: 'DPZ', name: "Domino's Pizza", weight: 1.60, etf: 'GRNJ', sector: 'Food' },
  { symbol: 'DTM', name: 'DT Midstream', weight: 1.55, etf: 'GRNJ', sector: 'Energy' },
  { symbol: 'ELF', name: 'e.l.f. Beauty', weight: 1.50, etf: 'GRNJ', sector: 'Consumer' },
  { symbol: 'EXEL', name: 'Exelixis', weight: 1.45, etf: 'GRNJ', sector: 'Health' },
  { symbol: 'HALO', name: 'Halozyme', weight: 1.40, etf: 'GRNJ', sector: 'Health' },
  { symbol: 'HII', name: 'Huntington Ing', weight: 1.35, etf: 'GRNJ', sector: 'Defense' },
  { symbol: 'LSCC', name: 'Lattice Semi', weight: 1.30, etf: 'GRNJ', sector: 'Semi' },
  { symbol: 'SATS', name: 'EchoStar', weight: 1.25, etf: 'GRNJ', sector: 'Telecom' },
  { symbol: 'UHS', name: 'Universal Health', weight: 1.20, etf: 'GRNJ', sector: 'Health' },
  { symbol: 'UUUU', name: 'Energy Fuels', weight: 1.15, etf: 'GRNJ', sector: 'Energy' },
  { symbol: 'VMI', name: 'Valmont Ind', weight: 1.10, etf: 'GRNJ', sector: 'Indust.' },

  // --- GRNI Top Holdings (Large Cap + Income) ---
  { symbol: 'LRCX', name: 'Lam Research', weight: 3.76, etf: 'GRNI', sector: 'Semi' },
  { symbol: 'GEV', name: 'GE Vernova', weight: 3.58, etf: 'GRNI', sector: 'Energy' },
  { symbol: 'PNC', name: 'PNC Financial', weight: 3.31, etf: 'GRNI', sector: 'Finance' },
  { symbol: 'CAT', name: 'Caterpillar', weight: 3.22, etf: 'GRNI', sector: 'Indust.' },
  { symbol: 'GOOGL', name: 'Alphabet', weight: 3.12, etf: 'GRNI', sector: 'Tech' },
  { symbol: 'NFLX', name: 'Netflix', weight: 3.05, etf: 'GRNI', sector: 'Media' },
  { symbol: 'AMD', name: 'AMD', weight: 2.95, etf: 'GRNI', sector: 'Semi' },
  { symbol: 'KLAC', name: 'KLA Corp', weight: 2.88, etf: 'GRNI', sector: 'Semi' },
  { symbol: 'AMZN', name: 'Amazon', weight: 2.80, etf: 'GRNI', sector: 'Tech' },
  { symbol: 'META', name: 'Meta', weight: 2.70, etf: 'GRNI', sector: 'Tech' },

  // --- SPHB Top Holdings (S&P 500 High Beta) ---
  { symbol: 'HOOD', name: 'Robinhood', weight: 1.68, etf: 'SPHB', sector: 'Fintech' },
  { symbol: 'TSLA', name: 'Tesla', weight: 1.53, etf: 'SPHB', sector: 'Auto' },
  { symbol: 'APP', name: 'AppLovin', weight: 1.50, etf: 'SPHB', sector: 'AdTech' },
  { symbol: 'MPWR', name: 'Monolithic Power', weight: 1.41, etf: 'SPHB', sector: 'Semi' },
  { symbol: 'COIN', name: 'Coinbase', weight: 1.37, etf: 'SPHB', sector: 'Crypto' },
  { symbol: 'AVGO', name: 'Broadcom', weight: 1.33, etf: 'SPHB', sector: 'Semi' },
  { symbol: 'UAL', name: 'United Airlines', weight: 1.32, etf: 'SPHB', sector: 'Travel' },
  { symbol: 'MU', name: 'Micron', weight: 1.31, etf: 'SPHB', sector: 'Semi' },
  { symbol: 'MCHP', name: 'Microchip Tech', weight: 1.30, etf: 'SPHB', sector: 'Semi' },
  { symbol: 'VST', name: 'Vistra Corp', weight: 1.29, etf: 'SPHB', sector: 'Utilities' },
  { symbol: 'DELL', name: 'Dell Tech', weight: 1.25, etf: 'SPHB', sector: 'Tech' },
  { symbol: 'CVNA', name: 'Carvana', weight: 1.22, etf: 'SPHB', sector: 'Consumer' },
  { symbol: 'NRG', name: 'NRG Energy', weight: 1.20, etf: 'SPHB', sector: 'Utilities' },
  { symbol: 'SMCI', name: 'Super Micro', weight: 1.18, etf: 'SPHB', sector: 'Tech' },
  { symbol: 'CCL', name: 'Carnival', weight: 1.16, etf: 'SPHB', sector: 'Travel' },
  { symbol: 'RCL', name: 'Royal Caribbean', weight: 1.14, etf: 'SPHB', sector: 'Travel' },
  { symbol: 'WYNN', name: 'Wynn Resorts', weight: 1.12, etf: 'SPHB', sector: 'Consumer' },
  { symbol: 'MGM', name: 'MGM Resorts', weight: 1.10, etf: 'SPHB', sector: 'Consumer' },
  { symbol: 'FSLR', name: 'First Solar', weight: 1.08, etf: 'SPHB', sector: 'Energy' },
  { symbol: 'ENPH', name: 'Enphase', weight: 1.06, etf: 'SPHB', sector: 'Energy' },
  { symbol: 'NCLH', name: 'Norwegian Cruise', weight: 1.04, etf: 'SPHB', sector: 'Travel' },
  { symbol: 'PLTR', name: 'Palantir', weight: 1.02, etf: 'SPHB', sector: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA', weight: 1.00, etf: 'SPHB', sector: 'Semi' },
  { symbol: 'AMD', name: 'AMD', weight: 0.98, etf: 'SPHB', sector: 'Semi' },
  { symbol: 'CEG', name: 'Constellation Energy', weight: 0.96, etf: 'SPHB', sector: 'Utilities' },
  { symbol: 'DVN', name: 'Devon Energy', weight: 0.94, etf: 'SPHB', sector: 'Energy' },
  { symbol: 'APA', name: 'APA Corp', weight: 0.92, etf: 'SPHB', sector: 'Energy' },

  // --- SOXX Top Holdings (iShares Semiconductor ETF) ---
  { symbol: 'AVGO', name: 'Broadcom', weight: 8.65, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'NVDA', name: 'NVIDIA', weight: 8.30, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'AMD', name: 'AMD', weight: 5.12, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'QCOM', name: 'Qualcomm', weight: 4.85, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'TXN', name: 'Texas Instruments', weight: 4.60, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'AMAT', name: 'Applied Materials', weight: 4.35, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'LRCX', name: 'Lam Research', weight: 4.10, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'KLAC', name: 'KLA Corp', weight: 3.95, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'MRVL', name: 'Marvell Tech', weight: 3.80, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'MU', name: 'Micron', weight: 3.65, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'INTC', name: 'Intel', weight: 3.20, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'ADI', name: 'Analog Devices', weight: 3.05, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'NXPI', name: 'NXP Semi', weight: 2.90, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'MPWR', name: 'Monolithic Power', weight: 2.75, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'ON', name: 'ON Semi', weight: 2.50, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'MCHP', name: 'Microchip Tech', weight: 2.30, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'ARM', name: 'Arm Holdings', weight: 2.15, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'LSCC', name: 'Lattice Semi', weight: 1.80, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'SWKS', name: 'Skyworks', weight: 1.65, etf: 'SOXX', sector: 'Semi' },
  { symbol: 'QRVO', name: 'Qorvo', weight: 1.40, etf: 'SOXX', sector: 'Semi' },

  // --- IVW Top Holdings (S&P 500 Growth ETF) ---
  { symbol: 'AAPL', name: 'Apple', weight: 12.50, etf: 'IVW', sector: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', weight: 11.80, etf: 'IVW', sector: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA', weight: 10.90, etf: 'IVW', sector: 'Semi' },
  { symbol: 'AMZN', name: 'Amazon', weight: 6.20, etf: 'IVW', sector: 'Tech' },
  { symbol: 'META', name: 'Meta', weight: 4.30, etf: 'IVW', sector: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet', weight: 3.80, etf: 'IVW', sector: 'Tech' },
  { symbol: 'LLY', name: 'Eli Lilly', weight: 3.50, etf: 'IVW', sector: 'Health' },
  { symbol: 'AVGO', name: 'Broadcom', weight: 3.20, etf: 'IVW', sector: 'Semi' },
  { symbol: 'TSLA', name: 'Tesla', weight: 2.80, etf: 'IVW', sector: 'Auto' },
  { symbol: 'V', name: 'Visa', weight: 1.90, etf: 'IVW', sector: 'Finance' },
  { symbol: 'COST', name: 'Costco', weight: 1.70, etf: 'IVW', sector: 'Retail' },
  { symbol: 'MA', name: 'Mastercard', weight: 1.55, etf: 'IVW', sector: 'Finance' },
  { symbol: 'NFLX', name: 'Netflix', weight: 1.40, etf: 'IVW', sector: 'Media' },
  { symbol: 'CRM', name: 'Salesforce', weight: 1.25, etf: 'IVW', sector: 'Tech' },
  { symbol: 'AMD', name: 'AMD', weight: 1.10, etf: 'IVW', sector: 'Semi' },

  // --- IVE Top Holdings (S&P 500 Value ETF — defensive rotation) ---
  { symbol: 'BRK.B', name: 'Berkshire Hath', weight: 4.80, etf: 'IVE', sector: 'Finance' },
  { symbol: 'JPM', name: 'JPMorgan', weight: 3.50, etf: 'IVE', sector: 'Finance' },
  { symbol: 'XOM', name: 'Exxon', weight: 3.20, etf: 'IVE', sector: 'Energy' },
  { symbol: 'UNH', name: 'UnitedHealth', weight: 2.90, etf: 'IVE', sector: 'Health' },
  { symbol: 'PG', name: 'P&G', weight: 2.60, etf: 'IVE', sector: 'Consumer' },
  { symbol: 'JNJ', name: 'Johnson & Johnson', weight: 2.50, etf: 'IVE', sector: 'Health' },
  { symbol: 'ABBV', name: 'AbbVie', weight: 2.30, etf: 'IVE', sector: 'Health' },
  { symbol: 'CVX', name: 'Chevron', weight: 2.10, etf: 'IVE', sector: 'Energy' },
  { symbol: 'BAC', name: 'Bank of Am', weight: 1.95, etf: 'IVE', sector: 'Finance' },
  { symbol: 'WMT', name: 'Walmart', weight: 1.85, etf: 'IVE', sector: 'Retail' },
  { symbol: 'KO', name: 'Coca-Cola', weight: 1.70, etf: 'IVE', sector: 'Consumer' },
  { symbol: 'MRK', name: 'Merck', weight: 1.60, etf: 'IVE', sector: 'Health' },
  { symbol: 'PEP', name: 'PepsiCo', weight: 1.50, etf: 'IVE', sector: 'Consumer' },
  { symbol: 'CSCO', name: 'Cisco', weight: 1.40, etf: 'IVE', sector: 'Tech' },
  { symbol: 'WFC', name: 'Wells Fargo', weight: 1.35, etf: 'IVE', sector: 'Finance' },
  { symbol: 'BMY', name: 'Bristol-Myers', weight: 1.25, etf: 'IVE', sector: 'Health' },
  { symbol: 'PM', name: 'Philip Morris', weight: 1.20, etf: 'IVE', sector: 'Consumer' },
  { symbol: 'RTX', name: 'RTX Corp', weight: 1.15, etf: 'IVE', sector: 'Defense' },
  { symbol: 'NEE', name: 'NextEra Energy', weight: 1.10, etf: 'IVE', sector: 'Utilities' },
  { symbol: 'LOW', name: "Lowe's", weight: 1.05, etf: 'IVE', sector: 'Retail' },
];

// Merged-unique holdings across all ETFs (mirrors etfTracker.getMergedHardcoded /
// getAllHoldings when FMP is unavailable). Dedupes by symbol, tracks etfs[] and
// maxWeight, sorted by maxWeight descending.
function getMergedHardcoded() {
  const map = {};
  GRANNY_HOLDINGS.forEach((h) => {
    if (!map[h.symbol]) {
      map[h.symbol] = { ...h, etfs: [h.etf], maxWeight: h.weight };
    } else {
      if (!map[h.symbol].etfs.includes(h.etf)) map[h.symbol].etfs.push(h.etf);
      if (h.weight > map[h.symbol].maxWeight) map[h.symbol].maxWeight = h.weight;
    }
  });
  return Object.values(map).sort((a, b) => b.maxWeight - a.maxWeight);
}

// Public accessor — matches the app's etfTracker.getAllHoldings() return shape
// when FMP is not configured (the empty-cache path → getMergedHardcoded()).
function getAllHoldings() {
  return getMergedHardcoded();
}

// Holdings filtered by a single ETF (sorted by weight desc), like grannyShots.getHoldingsByETF.
function getHoldingsByETF(etf) {
  return GRANNY_HOLDINGS.filter((h) => h.etf === etf).sort((a, b) => b.weight - a.weight);
}

module.exports = {
  GRANNY_HOLDINGS,
  getAllHoldings,
  getMergedHardcoded,
  getHoldingsByETF,
};

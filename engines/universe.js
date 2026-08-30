// ══════════════════════════════════════════════════════════════
// Equity scan universe — kept in sync with the mobile app's sector map.
//
// The scanner used to see only the Granny Shots ETF holdings (97 names,
// and frozen, since FMP's holdings endpoint is paid-tier). Widening it to
// the app's full sector universe means a stock can surface as a pick
// whether or not it happens to sit in one of the tracked ETFs.
//
// Crypto is excluded: it is scanned by a separate engine in the app, on a
// different clock and against a different benchmark.
// ══════════════════════════════════════════════════════════════

const SECTOR_GROUPS = {
  "TECH": {
    "Consumer tech / platforms": ["AAPL", "PLTR", "APP", "SHOP", "UBER", "DASH"],
    "Semis": ["NVDA", "AVGO", "AMD", "TSM", "MRVL", "QCOM", "TXN", "ADI", "INTC", "ASML", "AMAT", "LRCX", "KLAC", "ARM", "ON", "SMCI", "SOXX"],
    "Memory / hardware": ["MU", "SNDK", "DELL", "ANET", "WDC", "STX", "NTAP", "HPQ"],
    "Software": ["MSFT", "ORCL", "CRM", "NOW", "ADBE", "INTU", "SNOW", "DDOG", "NET", "MDB", "HUBS", "TEAM", "WDAY", "ESTC", "IGV"],
    "Cybersecurity": ["CRWD", "PANW", "ZS", "FTNT", "S", "OKTA"],
  },
  "HEALTH CARE": {
    "Pharma": ["LLY", "MRK", "ABBV", "JNJ", "PFE", "BMY", "AZN", "NVO", "GSK"],
    "Biotech": ["MRNA", "AMGN", "GILD", "VRTX", "REGN", "BIIB", "ALNY", "INCY", "XBI"],
    "Life-sci tools": ["TMO", "DHR", "IQV", "A", "WAT", "MTD", "RVTY"],
    "Med devices": ["ISRG", "MDT", "BSX", "SYK", "ABT", "EW", "GEHC", "ZBH", "BAX"],
    "Managed care": ["UNH", "ELV", "CI", "CVS", "HUM", "CNC"],
  },
  "FINANCIALS": {
    "Money-center banks": ["JPM", "BAC", "C", "WFC"],
    "IB / brokers": ["GS", "MS", "SCHW", "IBKR", "RJF"],
    "Regionals / insurers / AM": ["BLK", "PGR", "KRE", "KIE", "PNC", "USB", "TFC", "MET", "TRV", "CB"],
    "Exchanges / data": ["CME", "ICE", "SPGI", "NDAQ", "MCO"],
    "Payments / fintech": ["V", "MA", "PYPL", "GPN", "TOST", "AFRM", "SOFI"],
  },
  "ENERGY": {
    "Refiners": ["MPC", "VLO", "PSX", "DINO", "PBF", "PARR", "DK"],
    "E&P / Integrated": ["XOM", "CVX", "COP", "EOG", "OXY", "FANG", "DVN", "APA", "MTDR"],
    "Oil services": ["SLB", "HAL", "BKR", "OII", "INVX", "NOV", "RIG", "WFRD"],
    "Tankers / Midstream": ["ET", "KMI", "WMB", "OKE", "EPD", "INSW", "FRO", "STNG", "TNK"],
    "Uranium / nuclear": ["CCJ", "URA", "LEU", "SMR", "OKLO", "NXE"],
    "Nat gas / coal": ["EQT", "LNG", "AR", "RRC", "BTU"],
  },
  "MATERIALS": {
    "Copper": ["FCX", "SCCO", "TECK", "COPX"],
    "Gold miners": ["NEM", "GDX", "AEM", "KGC", "GOLD", "GDXJ"],
    "Silver": ["PAAS", "SIL", "AG", "HL"],
    "Ag / fertilizer": ["DE", "NTR", "CF", "MOS", "ADM", "BG"],
    "Steel / aluminum": ["NUE", "STLD", "CLF", "AA", "CENX"],
    "Chemicals": ["LIN", "APD", "SHW", "DOW", "LYB"],
    "Lithium / rare earth": ["ALB", "MP", "SQM", "LAC"],
  },
  "INDUSTRIALS": {
    "Aerospace / defense": ["BA", "RTX", "LMT", "GE", "NOC", "GD", "LHX", "HWM", "LDOS", "CACI", "ITA"],
    "Machinery": ["CAT", "ETN", "PH", "CMI", "EMR", "PCAR"],
    "Transports": ["UNP", "UPS", "FDX", "CSX", "NSC", "ODFL", "IYT"],
    "Power infra / electrical": ["GEV", "VRT", "PWR", "NVT", "AOS"],
  },
  "DISCRETIONARY": {
    "Retail": ["AMZN", "HD", "LOW", "TJX", "ROST", "ORLY", "AZO", "TGT", "BBY"],
    "Restaurants": ["MCD", "SBUX", "CMG", "DRI", "WING"],
    "Autos / EV": ["TSLA", "GM", "F", "RIVN", "LCID"],
    "Travel / leisure": ["BKNG", "ABNB", "MAR", "HLT", "RCL", "CCL", "DAL", "UAL", "LUV"],
    "Homebuilders": ["DHI", "LEN", "PHM", "NVR", "XHB"],
  },
  "COMM SERVICES": {
    "Internet / media": ["GOOGL", "META", "NFLX", "DIS", "SPOT"],
    "Intl internet": ["BABA", "PDD", "MELI", "SE", "JD"],
    "Telecom": ["TMUS", "T", "VZ", "CMCSA", "CHTR"],
    "Gaming / entertainment": ["TTWO", "RBLX", "LYV", "WBD", "PARA"],
  },
  "STAPLES": {
    "Beverages / food": ["KO", "PEP", "MNST", "MDLZ", "KDP", "GIS", "HSY"],
    "Household / personal": ["PG", "CL", "KMB", "CHD", "EL"],
    "Retail staples": ["WMT", "COST", "KR", "DG", "DLTR"],
    "Tobacco / alcohol": ["PM", "MO", "STZ", "TAP"],
  },
  "UTILITIES": {
    "Regulated": ["NEE", "DUK", "SO", "D", "AEP", "XEL", "ED"],
    "Power / IPP": ["VST", "CEG", "NRG", "TLN", "PEG"],
  },
  "REAL ESTATE": {
    "Data centers / towers": ["EQIX", "DLR", "AMT", "CCI", "SBAC"],
    "REITs": ["PLD", "O", "SPG", "PSA", "WELL", "VICI", "IRM"],
  },
};

const SECTOR_BY_SYMBOL = {};
Object.entries(SECTOR_GROUPS).forEach(([sector, subs]) => {
  Object.entries(subs).forEach(([subsector, tickers]) => {
    tickers.forEach((t) => { SECTOR_BY_SYMBOL[t] = { sector, subsector }; });
  });
});

const EQUITY_UNIVERSE = Object.keys(SECTOR_BY_SYMBOL);

function sectorFor(symbol) {
  return SECTOR_BY_SYMBOL[symbol] || { sector: '', subsector: '' };
}

module.exports = { SECTOR_GROUPS, SECTOR_BY_SYMBOL, EQUITY_UNIVERSE, sectorFor };

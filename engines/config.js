// ═══════════════════════════════════════════════════
// Shared config for the server-side engines (ported from the app).
// Values mirror the mobile app's src/data/config.js so the website
// computes identical results. Prefer environment variables on Render;
// fall back to the app's hardcoded values for parity.
// ═══════════════════════════════════════════════════

const UW_CONFIG = {
  API_KEY: process.env.UW_API_KEY || 'b1babfa9-5705-4708-a60a-b065059c2ecf',
  BASE_URL: process.env.UW_BASE_URL || 'https://api.unusualwhales.com/api',
};

const FMP_CONFIG = {
  API_KEY: process.env.FMP_API_KEY || '', // empty → engines fall back to hardcoded Granny holdings
  BASE_URL: 'https://financialmodelingprep.com/api/v3',
};

// Standard browser-like headers for Yahoo Finance (no key required).
const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// Unusual Whales auth headers (Bearer + client id, matching the app).
const UW_HEADERS = {
  Accept: 'application/json',
  Authorization: `Bearer ${UW_CONFIG.API_KEY}`,
  'UW-CLIENT-API-ID': '100001',
};

module.exports = { UW_CONFIG, FMP_CONFIG, YAHOO_HEADERS, UW_HEADERS };

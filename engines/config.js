// ═══════════════════════════════════════════════════
// Shared config for the server-side engines (ported from the app).
// Values mirror the mobile app's src/data/config.js so the website
// computes identical results. Prefer environment variables on Render;
// fall back to the app's hardcoded values for parity.
// ═══════════════════════════════════════════════════


// FMP retired the /api/v3 endpoints for keys issued after Aug 31 2025 —
// they answer 403 "Legacy Endpoint". Fundamentals use STABLE_URL.
// Set FMP_API_KEY in the Render environment; never commit a key here.
const FMP_CONFIG = {
  API_KEY: process.env.FMP_API_KEY || '',
  BASE_URL: 'https://financialmodelingprep.com/api/v3',   // legacy, 403 for new keys
  STABLE_URL: 'https://financialmodelingprep.com/stable',
};

// Standard browser-like headers for Yahoo Finance (no key required).
const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
};


module.exports = { FMP_CONFIG, YAHOO_HEADERS };

// ═══════════════════════════════════════════════════════════════════
// Unusual Whales API Service — CommonJS port for the Node web server.
// Ported from src/data/unusualWhalesService.js. React Native / AsyncStorage
// removed; uses Node global fetch and shared ./config for auth headers.
//
// Auth matches the app exactly: UW_CONFIG.BASE_URL + UW_HEADERS
// (Accept, Authorization: Bearer <key>, UW-CLIENT-API-ID: 100001).
//
// Provides the generic UW fetch wrapper used across the engines, plus a
// rate-limited variant backed by ./uwRateLimiter. The screener engine does
// not import any UW helper from here (it carries its own private uwFetch),
// but this module is the shared UW access layer for the server.
// ═══════════════════════════════════════════════════════════════════

const { UW_CONFIG, UW_HEADERS } = require('./config');
const { uwFetchJSON } = require('./uwRateLimiter');

const BASE = UW_CONFIG.BASE_URL;
const HEADERS = UW_HEADERS;

// ─── Generic fetcher with error handling (matches the app's uwFetch) ───

async function uwFetch(path) {
  try {
    const url = `${BASE}${path}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      if (res.status !== 404 && res.status !== 429) {
        console.log(`[UW] ${path} → ${res.status}`);
      }
      return null;
    }
    const json = await res.json();
    return json?.data ?? json;
  } catch (err) {
    console.log(`[UW] ${path} error: ${err.message}`);
    return null;
  }
}

// Rate-limited variant (delegates to uwRateLimiter.uwFetchJSON).
async function uwFetchRateLimited(path) {
  return uwFetchJSON(path);
}

module.exports = {
  uwFetch,
  uwFetchRateLimited,
  UW_HEADERS,
  BASE_URL: BASE,
};

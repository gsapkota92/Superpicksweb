// ═══════════════════════════════════════════
// UW API Rate Limiter — 120 requests/minute
// CONCURRENT model — fires requests immediately
// but tracks RPM and pauses only when near limit
// CommonJS port of src/data/uwRateLimiter.js (Node + global fetch).
// ═══════════════════════════════════════════

const { UW_CONFIG, UW_HEADERS } = require('./config');

const MAX_RPM = 115; // UW limit is 120, tiny buffer

let _timestamps = [];

function _cleanOld() {
  const cutoff = Date.now() - 60000;
  _timestamps = _timestamps.filter((t) => t > cutoff);
}

function _slotsLeft() {
  _cleanOld();
  return MAX_RPM - _timestamps.length;
}

async function _waitForSlot() {
  while (_slotsLeft() <= 0) {
    _cleanOld();
    if (_slotsLeft() > 0) break;
    const oldest = _timestamps[0];
    const waitMs = Math.max(50, oldest + 60000 - Date.now() + 50);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  _timestamps.push(Date.now());
}

/**
 * Rate-limited fetch — fires immediately if under RPM limit,
 * waits only when approaching 120/min cap.
 * Multiple requests run concurrently.
 */
async function uwRateLimitedFetch(url, priority = false) {
  await _waitForSlot();
  return fetch(url, { headers: UW_HEADERS });
}

/**
 * Convenience: rate-limited fetch that returns parsed JSON data.
 * Returns json.data if present, otherwise json. Returns null on error.
 */
async function uwFetchJSON(path, priority = false, timeoutMs = 15000) {
  try {
    const url = `${UW_CONFIG.BASE_URL}${path}`;
    const res = await uwRateLimitedFetch(url, priority);

    if (!res.ok) {
      if (res.status === 429) {
        console.log(`[UW-RL] 429 on ${path}`);
      } else if (res.status !== 404) {
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

function getAvailableRequests() {
  _cleanOld();
  return MAX_RPM - _timestamps.length;
}

function getQueueLength() {
  return 0;
}

module.exports = {
  uwRateLimitedFetch,
  uwFetchJSON,
  getAvailableRequests,
  getQueueLength,
  UW_HEADERS,
};

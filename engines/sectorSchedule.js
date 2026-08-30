// Sector checkpoint clock — ported from the mobile app's
// src/data/sectorMapSchedule.js so the server refreshes on exactly the
// same schedule the app does: equities at 10:00, 13:00 and 16:00 New York
// on weekdays (noon on weekends), crypto every two hours, all week.
// ═══════════════════════════════════════════════════════════════════
// Sector Map checkpoints
//
// The map refreshes on a fixed schedule in US Eastern time:
//   weekdays   10:00 AM · 1:00 PM · 4:00 PM   (open drift, midday, close)
//   weekends   12:00 PM                        (crypto keeps trading)
//
// Each checkpoint is identified by a stable key so a scan runs once per
// checkpoint and no more, however often the app is opened. If the app
// was closed across a checkpoint, the next time the Sector Map is on
// screen it catches up immediately rather than showing pre-checkpoint
// numbers — otherwise "updates at 1:00 PM" would only be true for
// someone staring at the tab at 12:59.
//
// Times are resolved through Intl with an America/New_York timeZone, so
// they follow US daylight saving without a date library.
// ═══════════════════════════════════════════════════════════════════


const TZ = 'America/New_York';

// Equities follow the session: open drift, midday, close — plus a single
// weekend run so the map isn't a week stale on a Sunday.
const WEEKDAY_HOURS = [10, 13, 16];
const WEEKEND_HOURS = [12];

// Crypto never closes, so it gets its own clock: every two hours, every
// day. Same checkpoint machinery, separate keys, separate cadence.
const CRYPTO_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

/** Which hours are checkpoints for this asset class on this weekday. */
function hoursFor(assetClass, weekday) {
  if (assetClass === 'crypto') return CRYPTO_HOURS;
  return weekday === 0 || weekday === 6 ? WEEKEND_HOURS : WEEKDAY_HOURS;
}

const CHECK_EVERY_MS = 60 * 1000; // poll rather than one long timer — survives suspend
const LOOKBACK_DAYS = 8;

// ─── Eastern-time helpers ───

/** Wall-clock fields for an instant, read in Eastern time. */
function etParts(date) {
  const s = new Date(date).toLocaleString('en-US', { timeZone: TZ, hour12: false });
  const [datePart, timePart = '0:0:0'] = s.split(', ');
  const [M, D, Y] = datePart.split('/').map(Number);
  let [h, m] = timePart.split(':').map(Number);
  if (h === 24) h = 0; // some engines render midnight as 24:00:00
  // Day-of-week of the ET calendar date, computed in UTC to avoid a
  // second timezone conversion.
  const weekday = new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
  return { Y, M, D, h, m, weekday };
}

/** Milliseconds to add to an Eastern wall clock to get the UTC instant. */
function etOffsetMs(nearInstant) {
  const d = new Date(nearInstant);
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asEt = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  return asUtc.getTime() - asEt.getTime();
}

/** The instant at which it is Y-M-D h:00 in Eastern time. */
function etInstant(Y, M, D, h) {
  const naive = Date.UTC(Y, M - 1, D, h, 0, 0, 0);
  // Offset is evaluated at the approximate instant, then re-evaluated once
  // in case the first guess landed on the other side of a DST boundary.
  let ts = naive + etOffsetMs(naive);
  ts = naive + etOffsetMs(ts);
  return ts;
}

/** Every checkpoint on the ET calendar day containing `date`. */
function checkpointsOn(date, assetClass = 'equity') {
  const { Y, M, D, weekday } = etParts(date);
  return hoursFor(assetClass, weekday).map((h) => ({
    ts: etInstant(Y, M, D, h),
    hour: h,
    weekday,
  }));
}

const DAY_MS = 24 * 3600 * 1000;

function label(ts) {
  const { h, weekday } = etParts(ts);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const today = etParts(Date.now());
  const that = etParts(ts);
  const sameDay = today.Y === that.Y && today.M === that.M && today.D === that.D;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday];
  return `${sameDay ? '' : `${day} `}${h12}:00 ${ampm} ET`;
}

/** Stable identity for a checkpoint, e.g. "equity:2026-08-31T13". */
function checkpointKey(ts, assetClass = 'equity') {
  const { Y, M, D, h } = etParts(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${assetClass}:${Y}-${p(M)}-${p(D)}T${p(h)}`;
}

/** The most recent checkpoint at or before `now`. */
function lastCheckpoint(now = Date.now(), assetClass = 'equity') {
  for (let back = 0; back <= LOOKBACK_DAYS; back++) {
    const cps = checkpointsOn(now - back * DAY_MS, assetClass)
      .filter((c) => c.ts <= now)
      .sort((a, b) => b.ts - a.ts);
    if (cps.length) {
      const c = cps[0];
      return { ...c, key: checkpointKey(c.ts, assetClass), label: label(c.ts), assetClass };
    }
  }
  return null;
}

/** The next checkpoint strictly after `now`. */
function nextCheckpoint(now = Date.now(), assetClass = 'equity') {
  for (let ahead = 0; ahead <= LOOKBACK_DAYS; ahead++) {
    const cps = checkpointsOn(now + ahead * DAY_MS, assetClass)
      .filter((c) => c.ts > now)
      .sort((a, b) => a.ts - b.ts);
    if (cps.length) {
      const c = cps[0];
      return { ...c, key: checkpointKey(c.ts, assetClass), label: label(c.ts), assetClass };
    }
  }
  return null;
}

/** "in 2h 14m" — how long until the next checkpoint. */
function untilText(ts, now = Date.now()) {
  const ms = ts - now;
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

function scheduleStatus(now = Date.now(), assetClass = 'equity') {
  const last = lastCheckpoint(now, assetClass);
  const next = nextCheckpoint(now, assetClass);
  return {
    last,
    next,
    nextIn: next ? untilText(next.ts, now) : null,
  };
}

// ─── Scheduler ───

/**
 * Fire `onCheckpoint(checkpoint)` once for each checkpoint that passes,
 * including one that already passed while the app was closed.
 *
 * @param {object} opts
 * @param {function} opts.getRanKey  () => last checkpoint key already scanned
 * @param {function} opts.onCheckpoint async (checkpoint) => void
 * @returns {function} stop
 */
function startCheckpointScheduler({ getRanKey, onCheckpoint, assetClass = 'equity' }) {
  let stopped = false;
  let busy = false;

  const check = async (reason) => {
    if (stopped || busy) return;
    const cp = lastCheckpoint(Date.now(), assetClass);
    if (!cp) return;
    const ran = await getRanKey();
    if (ran === cp.key) return;
    busy = true;
    try {
      await onCheckpoint(cp, reason);
    } catch (e) {
      // a failed checkpoint is retried on the next poll
    } finally {
      busy = false;
    }
  };

  // The app also re-checks when it comes back to the foreground; a server
  // is never backgrounded, so the poll is the whole story here.
  check('start');
  const interval = setInterval(() => check('timer'), CHECK_EVERY_MS);
  if (interval.unref) interval.unref();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}


module.exports = { CRYPTO_HOURS, TZ, WEEKDAY_HOURS, WEEKEND_HOURS, checkpointKey, checkpointsOn, etInstant, etParts, lastCheckpoint, nextCheckpoint, scheduleStatus, startCheckpointScheduler, untilText };

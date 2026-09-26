// ═══════════════════════════════════════════════════
// P&L ledger
//
// The permanent record of what the scanner's signals actually did, built
// only from closed positions with a real exit price.
//
// Results are expressed in PERCENTAGE POINTS, summed. A signal that returned
// +4.2% contributes +4.2 points; one that returned -3.1% contributes -3.1.
// The running total is therefore what you would have earned taking every
// signal at the same size, ignoring compounding.
//
// The honest caveat, stated here because it belongs next to the arithmetic:
// summing points weights every signal equally regardless of price or holding
// period, and the scanner routinely holds twenty-odd positions at once, so
// this is a scorecard for the signals rather than a statement for an account
// anyone could have run. SPY is summed the same way over the same windows so
// the comparison is like for like.
// ═══════════════════════════════════════════════════

const MEASURED = 2; // rows written by the corrected bookkeeping

function r2(v) { return v == null ? null : Math.round(v * 100) / 100; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function holdDays(entry, exit) {
  if (!entry || !exit) return null;
  const ms = new Date(exit) - new Date(entry);
  return ms >= 0 ? Math.round((ms / 86400000) * 10) / 10 : null;
}

/** Closed, honestly-measured rows, oldest first. */
function closedTrades(history) {
  return history
    .filter((h) => h.status === 'closed'
      && h.measurement_version >= MEASURED
      && h.return_pct != null)
    .slice()
    .sort((a, b) => new Date(a.exit_date) - new Date(b.exit_date));
}

/** One ledger line per closed signal. */
function toLedger(h) {
  return {
    id: h.id,
    symbol: h.symbol,
    name: h.name || h.symbol,
    score_at_entry: h.composite_score ?? null,
    signal_at_entry: h.overall_signal || null,
    entry_date: h.entry_date,
    entry_price: h.entry_price,
    exit_date: h.exit_date,
    exit_price: h.exit_price,
    points: r2(h.return_pct),
    spy_points: h.bench_return_pct != null ? r2(h.bench_return_pct) : null,
    excess_points: h.excess_return_pct != null ? r2(h.excess_return_pct) : null,
    hold_days: holdDays(h.entry_date, h.exit_date),
    exit_reason: h.exit_reason || null,
    stop: h.stop ?? null,
    stop_basis: h.stop_basis ?? null,
    peak_points: h.peak_return_pct != null ? r2(h.peak_return_pct) : null,
    // Set on positions opened before the fix and closed after it: honest
    // entry and exit, but no SPY leg to compare against.
    note: h.entry_provenance || null,
  };
}

/**
 * The record.
 * @param {Array} history  the raw history store
 * @param {object} [opts]
 * @param {string} [opts.from]  ISO date — only count trades closed on or after
 */
function buildPnL(history, opts = {}) {
  let rows = closedTrades(history);
  if (opts.from) {
    const cutoff = new Date(opts.from);
    rows = rows.filter((h) => new Date(h.exit_date) >= cutoff);
  }

  const trades = rows.map(toLedger);
  const pts = trades.map((t) => t.points);

  // Running total, one point per closed trade in the order they closed. SPY
  // accumulates alongside so the two lines answer the same question.
  let cum = 0;
  let cumSpy = 0;
  const curve = trades.map((t) => {
    cum += t.points;
    if (t.spy_points != null) cumSpy += t.spy_points;
    return {
      date: t.exit_date,
      symbol: t.symbol,
      points: t.points,
      cum_points: r2(cum),
      cum_spy_points: r2(cumSpy),
    };
  });

  // Calendar months, so a bad stretch is visible as a stretch rather than
  // averaged away over the whole record.
  const months = {};
  trades.forEach((t) => {
    const key = String(t.exit_date).slice(0, 7);
    if (!months[key]) months[key] = { month: key, points: 0, spy_points: 0, trades: 0, winners: 0 };
    const m = months[key];
    m.points += t.points;
    if (t.spy_points != null) m.spy_points += t.spy_points;
    m.trades++;
    if (t.points > 0) m.winners++;
  });
  const by_month = Object.values(months)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, points: r2(m.points), spy_points: r2(m.spy_points) }));

  const wins = pts.filter((p) => p > 0);
  const losses = pts.filter((p) => p <= 0);
  const benched = trades.filter((t) => t.excess_points != null);

  const openRows = history.filter((h) => h.status === 'active' && h.measurement_version >= MEASURED);

  return {
    as_of: new Date().toISOString(),
    unit: 'percentage points',
    basis: 'Every closed signal counted once at equal weight. Not compounded.',
    totals: {
      closed_trades: trades.length,
      total_points: r2(pts.reduce((a, b) => a + b, 0)),
      spy_points: benched.length ? r2(benched.reduce((a, t) => a + t.spy_points, 0)) : null,
      excess_points: benched.length ? r2(benched.reduce((a, t) => a + t.excess_points, 0)) : null,
      winners: wins.length,
      losers: losses.length,
      // Null, not zero, when nothing has closed: an empty record is not a 0%
      // win rate, and a zero there reads like a measured result.
      win_rate: trades.length ? r2((wins.length / trades.length) * 100) : null,
      beat_spy: benched.filter((t) => t.excess_points > 0).length,
      beat_spy_rate: benched.length
        ? r2((benched.filter((t) => t.excess_points > 0).length / benched.length) * 100) : null,
      avg_points: trades.length ? r2(mean(pts)) : null,
      avg_win: wins.length ? r2(mean(wins)) : null,
      avg_loss: losses.length ? r2(mean(losses)) : null,
      best: trades.length ? r2(Math.max(...pts)) : null,
      worst: trades.length ? r2(Math.min(...pts)) : null,
      // Gross wins over gross losses. Above 1 means the winners carried more
      // than the losers cost, which can be true even at a poor win rate.
      profit_factor: losses.length && losses.reduce((a, b) => a + b, 0) !== 0
        ? r2(wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0)))
        : null,
      stopped_out: trades.filter((t) => t.exit_reason === 'stopped-out').length,
      avg_hold_days: trades.length
        ? r2(mean(trades.map((t) => t.hold_days).filter((d) => d != null))) : null,
      first_close: trades.length ? trades[0].exit_date : null,
      last_close: trades.length ? trades[trades.length - 1].exit_date : null,
    },
    open_positions: openRows.length,
    curve,
    by_month,
    trades: trades.slice().reverse(), // newest first for reading
  };
}

/** The ledger as CSV, for keeping a copy outside the app. */
function toCSV(pnl) {
  const cols = ['symbol', 'name', 'entry_date', 'entry_price', 'exit_date', 'exit_price',
    'points', 'spy_points', 'excess_points', 'hold_days', 'exit_reason',
    'score_at_entry', 'signal_at_entry', 'stop', 'stop_basis', 'peak_points'];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  // Oldest first in the export — a ledger reads forward.
  pnl.trades.slice().reverse().forEach((t) => lines.push(cols.map((c) => esc(t[c])).join(',')));
  lines.push('');
  lines.push(`TOTAL,,,,,,${pnl.totals.total_points},${pnl.totals.spy_points ?? ''},${pnl.totals.excess_points ?? ''}`);
  return lines.join('\n');
}

module.exports = { buildPnL, toCSV, closedTrades };

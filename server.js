// ═══════════════════════════════════════════════════
// Super Picks Trading — Express Server
// superpickstrading.com
// ═══════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'sp-dev-key-change-me';

// ── Database Setup ──
const db = new Database(path.join(__dirname, 'superpicks.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT DEFAULT '',
    composite_score REAL DEFAULT 0,
    overall_signal TEXT DEFAULT 'Neutral',
    price REAL DEFAULT 0,
    daily_change REAL DEFAULT 0,
    momentum_score REAL DEFAULT 0,
    momentum_label TEXT DEFAULT '',
    macd_score REAL DEFAULT 0,
    macd_label TEXT DEFAULT '',
    sma_score REAL DEFAULT 0,
    sma_label TEXT DEFAULT '',
    stoch_score REAL DEFAULT 0,
    stoch_label TEXT DEFAULT '',
    volume_score REAL DEFAULT 0,
    volume_label TEXT DEFAULT '',
    cci_score REAL DEFAULT 0,
    cci_label TEXT DEFAULT '',
    willr_score REAL DEFAULT 0,
    willr_label TEXT DEFAULT '',
    rsi_value REAL DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS picks_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    name TEXT DEFAULT '',
    composite_score REAL DEFAULT 0,
    overall_signal TEXT DEFAULT 'Neutral',
    entry_price REAL DEFAULT 0,
    entry_date DATETIME DEFAULT (datetime('now')),
    exit_price REAL DEFAULT 0,
    exit_date DATETIME,
    return_pct REAL DEFAULT 0,
    peak_price REAL DEFAULT 0,
    peak_return_pct REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    scan_batch TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    total_scanned INTEGER DEFAULT 0,
    picks_found INTEGER DEFAULT 0,
    avg_score REAL DEFAULT 0,
    scan_time_ms INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_picks_symbol ON picks(symbol);
  CREATE INDEX IF NOT EXISTS idx_history_symbol ON picks_history(symbol);
  CREATE INDEX IF NOT EXISTS idx_history_status ON picks_history(status);
  CREATE INDEX IF NOT EXISTS idx_history_entry ON picks_history(entry_date);
`);

// ── Middleware ──
app.use(helmet({
  contentSecurityPolicy: false,  // Allow inline styles/scripts for dashboard
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware for write endpoints ──
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}

// ═══════════════════════════════════════════════════
// PUBLIC READ ENDPOINTS
// ═══════════════════════════════════════════════════

// GET /api/picks — Current live picks
app.get('/api/picks', (req, res) => {
  const picks = db.prepare(`
    SELECT * FROM picks ORDER BY composite_score DESC
  `).all();
  res.json({
    timestamp: new Date().toISOString(),
    count: picks.length,
    picks,
  });
});

// GET /api/signals — Trading signals (simplified format for bots/Robinhood)
app.get('/api/signals', (req, res) => {
  const picks = db.prepare(`
    SELECT symbol, name, composite_score, overall_signal, price, daily_change, updated_at
    FROM picks ORDER BY composite_score DESC
  `).all();

  const signals = picks.map((p) => ({
    symbol: p.symbol,
    action: p.composite_score >= 6 ? 'STRONG_BUY' : p.composite_score >= 2 ? 'BUY' : 'HOLD',
    signal: p.overall_signal,
    score: p.composite_score,
    price: p.price,
    change_pct: p.daily_change,
    confidence: Math.min(1, Math.max(0, (p.composite_score + 10) / 20)),
    updated: p.updated_at,
  }));

  res.json({
    timestamp: new Date().toISOString(),
    market_open: isMarketOpen(),
    count: signals.length,
    signals,
  });
});

// GET /api/history — Historical performance
app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const status = req.query.status || 'all'; // 'active', 'closed', 'all'

  let query = 'SELECT * FROM picks_history';
  const params = [];

  if (status !== 'all') {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY entry_date DESC LIMIT ?';
  params.push(limit);

  const history = db.prepare(query).all(...params);
  res.json({
    timestamp: new Date().toISOString(),
    count: history.length,
    history,
  });
});

// GET /api/stats — Overall performance statistics
app.get('/api/stats', (req, res) => {
  const closed = db.prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END) as winners,
      SUM(CASE WHEN return_pct <= 0 THEN 1 ELSE 0 END) as losers,
      AVG(return_pct) as avg_return,
      MAX(return_pct) as best_trade,
      MIN(return_pct) as worst_trade,
      AVG(CASE WHEN return_pct > 0 THEN return_pct END) as avg_win,
      AVG(CASE WHEN return_pct <= 0 THEN return_pct END) as avg_loss,
      MAX(peak_return_pct) as best_peak
    FROM picks_history WHERE status = 'closed'
  `).get();

  const active = db.prepare(`
    SELECT COUNT(*) as count FROM picks_history WHERE status = 'active'
  `).get();

  const currentPicks = db.prepare(`
    SELECT COUNT(*) as count, AVG(composite_score) as avg_score FROM picks
  `).get();

  const recentScans = db.prepare(`
    SELECT * FROM scan_log ORDER BY created_at DESC LIMIT 10
  `).all();

  const winRate = closed.total_trades > 0
    ? ((closed.winners / closed.total_trades) * 100).toFixed(1)
    : 0;

  res.json({
    current: {
      picks_count: currentPicks.count,
      avg_score: round2(currentPicks.avg_score),
    },
    performance: {
      total_trades: closed.total_trades,
      winners: closed.winners,
      losers: closed.losers,
      win_rate: parseFloat(winRate),
      avg_return: round2(closed.avg_return),
      best_trade: round2(closed.best_trade),
      worst_trade: round2(closed.worst_trade),
      avg_win: round2(closed.avg_win),
      avg_loss: round2(closed.avg_loss),
      best_peak: round2(closed.best_peak),
    },
    active_positions: active.count,
    recent_scans: recentScans,
  });
});

// GET /api/health — Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════
// AUTHENTICATED WRITE ENDPOINTS (from Expo app)
// ═══════════════════════════════════════════════════

// POST /api/picks — Push new picks from the app
app.post('/api/picks', requireApiKey, (req, res) => {
  const { picks, scanMeta } = req.body;

  if (!Array.isArray(picks) || picks.length === 0) {
    return res.status(400).json({ error: 'picks must be a non-empty array' });
  }

  const batchId = `scan_${Date.now()}`;

  const insertPick = db.prepare(`
    INSERT OR REPLACE INTO picks
      (symbol, name, composite_score, overall_signal, price, daily_change,
       momentum_score, momentum_label, macd_score, macd_label,
       sma_score, sma_label, stoch_score, stoch_label,
       volume_score, volume_label, cci_score, cci_label,
       willr_score, willr_label, rsi_value, updated_at)
    VALUES
      (@symbol, @name, @compositeScore, @overallSignal, @price, @dailyChange,
       @momentumScore, @momentumLabel, @macdScore, @macdLabel,
       @smaScore, @smaLabel, @stochScore, @stochLabel,
       @volumeScore, @volumeLabel, @cciScore, @cciLabel,
       @willrScore, @willrLabel, @rsiValue, datetime('now'))
  `);

  const insertHistory = db.prepare(`
    INSERT INTO picks_history
      (symbol, name, composite_score, overall_signal, entry_price, scan_batch, status)
    VALUES
      (@symbol, @name, @compositeScore, @overallSignal, @price, @batchId, 'active')
  `);

  // Get currently active picks to detect removals
  const currentActive = db.prepare(`
    SELECT symbol, entry_price FROM picks_history WHERE status = 'active'
  `).all();
  const activeMap = {};
  currentActive.forEach((a) => { activeMap[a.symbol] = a; });

  const newSymbols = new Set(picks.map((p) => p.symbol));

  const transaction = db.transaction(() => {
    // Clear old picks
    db.prepare('DELETE FROM picks').run();

    // Insert new picks
    for (const pick of picks) {
      insertPick.run({
        symbol: pick.symbol || '',
        name: pick.name || pick.symbol || '',
        compositeScore: pick.compositeScore || 0,
        overallSignal: pick.overallSignal || 'Neutral',
        price: pick.price || 0,
        dailyChange: pick.dailyChange || 0,
        momentumScore: pick.indicators?.momentum?.score || 0,
        momentumLabel: pick.indicators?.momentum?.label || '',
        macdScore: pick.indicators?.macd?.score || 0,
        macdLabel: pick.indicators?.macd?.label || '',
        smaScore: pick.indicators?.sma?.score || 0,
        smaLabel: pick.indicators?.sma?.label || '',
        stochScore: pick.indicators?.stochastic?.score || 0,
        stochLabel: pick.indicators?.stochastic?.label || '',
        volumeScore: pick.indicators?.volume?.score || 0,
        volumeLabel: pick.indicators?.volume?.label || '',
        cciScore: pick.indicators?.cci?.score || 0,
        cciLabel: pick.indicators?.cci?.label || '',
        willrScore: pick.indicators?.williamsR?.score || 0,
        willrLabel: pick.indicators?.williamsR?.label || '',
        rsiValue: pick.indicators?.rsi?.value || 0,
      });

      // Add to history if new pick
      if (!activeMap[pick.symbol]) {
        insertHistory.run({
          symbol: pick.symbol,
          name: pick.name || pick.symbol,
          compositeScore: pick.compositeScore || 0,
          overallSignal: pick.overallSignal || 'Neutral',
          price: pick.price || 0,
          batchId,
        });
      }
    }

    // Close picks that dropped off the list
    for (const sym of Object.keys(activeMap)) {
      if (!newSymbols.has(sym)) {
        // Find current price from the most recent pick data or use entry price
        const latestPrice = picks.find((p) => p.symbol === sym)?.price || activeMap[sym].entry_price;
        const entryPrice = activeMap[sym].entry_price;
        const returnPct = entryPrice > 0 ? ((latestPrice - entryPrice) / entryPrice) * 100 : 0;

        db.prepare(`
          UPDATE picks_history
          SET status = 'closed', exit_price = ?, exit_date = datetime('now'), return_pct = ?
          WHERE symbol = ? AND status = 'active'
        `).run(latestPrice, returnPct, sym);
      }
    }

    // Log the scan
    const avgScore = picks.reduce((sum, p) => sum + (p.compositeScore || 0), 0) / picks.length;
    db.prepare(`
      INSERT INTO scan_log (batch_id, total_scanned, picks_found, avg_score, scan_time_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(batchId, scanMeta?.totalScanned || 0, picks.length, avgScore, scanMeta?.scanTimeMs || 0);
  });

  transaction();

  console.log(`[API] Received ${picks.length} picks (batch: ${batchId})`);
  res.json({
    success: true,
    batch_id: batchId,
    picks_count: picks.length,
    closed_count: Object.keys(activeMap).filter((s) => !newSymbols.has(s)).length,
  });
});

// POST /api/picks/:symbol/update-price — Update price for active history picks
app.post('/api/picks/:symbol/update-price', requireApiKey, (req, res) => {
  const { symbol } = req.params;
  const { price } = req.body;

  if (!price || price <= 0) {
    return res.status(400).json({ error: 'Valid price required' });
  }

  const active = db.prepare(`
    SELECT id, entry_price, peak_price FROM picks_history
    WHERE symbol = ? AND status = 'active'
  `).get(symbol);

  if (!active) {
    return res.status(404).json({ error: 'No active pick for this symbol' });
  }

  const newPeak = Math.max(active.peak_price || 0, price);
  const peakReturn = active.entry_price > 0
    ? ((newPeak - active.entry_price) / active.entry_price) * 100 : 0;

  db.prepare(`
    UPDATE picks_history SET peak_price = ?, peak_return_pct = ? WHERE id = ?
  `).run(newPeak, peakReturn, active.id);

  // Also update the picks table price
  db.prepare(`
    UPDATE picks SET price = ?, updated_at = datetime('now') WHERE symbol = ?
  `).run(price, symbol);

  res.json({ success: true, symbol, price, peak_price: newPeak });
});

// ═══════════════════════════════════════════════════
// Serve frontend
// ═══════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Helpers ──
function round2(v) { return v != null ? Math.round(v * 100) / 100 : 0; }

function isMarketOpen() {
  const now = new Date();
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay();
  const hour = ny.getHours();
  const min = ny.getMinutes();
  const t = hour * 60 + min;
  return day >= 1 && day <= 5 && t >= 570 && t < 960; // 9:30am - 4:00pm ET
}

// ── Start server ──
app.listen(PORT, () => {
  console.log(`\n  Super Picks Trading Server`);
  console.log(`  ─────────────────────────`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  API Picks:  http://localhost:${PORT}/api/picks`);
  console.log(`  Signals:    http://localhost:${PORT}/api/signals`);
  console.log(`  Stats:      http://localhost:${PORT}/api/stats`);
  console.log(`  Health:     http://localhost:${PORT}/api/health`);
  console.log(`\n  API Key:    ${API_KEY.slice(0, 8)}...`);
  console.log();
});

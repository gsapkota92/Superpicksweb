// ═══════════════════════════════════════════════════
// Persistence
//
// Render's free tier gives the container an ephemeral filesystem: the data/
// directory is recreated empty on every deploy. Forward-recorded measurement
// depends on records outliving deploys, so when DATABASE_URL is set the
// store lives in Postgres instead.
//
// Without DATABASE_URL this falls back to the JSON files, unchanged, so the
// site keeps running exactly as before until the variable is set.
//
// The shape is deliberately dumb: one row per collection holding its whole
// JSON payload. This is a few hundred picks and a few thousand history rows —
// far too little to be worth a schema, migrations, and an ORM, and keeping
// the JSON shape means nothing downstream had to change.
// ═══════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['picks', 'history', 'scanlogs', 'fundamentals', 'sectors', 'nextid'];

function makeFileStore(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return {
    kind: 'file',
    async init() {},
    async load(name, fallback) {
      try { return JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')); }
      catch { return fallback; }
    },
    async save(name, data) {
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
    },
  };
}

function makePgStore(url) {
  // Required lazily so the dependency is only needed when it is actually used.
  const { Pool } = require('pg');

  // Hosted Postgres (Supabase, Neon, Render) requires TLS, and terminates it
  // with a certificate Node will not chain to a public root — hence the
  // relaxed verification. A local or self-hosted server usually speaks no TLS
  // at all and errors outright if it is offered, so SSL is skipped for
  // localhost and whenever the URL asks for sslmode=disable.
  let host = '';
  let sslmode = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    sslmode = u.searchParams.get('sslmode') || '';
  } catch { /* non-URL connection string — fall through to defaults */ }

  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const ssl = (sslmode === 'disable' || local) ? false : { rejectUnauthorized: false };

  const pool = new Pool({ connectionString: url, ssl, max: 4 });

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS store (
          name       TEXT PRIMARY KEY,
          data       JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },
    async load(name, fallback) {
      const { rows } = await pool.query('SELECT data FROM store WHERE name = $1', [name]);
      return rows.length ? rows[0].data : fallback;
    },
    async save(name, data) {
      await pool.query(
        `INSERT INTO store (name, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [name, JSON.stringify(data)]
      );
    },
    async close() { await pool.end(); },
  };
}

function createStore({ dir, databaseUrl }) {
  if (!databaseUrl) {
    console.log('[Store] DATABASE_URL not set — using JSON files. '
      + 'On Render\'s free tier this data is lost on every deploy.');
    return makeFileStore(dir);
  }
  console.log('[Store] Using Postgres.');
  return makePgStore(databaseUrl);
}

/**
 * First run against a fresh database: copy whatever the JSON files hold in,
 * so switching to Postgres does not start the record over. Only ever writes
 * a collection that is currently absent.
 */
async function seedFromFiles(store, dir) {
  if (store.kind !== 'postgres' || !fs.existsSync(dir)) return;
  for (const name of COLLECTIONS) {
    const existing = await store.load(name, null);
    if (existing != null) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, `${name}.json`), 'utf8');
      await store.save(name, JSON.parse(raw));
      console.log(`[Store] Seeded ${name} from disk.`);
    } catch { /* nothing on disk for this collection — normal */ }
  }
}

module.exports = { createStore, seedFromFiles, COLLECTIONS };

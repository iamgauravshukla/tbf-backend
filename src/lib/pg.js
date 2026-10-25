import pg from 'pg';
import { config } from '../config.js';

// Postgres connection. Active only when DATABASE_URL is set; otherwise the app
// falls back to the JSON file store and none of this runs.

export const pgEnabled = Boolean(config.databaseUrl);

function sslOption(url) {
  if (config.pgSsl === 'false') return false;
  if (config.pgSsl === 'true') return { rejectUnauthorized: false };
  // Railway's private URL (…railway.internal) needs no TLS; the public proxy and
  // most managed hosts do. Default off for localhost/internal.
  if (/\.railway\.internal|localhost|127\.0\.0\.1/.test(url)) return false;
  if (/rlwy\.net|amazonaws|sslmode=require|render\.com|neon\.tech|supabase|\.railway\.app/.test(url)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

let pool = null;
let override = null;            // test hook (pg-mem)
export function _setPoolForTest(p) { override = p; }

export function getPool() {
  if (override) return override;
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: sslOption(config.databaseUrl), max: 10 });
    pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

// Create tables and indexes if they do not exist. Idempotent — safe to run on
// every boot. Ids are generated in the app (crypto.randomUUID), so no pgcrypto.
export async function ensureSchema() {
  if (!pgEnabled) return;
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'new',
      assigned_to UUID,
      appointment_at TIMESTAMPTZ,
      notes TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      treatment TEXT,
      message TEXT,
      source TEXT,
      consent BOOLEAN DEFAULT false,
      ip TEXT,
      user_agent TEXT
    );
  `);
  // Booking fields, added to the leads table so a booking is just a lead with a
  // requested slot. Idempotent — safe on every boot, including upgrades.
  await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS age INTEGER;`);
  await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS pre_medical TEXT;`);
  await query(`
    CREATE TABLE IF NOT EXISTS activity (
      id UUID PRIMARY KEY,
      lead_id UUID NOT NULL,
      type TEXT NOT NULL,
      message TEXT,
      actor_id UUID,
      actor_name TEXT,
      meta JSONB NOT NULL DEFAULT '{}',
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL,
      lead_id UUID,
      lead_name TEXT,
      assigned_to UUID,
      due_at TIMESTAMPTZ,
      done BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      created_by UUID,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      cover_image TEXT,
      seo_title TEXT,
      meta_description TEXT,
      related JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      author_id UUID,
      author_name TEXT,
      author_role TEXT,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Uploaded blog images live in the database so they survive redeploys — the
  // container filesystem on Railway is ephemeral and wiped on every deploy.
  await query(`
    CREATE TABLE IF NOT EXISTS uploads (
      name TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      size INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // First-party, cookieless page-view analytics. One row per page view. No IP,
  // no user-agent, no cookie: just a client session id (sessionStorage), the
  // path, the referring host, the first-touch campaign and a coarse device
  // class. `is_entry` marks a session's landing page.
  await query(`
    CREATE TABLE IF NOT EXISTS visits (
      id UUID PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      ref_host TEXT,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      content TEXT,
      device TEXT,
      is_entry BOOLEAN NOT NULL DEFAULT false
    );
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_visits_at ON visits(at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_visits_session ON visits(session_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);');
  await query('CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);');
  await query('CREATE INDEX IF NOT EXISTS idx_leads_received ON leads(received_at DESC);');
  await query('CREATE INDEX IF NOT EXISTS idx_activity_lead ON activity(lead_id);');
  await query('CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);');
  await query('CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);');
  console.log('[pg] schema ready');
}

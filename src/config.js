import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

// Only accept a real connection string. An unresolved Railway reference
// ("${{Postgres.DATABASE_URL}}") or a stray value must not put us into DB mode.
function pgUrl(v) {
  const s = (v || '').trim();
  if (!s) return '';
  if (!/^postgres(ql)?:\/\//i.test(s)) {
    console.warn('[config] DATABASE_URL is not a postgres:// URL (unresolved template or placeholder?) — using the JSON store.');
    return '';
  }
  return s;
}

const origins = list(process.env.ALLOWED_ORIGINS);

let jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET not set — using a random secret. Dashboard logins will not survive a restart. Set JWT_SECRET in .env.');
}

export const config = {
  port: Number(process.env.PORT || 4000),
  env: process.env.NODE_ENV || 'development',

  // Browser origins allowed to call the API (the Astro site + the dashboard).
  allowedOrigins: origins.length ? origins : ['http://localhost:4321', 'http://localhost:4322'],

  // Canonical site — validates the post-submit `_next` redirect (no open
  // redirect) and is the thank-you fallback.
  siteUrl: process.env.SITE_URL || 'http://localhost:4321',
  thankYouPath: process.env.THANK_YOU_PATH || '/thank-you/',

  // Lead records live here (JSON) when no database is configured. Kept out of
  // git. Used only in the fallback file store.
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, '..', 'data'),

  // When set to a real postgres:// URL, all storage uses Postgres instead of the
  // JSON files. Railway injects it when you reference the Postgres service. An
  // unresolved template like "${{Postgres.DATABASE_URL}}" (common in a local
  // .env) or any non-postgres value is ignored so the app still boots on the
  // JSON store instead of crashing. PGSSL forces TLS on/off; else inferred.
  databaseUrl: pgUrl(process.env.DATABASE_URL),
  pgSsl: process.env.PGSSL || '',

  // Optional: forward each new lead to a webhook (Slack / Zapier / CRM inbox).
  webhookUrl: process.env.WEBHOOK_URL || '',

  // Mirror each new lead to an external CRM lead intake (in addition to our own
  // store). Base endpoint only — `type` and `center` are appended as query
  // params below. Set CRM_FORWARD_URL to an empty string to disable.
  crmForwardUrl: process.env.CRM_FORWARD_URL
    ?? 'https://miraculous-serenity-production-5d5a.up.railway.app/api/leads',
  crmForwardType: process.env.CRM_FORWARD_TYPE ?? 'call',
  crmForwardCenter: process.env.CRM_FORWARD_CENTER ?? 'TBF',

  // Optional legacy read key for GET /api/leads (scripts). The dashboard uses
  // the authenticated /api/admin routes instead.
  apiKey: process.env.API_KEY || '',

  // ── Dashboard auth ──
  // Single admin login from env for now; move to a users table with Postgres.
  jwtSecret,
  tokenTtl: process.env.TOKEN_TTL || '12h',
  adminEmail: (process.env.ADMIN_EMAIL || '').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',

  rateLimit: {
    windowMs: Number(process.env.RATE_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.RATE_MAX || 20),
  },
};

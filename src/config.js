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

  // ── Email (booking confirmations) ──
  // SMTP via the clinic mailbox (e.g. Hostinger). All of host/user/pass/from
  // must be set for email to send; otherwise confirmations are skipped and the
  // booking is still saved and visible in the dashboard. SMTP_SECURE=true for
  // port 465 (implicit TLS); leave false for 587 (STARTTLS).
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim(),
    // Optional: also send the clinic a copy of each new booking.
    bookingsInbox: (process.env.BOOKINGS_INBOX || '').trim(),
  },
  // Reception / front-desk inbox notified of every new enquiry and booking.
  receptionEmail: (process.env.RECEPTION_EMAIL || '').trim(),
  // Where the staff-notification email links to open the record (the dashboard).
  // Falls back to SITE_URL + /admin/. Set ADMIN_URL in prod if the admin lives
  // on a different host than SITE_URL.
  adminUrl: (process.env.ADMIN_URL || '').trim(),
  // Used to show appointment times to the customer in the clinic's local time.
  clinicTz: process.env.CLINIC_TZ || 'Asia/Manila',

  // Bookable slots. Appointments run in fixed slots between OPEN and CLOSE
  // (clinic-local time). SLOT_CAPACITY is how many bookings each slot can take —
  // set it to your real per-slot capacity (rooms × staff). The booking form
  // shows the true number of slots left and will not let a full slot be booked.
  slotCapacity: Math.max(1, Number(process.env.SLOT_CAPACITY || 2)),
  slotMinutes: Math.max(5, Number(process.env.SLOT_MINUTES || 45)),
  bookingOpen: (process.env.BOOKING_OPEN || '10:00').trim(),   // 10:00 AM
  bookingClose: (process.env.BOOKING_CLOSE || '18:00').trim(), // 6:00 PM
  // Shown in the confirmation email so clients can reach the clinic.
  clinicName: process.env.CLINIC_NAME || 'The Better Face',
  clinicPhone: process.env.CLINIC_PHONE || '',
};

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { leadsRouter } from './routes/leads.js';
import { bookingsRouter } from './routes/bookings.js';
import { getAvailability } from './lib/slots.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { usersRouter } from './routes/users.js';
import { tasksRouter } from './routes/tasks.js';
import { postsPublicRouter, blogAdminRouter } from './routes/blog.js';
import { uploadsRouter, uploadsDir } from './routes/uploads.js';
import { trackRouter } from './routes/track.js';
import { getMedia } from './lib/media.js';

export function createApp() {
  const app = express();

  // Correct client IP when running behind a reverse proxy (nginx, Cloudflare).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({
    // A missing Origin (curl, top-level form navigation) is allowed. Cross-origin
    // AJAX — the dashboard — is allowed only from the configured site origins.
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) =>
    res.json({ ok: true, service: 'tbf-api', env: config.env, time: new Date().toISOString() }));

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'too_many_requests' },
  });
  app.use('/api/leads', limiter, leadsRouter);

  // Public slot availability for the booking form — read-only, registered before
  // the booking limiter so browsing dates is never rate-limited.
  app.get('/api/bookings/availability', async (req, res, next) => {
    try {
      const data = await getAvailability(String(req.query.date || ''));
      res.set('Cache-Control', 'no-store'); // availability is live — never cache it
      res.json({ ok: true, ...data });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ ok: false, error: 'bad_date' });
      next(err);
    }
  });
  app.use('/api/bookings', limiter, bookingsRouter);

  // First-party, cookieless page-view beacon (powers the dashboard Visitors
  // view). Its own generous limiter — a real visitor never approaches 120 hits a
  // minute — blocks floods without throttling normal browsing. express.text
  // parses the sendBeacon text/plain body (a JSON-content fallback is caught by
  // the global express.json above and arrives already parsed).
  const trackLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'too_many_requests' },
  });
  app.use('/api/track', trackLimiter, express.text({ type: () => true, limit: '2kb' }), trackRouter);

  // Blog: public reads for the website, authenticated writes for the editor.
  // The admin mounts must precede /api/admin so their role gates apply.
  app.use('/api/posts', postsPublicRouter);
  app.use('/api/admin/posts', blogAdminRouter);
  app.use('/api/admin/uploads', uploadsRouter);

  // Images uploaded through the editor. Names carry a random suffix, so long
  // immutable caching is safe; the CORP header overrides helmet's same-origin
  // default so the website (a different origin) can embed them. Served from
  // Postgres (persists across redeploys); anything not in the DB falls through
  // to the static disk below (local dev, or legacy files).
  app.get('/uploads/:name', async (req, res, next) => {
    try {
      const m = await getMedia(req.params.name);
      if (!m) return next();
      res.setHeader('Content-Type', m.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.send(m.bytes);
    } catch (err) { next(err); }
  });
  app.use('/uploads', express.static(uploadsDir, {
    index: false,
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  }));

  // Dashboard: login + authenticated lead management.
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/tasks', tasksRouter);

  app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ ok: false, error: 'server_error' });
  });

  return app;
}

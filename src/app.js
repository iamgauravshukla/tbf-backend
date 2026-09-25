import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { leadsRouter } from './routes/leads.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { usersRouter } from './routes/users.js';
import { tasksRouter } from './routes/tasks.js';

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

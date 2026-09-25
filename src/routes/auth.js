import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { authenticate, signToken, requireAuth } from '../lib/auth.js';
import { findById, findByEmail, verifyPassword, updateUser, publicUser } from '../lib/users.js';

export const authRouter = Router();

// Brute-force guard on login, tighter than the general limiter.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too_many_attempts' },
});

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!config.adminEmail || !config.adminPassword) {
      return res.status(503).json({ ok: false, error: 'auth_not_configured' });
    }
    const user = await authenticate(email, password);
    if (!user) return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    const token = signToken(user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await findById(req.user.id);
    res.json({ ok: true, user: user ? publicUser(user) : req.user });
  } catch (err) {
    next(err);
  }
});

// Change your own password (needs the current one).
authRouter.post('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = await findByEmail(req.user.email);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ ok: false, error: 'password_too_short' });
    }
    await updateUser(user.id, { password: newPassword });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

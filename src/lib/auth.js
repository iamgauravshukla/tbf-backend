import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { findByEmail, verifyPassword, seedAdminIfEmpty } from './users.js';

// Auth against the users collection. On first use the env admin is seeded as a
// real account (see users.js), so there is always a way in.

export async function authenticate(email, password) {
  await seedAdminIfEmpty();
  const user = await findByEmail(email);
  if (!user || !user.active) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: config.tokenTtl },
  );
}

// Attaches req.user = { id, email, name, role }.
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    req.user = { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

// Route guard: requireRole('admin', 'manager'). Use after requireAuth.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    next();
  };
}

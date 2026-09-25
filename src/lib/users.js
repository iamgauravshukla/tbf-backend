import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { pgEnabled, query } from './pg.js';
import { config } from '../config.js';

// Team accounts. Postgres when DATABASE_URL is set, else JSON. Passwords are
// hashed with scrypt (built into Node — no native dependency).

export const ROLES = ['admin', 'manager', 'agent'];
const USERS = 'users';

// ── password hashing (shared) ──
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !String(stored).startsWith('scrypt$')) return false;
  const [, salt, hash] = String(stored).split('$');
  const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

const norm = (e) => String(e || '').trim().toLowerCase();
const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : new Date(v).toISOString()));
const rowToUser = (r) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, active: r.active,
  passwordHash: r.password_hash, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

function validateNew({ name, email, role, password }, list) {
  const e = norm(email);
  if (!name || String(name).trim().length < 2) throw Object.assign(new Error('name'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw Object.assign(new Error('email'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('role'), { status: 400 });
  if (!password || String(password).length < 8) throw Object.assign(new Error('password_too_short'), { status: 400 });
  if (list && list.some((u) => u.email === e)) throw Object.assign(new Error('email_taken'), { status: 409 });
  return e;
}

export async function seedAdminIfEmpty() {
  if (!config.adminEmail || !config.adminPassword) return;
  const now = new Date().toISOString();
  const admin = {
    id: crypto.randomUUID(), name: 'Admin', email: norm(config.adminEmail), role: 'admin',
    active: true, passwordHash: hashPassword(config.adminPassword), createdAt: now, updatedAt: now,
  };
  if (pgEnabled) {
    const c = await query('SELECT COUNT(*)::int AS n FROM users');
    if (c.rows[0].n > 0) return;
    await query(
      `INSERT INTO users (id,name,email,role,active,password_hash,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (email) DO NOTHING`,
      [admin.id, admin.name, admin.email, admin.role, admin.active, admin.passwordHash, admin.createdAt, admin.updatedAt]);
    console.log('[users] seeded initial admin from env:', admin.email);
    return;
  }
  const list = await read(USERS);
  if (list.length) return;
  list.push(admin);
  await persist(USERS);
  console.log('[users] seeded initial admin from env:', admin.email);
}

export async function findByEmail(email) {
  if (pgEnabled) {
    const r = await query('SELECT * FROM users WHERE email = $1', [norm(email)]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  const list = await read(USERS);
  return list.find((u) => u.email === norm(email)) || null;
}

export async function findById(id) {
  if (pgEnabled) {
    const r = await query('SELECT * FROM users WHERE id = $1', [id]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }
  const list = await read(USERS);
  return list.find((u) => u.id === id) || null;
}

export async function listUsers() {
  if (pgEnabled) {
    const r = await query('SELECT * FROM users ORDER BY created_at ASC');
    return r.rows.map((row) => publicUser(rowToUser(row)));
  }
  const list = await read(USERS);
  return list.map(publicUser);
}

export async function listAgents() {
  if (pgEnabled) {
    const r = await query('SELECT id, name, role FROM users WHERE active = true ORDER BY name ASC');
    return r.rows.map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }
  const list = await read(USERS);
  return list.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

export async function createUser({ name, email, role, password }) {
  if (pgEnabled) {
    const e = validateNew({ name, email, role, password });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      await query(
        `INSERT INTO users (id,name,email,role,active,password_hash,created_at,updated_at)
         VALUES ($1,$2,$3,$4,true,$5,$6,$6)`,
        [id, String(name).trim(), e, role, hashPassword(password), now]);
    } catch (err) {
      if (err.code === '23505') throw Object.assign(new Error('email_taken'), { status: 409 });
      throw err;
    }
    return { id, name: String(name).trim(), email: e, role, active: true, createdAt: now, updatedAt: now };
  }
  const list = await read(USERS);
  const e = validateNew({ name, email, role, password }, list);
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(), name: String(name).trim(), email: e, role, active: true,
    passwordHash: hashPassword(password), createdAt: now, updatedAt: now,
  };
  list.push(user);
  await persist(USERS);
  return publicUser(user);
}

export async function updateUser(id, patch = {}) {
  if (patch.role !== undefined && !ROLES.includes(patch.role)) throw Object.assign(new Error('role'), { status: 400 });
  if (patch.password !== undefined && String(patch.password).length < 8) throw Object.assign(new Error('password_too_short'), { status: 400 });

  if (pgEnabled) {
    const sets = [];
    const params = [];
    if (patch.name !== undefined) { params.push(String(patch.name).trim()); sets.push(`name = $${params.length}`); }
    if (patch.role !== undefined) { params.push(patch.role); sets.push(`role = $${params.length}`); }
    if (patch.active !== undefined) { params.push(Boolean(patch.active)); sets.push(`active = $${params.length}`); }
    if (patch.password !== undefined) { params.push(hashPassword(patch.password)); sets.push(`password_hash = $${params.length}`); }
    sets.push('updated_at = now()');
    params.push(id);
    const r = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return r.rows[0] ? publicUser(rowToUser(r.rows[0])) : null;
  }

  const list = await read(USERS);
  const user = list.find((u) => u.id === id);
  if (!user) return null;
  if (patch.name !== undefined) user.name = String(patch.name).trim();
  if (patch.role !== undefined) user.role = patch.role;
  if (patch.active !== undefined) user.active = Boolean(patch.active);
  if (patch.password !== undefined) user.passwordHash = hashPassword(patch.password);
  user.updatedAt = new Date().toISOString();
  await persist(USERS);
  return publicUser(user);
}

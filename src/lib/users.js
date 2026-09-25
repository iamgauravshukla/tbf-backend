import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { config } from '../config.js';

// Team accounts for the dashboard. Passwords are hashed with scrypt (built into
// Node — no native dependency). Swap this module for a Postgres `users` table
// later; the auth middleware and routes stay the same.

export const ROLES = ['admin', 'manager', 'agent'];
const USERS = 'users';

// ── password hashing ──
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

// Strip the hash before a user ever leaves the API.
export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

const norm = (e) => String(e || '').trim().toLowerCase();

// Seed the env admin as a real account the first time, so there is always a way
// in. After seeding, the stored hash is the source of truth — changing
// ADMIN_PASSWORD in .env does not change an existing account.
export async function seedAdminIfEmpty() {
  const list = await read(USERS);
  if (list.length) return;
  if (!config.adminEmail || !config.adminPassword) return;
  list.push({
    id: crypto.randomUUID(),
    name: 'Admin',
    email: norm(config.adminEmail),
    role: 'admin',
    active: true,
    passwordHash: hashPassword(config.adminPassword),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await persist(USERS);
  console.log('[users] seeded initial admin from env:', norm(config.adminEmail));
}

export async function findByEmail(email) {
  const list = await read(USERS);
  return list.find((u) => u.email === norm(email)) || null;
}

export async function findById(id) {
  const list = await read(USERS);
  return list.find((u) => u.id === id) || null;
}

export async function listUsers() {
  const list = await read(USERS);
  return list.map(publicUser);
}

// A lightweight directory the UI uses to render owner/assignee dropdowns.
export async function listAgents() {
  const list = await read(USERS);
  return list.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

export async function createUser({ name, email, role, password }) {
  const list = await read(USERS);
  const e = norm(email);
  if (!name || String(name).trim().length < 2) throw Object.assign(new Error('name'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw Object.assign(new Error('email'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('role'), { status: 400 });
  if (!password || String(password).length < 8) throw Object.assign(new Error('password_too_short'), { status: 400 });
  if (list.some((u) => u.email === e)) throw Object.assign(new Error('email_taken'), { status: 409 });

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: e,
    role,
    active: true,
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };
  list.push(user);
  await persist(USERS);
  return publicUser(user);
}

export async function updateUser(id, patch = {}) {
  const list = await read(USERS);
  const user = list.find((u) => u.id === id);
  if (!user) return null;

  if (patch.name !== undefined) user.name = String(patch.name).trim();
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) throw Object.assign(new Error('role'), { status: 400 });
    user.role = patch.role;
  }
  if (patch.active !== undefined) user.active = Boolean(patch.active);
  if (patch.password !== undefined) {
    if (String(patch.password).length < 8) throw Object.assign(new Error('password_too_short'), { status: 400 });
    user.passwordHash = hashPassword(patch.password);
  }
  user.updatedAt = new Date().toISOString();
  await persist(USERS);
  return publicUser(user);
}

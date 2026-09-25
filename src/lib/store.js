import crypto from 'node:crypto';
import { read, persist } from './db.js';

// Leads collection. Create/read/update/filter/stats over the `leads` collection.
// Storage lives in db.js; swap that for Postgres and the routes never change.

export const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled', 'lost'];

const LEADS = 'leads';

// An agent only sees their own leads plus the unassigned queue; managers and
// admins see everything. Returns a predicate over a lead.
export function visibleTo(viewer) {
  if (!viewer || viewer.role === 'admin' || viewer.role === 'manager') return () => true;
  return (l) => l.assignedTo === viewer.id || !l.assignedTo;
}

export async function createLead(data, meta = {}) {
  const list = await read(LEADS);
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    receivedAt: now,
    updatedAt: now,
    status: 'new',
    assignedTo: null,
    appointmentAt: null,
    notes: '',
    ...data,
    ...meta,
  };
  list.unshift(record);
  await persist(LEADS);
  return record;
}

export async function getLead(id) {
  const list = await read(LEADS);
  return list.find((l) => l.id === id) || null;
}

export async function updateLead(id, patch = {}) {
  const list = await read(LEADS);
  const lead = list.find((l) => l.id === id);
  if (!lead) return null;

  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) {
      throw Object.assign(new Error('invalid_status'), { status: 400 });
    }
    lead.status = patch.status;
  }
  if (patch.assignedTo !== undefined) {
    lead.assignedTo = patch.assignedTo || null;
  }
  if (patch.notes !== undefined) lead.notes = String(patch.notes).slice(0, 4000);
  if (patch.appointmentAt !== undefined) {
    lead.appointmentAt = patch.appointmentAt ? new Date(patch.appointmentAt).toISOString() : null;
  }
  lead.updatedAt = new Date().toISOString();
  await persist(LEADS);
  return lead;
}

export async function listLeads(opts = {}) {
  const { status, q, from, to, treatment, source, assignedTo, viewer, limit = 50, offset = 0 } = opts;
  const list = await read(LEADS);
  let out = list.filter(visibleTo(viewer));

  if (status) out = out.filter((l) => l.status === status);
  if (treatment) out = out.filter((l) => l.treatment === treatment);
  if (source) out = out.filter((l) => l.source === source);
  if (assignedTo === 'none') out = out.filter((l) => !l.assignedTo);
  else if (assignedTo) out = out.filter((l) => l.assignedTo === assignedTo);
  if (from) {
    const t = new Date(from).getTime();
    if (!Number.isNaN(t)) out = out.filter((l) => new Date(l.receivedAt).getTime() >= t);
  }
  if (to) {
    const t = new Date(to).getTime();
    if (!Number.isNaN(t)) out = out.filter((l) => new Date(l.receivedAt).getTime() < t + 86400000);
  }
  if (q) {
    const s = String(q).toLowerCase();
    out = out.filter((l) =>
      [l.name, l.email, l.phone, l.treatment, l.message, l.notes, l.source]
        .some((f) => (f || '').toLowerCase().includes(s)));
  }

  const total = out.length;
  const leads = out.slice(offset, offset + limit);
  return { total, leads };
}

export async function stats(viewer) {
  const all = await read(LEADS);
  const list = all.filter(visibleTo(viewer));
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86400000;

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let today = 0;
  let week = 0;
  let unassigned = 0;
  for (const l of list) {
    if (byStatus[l.status] !== undefined) byStatus[l.status] += 1;
    if (!l.assignedTo) unassigned += 1;
    const t = new Date(l.receivedAt).getTime();
    if (t >= midnight.getTime()) today += 1;
    if (t >= weekAgo) week += 1;
  }
  return { total: list.length, today, week, unassigned, byStatus };
}

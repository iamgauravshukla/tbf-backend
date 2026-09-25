import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { pgEnabled, query } from './pg.js';

// Leads: create/read/update/filter/stats. Uses Postgres when DATABASE_URL is
// set, otherwise the JSON file store. The routes only ever call these functions.

export const STATUSES = ['new', 'contacted', 'booked', 'completed', 'cancelled', 'lost'];

const LEADS = 'leads';

// An agent only sees their own leads plus the unassigned queue; managers and
// admins see everything. Used by routes for per-lead access checks (JSON path).
export function visibleTo(viewer) {
  if (!viewer || viewer.role === 'admin' || viewer.role === 'manager') return () => true;
  return (l) => l.assignedTo === viewer.id || !l.assignedTo;
}

// ── Postgres helpers ──
const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : new Date(v).toISOString()));
const rowToLead = (r) => ({
  id: r.id,
  receivedAt: iso(r.received_at),
  updatedAt: iso(r.updated_at),
  status: r.status,
  assignedTo: r.assigned_to,
  appointmentAt: iso(r.appointment_at),
  notes: r.notes || '',
  name: r.name,
  email: r.email,
  phone: r.phone,
  treatment: r.treatment,
  message: r.message,
  source: r.source,
  consent: r.consent,
  ip: r.ip,
  userAgent: r.user_agent,
});
// Restrict the query to what the viewer may see (agents: own + unassigned).
function visClause(viewer, params) {
  if (!viewer || viewer.role === 'admin' || viewer.role === 'manager') return '';
  params.push(viewer.id);
  return `(assigned_to = $${params.length} OR assigned_to IS NULL)`;
}

export async function createLead(data, meta = {}) {
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
  if (pgEnabled) {
    await query(
      `INSERT INTO leads (id, received_at, updated_at, status, assigned_to, appointment_at, notes,
        name, email, phone, treatment, message, source, consent, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [record.id, record.receivedAt, record.updatedAt, record.status, record.assignedTo, record.appointmentAt,
        record.notes, record.name, record.email ?? null, record.phone ?? null, record.treatment ?? null,
        record.message ?? null, record.source ?? null, record.consent ?? false, record.ip ?? null, record.userAgent ?? null],
    );
    return record;
  }
  const list = await read(LEADS);
  list.unshift(record);
  await persist(LEADS);
  return record;
}

export async function getLead(id) {
  if (pgEnabled) {
    const r = await query('SELECT * FROM leads WHERE id = $1', [id]);
    return r.rows[0] ? rowToLead(r.rows[0]) : null;
  }
  const list = await read(LEADS);
  return list.find((l) => l.id === id) || null;
}

export async function updateLead(id, patch = {}) {
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw Object.assign(new Error('invalid_status'), { status: 400 });
  }
  if (pgEnabled) {
    const sets = [];
    const params = [];
    if (patch.status !== undefined) { params.push(patch.status); sets.push(`status = $${params.length}`); }
    if (patch.assignedTo !== undefined) { params.push(patch.assignedTo || null); sets.push(`assigned_to = $${params.length}`); }
    if (patch.notes !== undefined) { params.push(String(patch.notes).slice(0, 4000)); sets.push(`notes = $${params.length}`); }
    if (patch.appointmentAt !== undefined) {
      params.push(patch.appointmentAt ? new Date(patch.appointmentAt).toISOString() : null);
      sets.push(`appointment_at = $${params.length}`);
    }
    sets.push('updated_at = now()');
    params.push(id);
    const r = await query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return r.rows[0] ? rowToLead(r.rows[0]) : null;
  }
  const list = await read(LEADS);
  const lead = list.find((l) => l.id === id);
  if (!lead) return null;
  if (patch.status !== undefined) lead.status = patch.status;
  if (patch.assignedTo !== undefined) lead.assignedTo = patch.assignedTo || null;
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

  if (pgEnabled) {
    const params = [];
    const clauses = [];
    const vis = visClause(viewer, params);
    if (vis) clauses.push(vis);
    if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
    if (treatment) { params.push(treatment); clauses.push(`treatment = $${params.length}`); }
    if (source) { params.push(source); clauses.push(`source = $${params.length}`); }
    if (assignedTo === 'none') clauses.push('assigned_to IS NULL');
    else if (assignedTo) { params.push(assignedTo); clauses.push(`assigned_to = $${params.length}`); }
    if (from) { const t = new Date(from); if (!Number.isNaN(+t)) { params.push(t.toISOString()); clauses.push(`received_at >= $${params.length}`); } }
    if (to) { const t = new Date(to); if (!Number.isNaN(+t)) { params.push(new Date(+t + 86400000).toISOString()); clauses.push(`received_at < $${params.length}`); } }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      clauses.push(`(name ILIKE ${p} OR email ILIKE ${p} OR phone ILIKE ${p} OR treatment ILIKE ${p} OR message ILIKE ${p} OR notes ILIKE ${p} OR source ILIKE ${p})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const totalRes = await query(`SELECT COUNT(*)::int AS total FROM leads ${where}`, params);
    const total = totalRes.rows[0].total;
    params.push(limit); const lp = params.length;
    params.push(offset); const op = params.length;
    const rows = await query(`SELECT * FROM leads ${where} ORDER BY received_at DESC LIMIT $${lp} OFFSET $${op}`, params);
    return { total, leads: rows.rows.map(rowToLead) };
  }

  const list = await read(LEADS);
  let out = list.filter(visibleTo(viewer));
  if (status) out = out.filter((l) => l.status === status);
  if (treatment) out = out.filter((l) => l.treatment === treatment);
  if (source) out = out.filter((l) => l.source === source);
  if (assignedTo === 'none') out = out.filter((l) => !l.assignedTo);
  else if (assignedTo) out = out.filter((l) => l.assignedTo === assignedTo);
  if (from) { const t = new Date(from).getTime(); if (!Number.isNaN(t)) out = out.filter((l) => new Date(l.receivedAt).getTime() >= t); }
  if (to) { const t = new Date(to).getTime(); if (!Number.isNaN(t)) out = out.filter((l) => new Date(l.receivedAt).getTime() < t + 86400000); }
  if (q) {
    const s = String(q).toLowerCase();
    out = out.filter((l) => [l.name, l.email, l.phone, l.treatment, l.message, l.notes, l.source].some((f) => (f || '').toLowerCase().includes(s)));
  }
  const total = out.length;
  return { total, leads: out.slice(offset, offset + limit) };
}

export async function stats(viewer) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const midIso = midnight.toISOString();
  const weekIso = new Date(Date.now() - 7 * 86400000).toISOString();

  if (pgEnabled) {
    const params = [];
    const vis = visClause(viewer, params);
    const where = vis ? `WHERE ${vis}` : '';
    params.push(midIso); const mp = params.length;
    params.push(weekIso); const wp = params.length;
    const agg = await query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(CASE WHEN received_at >= $${mp} THEN 1 ELSE 0 END),0)::int AS today,
              COALESCE(SUM(CASE WHEN received_at >= $${wp} THEN 1 ELSE 0 END),0)::int AS week,
              COALESCE(SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END),0)::int AS unassigned
       FROM leads ${where}`, params);
    const byRes = await query(`SELECT status, COUNT(*)::int AS c FROM leads ${where} GROUP BY status`, params.slice(0, vis ? 1 : 0));
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of byRes.rows) if (byStatus[row.status] !== undefined) byStatus[row.status] = row.c;
    const a = agg.rows[0];
    return { total: a.total, today: a.today, week: a.week, unassigned: a.unassigned, byStatus };
  }

  const all = await read(LEADS);
  const list = all.filter(visibleTo(viewer));
  const weekAgo = Date.now() - 7 * 86400000;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let today = 0, week = 0, unassigned = 0;
  for (const l of list) {
    if (byStatus[l.status] !== undefined) byStatus[l.status] += 1;
    if (!l.assignedTo) unassigned += 1;
    const t = new Date(l.receivedAt).getTime();
    if (t >= midnight.getTime()) today += 1;
    if (t >= weekAgo) week += 1;
  }
  return { total: list.length, today, week, unassigned, byStatus };
}

import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { pgEnabled, query } from './pg.js';

// A per-lead timeline: status changes, assignments, notes, logged calls/messages.
// Append-only. Postgres when DATABASE_URL is set, else JSON.

const ACTIVITY = 'activity';

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : new Date(v).toISOString()));
const rowToEntry = (r) => ({
  id: r.id, leadId: r.lead_id, type: r.type, message: r.message,
  actorId: r.actor_id, actorName: r.actor_name,
  meta: typeof r.meta === 'string' ? JSON.parse(r.meta) : (r.meta || {}),
  at: iso(r.at),
});

// type: 'created' | 'status' | 'assigned' | 'note' | 'call' | 'message' | 'appointment' | 'task'
export async function logActivity({ leadId, type, message, actor = null, meta = {} }) {
  const entry = {
    id: crypto.randomUUID(),
    leadId,
    type,
    message: String(message || '').slice(0, 2000),
    actorId: actor?.id || null,
    actorName: actor?.name || (actor ? actor.email : 'System'),
    meta,
    at: new Date().toISOString(),
  };
  if (pgEnabled) {
    await query(
      `INSERT INTO activity (id, lead_id, type, message, actor_id, actor_name, meta, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [entry.id, entry.leadId, entry.type, entry.message, entry.actorId, entry.actorName, JSON.stringify(entry.meta || {}), entry.at]);
    return entry;
  }
  const list = await read(ACTIVITY);
  list.push(entry);
  await persist(ACTIVITY);
  return entry;
}

// Newest first.
export async function listActivity(leadId) {
  if (pgEnabled) {
    const r = await query('SELECT * FROM activity WHERE lead_id = $1 ORDER BY at DESC', [leadId]);
    return r.rows.map(rowToEntry);
  }
  const list = await read(ACTIVITY);
  return list.filter((a) => a.leadId === leadId).sort((a, b) => new Date(b.at) - new Date(a.at));
}

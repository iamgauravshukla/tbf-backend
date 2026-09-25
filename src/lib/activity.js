import crypto from 'node:crypto';
import { read, persist } from './db.js';

// A per-lead timeline: status changes, assignments, notes, logged calls/messages.
// Append-only. Each entry records who did it (actor) and when.

const ACTIVITY = 'activity';

// type: 'created' | 'status' | 'assigned' | 'note' | 'call' | 'message' | 'appointment' | 'task'
export async function logActivity({ leadId, type, message, actor = null, meta = {} }) {
  const list = await read(ACTIVITY);
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
  list.push(entry);
  await persist(ACTIVITY);
  return entry;
}

// Newest first.
export async function listActivity(leadId) {
  const list = await read(ACTIVITY);
  return list
    .filter((a) => a.leadId === leadId)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { pgEnabled, query } from './pg.js';

// Follow-up tasks: "call back Thursday 2pm". Postgres when DATABASE_URL is set,
// else JSON.

const TASKS = 'tasks';

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : new Date(v).toISOString()));
const rowToTask = (r) => ({
  id: r.id, title: r.title, leadId: r.lead_id, leadName: r.lead_name || '',
  assignedTo: r.assigned_to, dueAt: iso(r.due_at), done: r.done,
  completedAt: iso(r.completed_at), createdBy: r.created_by, createdByName: r.created_by_name || '',
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});

export async function createTask({ title, leadId = null, leadName = '', assignedTo = null, dueAt = null }, actor = null) {
  if (!title || String(title).trim().length < 2) throw Object.assign(new Error('title'), { status: 400 });
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    title: String(title).trim().slice(0, 300),
    leadId, leadName, assignedTo,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    done: false, completedAt: null,
    createdBy: actor?.id || null, createdByName: actor?.name || '',
    createdAt: now, updatedAt: now,
  };
  if (pgEnabled) {
    await query(
      `INSERT INTO tasks (id,title,lead_id,lead_name,assigned_to,due_at,done,completed_at,created_by,created_by_name,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,false,NULL,$7,$8,$9,$9)`,
      [task.id, task.title, task.leadId, task.leadName, task.assignedTo, task.dueAt, task.createdBy, task.createdByName, task.createdAt]);
    return task;
  }
  const list = await read(TASKS);
  list.unshift(task);
  await persist(TASKS);
  return task;
}

export async function updateTask(id, patch = {}) {
  if (pgEnabled) {
    const sets = [];
    const params = [];
    if (patch.title !== undefined) { params.push(String(patch.title).trim().slice(0, 300)); sets.push(`title = $${params.length}`); }
    if (patch.assignedTo !== undefined) { params.push(patch.assignedTo || null); sets.push(`assigned_to = $${params.length}`); }
    if (patch.dueAt !== undefined) { params.push(patch.dueAt ? new Date(patch.dueAt).toISOString() : null); sets.push(`due_at = $${params.length}`); }
    if (patch.done !== undefined) {
      params.push(Boolean(patch.done)); sets.push(`done = $${params.length}`);
      sets.push(`completed_at = ${patch.done ? 'now()' : 'NULL'}`);
    }
    sets.push('updated_at = now()');
    params.push(id);
    const r = await query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return r.rows[0] ? rowToTask(r.rows[0]) : null;
  }
  const list = await read(TASKS);
  const task = list.find((t) => t.id === id);
  if (!task) return null;
  if (patch.title !== undefined) task.title = String(patch.title).trim().slice(0, 300);
  if (patch.assignedTo !== undefined) task.assignedTo = patch.assignedTo || null;
  if (patch.dueAt !== undefined) task.dueAt = patch.dueAt ? new Date(patch.dueAt).toISOString() : null;
  if (patch.done !== undefined) { task.done = Boolean(patch.done); task.completedAt = task.done ? new Date().toISOString() : null; }
  task.updatedAt = new Date().toISOString();
  await persist(TASKS);
  return task;
}

export async function deleteTask(id) {
  if (pgEnabled) {
    const r = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
    return r.rowCount > 0;
  }
  const list = await read(TASKS);
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  await persist(TASKS);
  return true;
}

export async function listTasks(opts = {}) {
  const { assignedTo, leadId, done, scope } = opts;

  if (pgEnabled) {
    const params = [];
    const clauses = [];
    if (leadId) { params.push(leadId); clauses.push(`lead_id = $${params.length}`); }
    if (assignedTo === 'none') clauses.push('assigned_to IS NULL');
    else if (assignedTo) { params.push(assignedTo); clauses.push(`assigned_to = $${params.length}`); }
    if (done === true) clauses.push('done = true');
    else if (done === false) clauses.push('done = false');
    if (scope === 'overdue') { params.push(new Date().toISOString()); clauses.push(`done = false AND due_at < $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const r = await query(`SELECT * FROM tasks ${where} ORDER BY done ASC, due_at ASC NULLS LAST, created_at DESC`, params);
    return r.rows.map(rowToTask);
  }

  const list = await read(TASKS);
  let out = list;
  if (leadId) out = out.filter((t) => t.leadId === leadId);
  if (assignedTo === 'none') out = out.filter((t) => !t.assignedTo);
  else if (assignedTo) out = out.filter((t) => t.assignedTo === assignedTo);
  if (done === true) out = out.filter((t) => t.done);
  else if (done === false) out = out.filter((t) => !t.done);
  if (scope === 'overdue') {
    const now = Date.now();
    out = out.filter((t) => !t.done && t.dueAt && new Date(t.dueAt).getTime() < now);
  }
  return out.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

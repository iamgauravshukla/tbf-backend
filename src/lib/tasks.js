import crypto from 'node:crypto';
import { read, persist } from './db.js';

// Follow-up tasks: "call back Thursday 2pm". Each task is optionally tied to a
// lead, assigned to a user, has a due date, and is open until completed.

const TASKS = 'tasks';

export async function createTask({ title, leadId = null, leadName = '', assignedTo = null, dueAt = null }, actor = null) {
  const list = await read(TASKS);
  if (!title || String(title).trim().length < 2) throw Object.assign(new Error('title'), { status: 400 });
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    title: String(title).trim().slice(0, 300),
    leadId,
    leadName,
    assignedTo,
    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    done: false,
    completedAt: null,
    createdBy: actor?.id || null,
    createdByName: actor?.name || '',
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(task);
  await persist(TASKS);
  return task;
}

export async function updateTask(id, patch = {}) {
  const list = await read(TASKS);
  const task = list.find((t) => t.id === id);
  if (!task) return null;
  if (patch.title !== undefined) task.title = String(patch.title).trim().slice(0, 300);
  if (patch.assignedTo !== undefined) task.assignedTo = patch.assignedTo || null;
  if (patch.dueAt !== undefined) task.dueAt = patch.dueAt ? new Date(patch.dueAt).toISOString() : null;
  if (patch.done !== undefined) {
    task.done = Boolean(patch.done);
    task.completedAt = task.done ? new Date().toISOString() : null;
  }
  task.updatedAt = new Date().toISOString();
  await persist(TASKS);
  return task;
}

export async function deleteTask(id) {
  const list = await read(TASKS);
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  await persist(TASKS);
  return true;
}

export async function listTasks(opts = {}) {
  const { assignedTo, leadId, done, scope } = opts;
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
  // Open tasks first, then by soonest due date (nulls last), then newest.
  return out.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    if (ad !== bd) return ad - bd;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { createTask, updateTask, deleteTask, listTasks } from '../lib/tasks.js';
import { findById } from '../lib/users.js';
import { getLead } from '../lib/store.js';
import { logActivity } from '../lib/activity.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const isManager = (u) => u.role === 'admin' || u.role === 'manager';

// List tasks. Default is "my tasks"; managers/admins can see everyone's.
tasksRouter.get('/', async (req, res, next) => {
  try {
    const { scope, done, leadId, assignedTo } = req.query;
    const opts = {};
    if (leadId) opts.leadId = leadId;
    if (done === 'true') opts.done = true;
    else if (done === 'false') opts.done = false;
    if (scope === 'overdue') opts.scope = 'overdue';

    if (leadId) { /* tasks for one lead — no owner restriction */ }
    else if (scope === 'all' && isManager(req.user)) { /* everyone */ }
    else if (assignedTo && isManager(req.user)) opts.assignedTo = assignedTo;
    else opts.assignedTo = req.user.id;

    res.json({ ok: true, tasks: await listTasks(opts) });
  } catch (err) { next(err); }
});

tasksRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    let assignedTo = body.assignedTo === 'me' ? req.user.id : (body.assignedTo ?? req.user.id);
    if (req.user.role === 'agent' && assignedTo && assignedTo !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    if (assignedTo) {
      const u = await findById(assignedTo);
      if (!u || !u.active) return res.status(400).json({ ok: false, error: 'invalid_assignee' });
    }

    let leadName = '';
    if (body.leadId) {
      const lead = await getLead(body.leadId);
      if (lead) leadName = lead.name;
    }

    const task = await createTask(
      { title: body.title, leadId: body.leadId || null, leadName, assignedTo, dueAt: body.dueAt || null },
      req.user,
    );

    if (task.leadId) {
      const due = task.dueAt ? ` (due ${new Date(task.dueAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })})` : '';
      await logActivity({ leadId: task.leadId, type: 'task', message: `Follow-up: ${task.title}${due}`, actor: req.user });
    }

    res.status(201).json({ ok: true, task });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
});

tasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const tasks = await listTasks({});
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ ok: false, error: 'not_found' });

    const mine = task.assignedTo === req.user.id || task.createdBy === req.user.id;
    if (!isManager(req.user) && !mine) return res.status(403).json({ ok: false, error: 'forbidden' });

    const patch = { ...req.body };
    if (patch.assignedTo === 'me') patch.assignedTo = req.user.id;
    if (patch.assignedTo !== undefined && req.user.role === 'agent' && patch.assignedTo && patch.assignedTo !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const updated = await updateTask(req.params.id, patch);
    res.json({ ok: true, task: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
});

tasksRouter.delete('/:id', async (req, res, next) => {
  try {
    const tasks = await listTasks({});
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!isManager(req.user) && task.createdBy !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    await deleteTask(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

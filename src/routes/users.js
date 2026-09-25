import { Router } from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { listUsers, createUser, updateUser, findById } from '../lib/users.js';

export const usersRouter = Router();

// Managing accounts is for admins and managers. Managers may only touch agents;
// only an admin can create or change an admin/manager.
usersRouter.use(requireAuth, requireRole('admin', 'manager'));

const canActOn = (actor, targetRole) =>
  actor.role === 'admin' || targetRole === 'agent';

usersRouter.get('/', async (req, res, next) => {
  try {
    res.json({ ok: true, users: await listUsers() });
  } catch (err) { next(err); }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const { name, email, role = 'agent', password } = req.body || {};
    if (!canActOn(req.user, role)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const user = await createUser({ name, email, role, password });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
});

usersRouter.patch('/:id', async (req, res, next) => {
  try {
    const target = await findById(req.params.id);
    if (!target) return res.status(404).json({ ok: false, error: 'not_found' });

    // A manager cannot edit admins/managers or promote anyone above agent.
    if (!canActOn(req.user, target.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (req.body.role && !canActOn(req.user, req.body.role)) return res.status(403).json({ ok: false, error: 'forbidden' });

    // Self-protection: don't lock yourself out or demote yourself.
    if (target.id === req.user.id) {
      if (req.body.active === false) return res.status(400).json({ ok: false, error: 'cannot_deactivate_self' });
      if (req.body.role && req.body.role !== req.user.role) return res.status(400).json({ ok: false, error: 'cannot_change_own_role' });
    }

    // Never leave the system without an active admin.
    if (target.role === 'admin' && (req.body.active === false || (req.body.role && req.body.role !== 'admin'))) {
      const users = await listUsers();
      const activeAdmins = users.filter((u) => u.role === 'admin' && u.active);
      if (activeAdmins.length <= 1) return res.status(400).json({ ok: false, error: 'last_admin' });
    }

    const user = await updateUser(req.params.id, req.body || {});
    res.json({ ok: true, user });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    next(err);
  }
});

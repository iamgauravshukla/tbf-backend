import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { listLeads, getLead, updateLead, deleteLeads, stats, visibleTo, STATUSES } from '../lib/store.js';
import { logActivity, listActivity } from '../lib/activity.js';
import { listAgents, findById } from '../lib/users.js';
import { computeAnalytics } from '../lib/analytics.js';
import { computeVisitAnalytics } from '../lib/visits.js';

export const adminRouter = Router();

// Everything under /api/admin requires a valid token.
adminRouter.use(requireAuth);

const fmtWhen = (iso) => {
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

// Dashboard headline numbers, scoped to what the viewer may see.
adminRouter.get('/stats', async (req, res, next) => {
  try {
    const s = await stats(req.user);
    res.json({ ok: true, statuses: STATUSES, ...s });
  } catch (err) { next(err); }
});

// Directory for owner/assignee dropdowns.
adminRouter.get('/agents', async (req, res, next) => {
  try {
    res.json({ ok: true, agents: await listAgents() });
  } catch (err) { next(err); }
});

// Aggregated analytics (funnel, over-time, by source/treatment/owner), scoped to
// the viewer. Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to last 30 days).
adminRouter.get('/analytics', async (req, res, next) => {
  try {
    const data = await computeAnalytics({ viewer: req.user, from: req.query.from, to: req.query.to });
    res.json({ ok: true, ...data });
  } catch (err) { next(err); }
});

// First-party visitor analytics (page views, sessions, bounce rate, sources,
// campaigns, devices). Site-wide traffic is a business metric, so it is limited
// to managers and admins — agents don't see it. Optional ?from&to (last 30 days
// by default).
adminRouter.get('/visits', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const data = await computeVisitAnalytics({ from: req.query.from, to: req.query.to });
    res.json({ ok: true, ...data });
  } catch (err) { next(err); }
});

// Filtered, searchable, paginated lead list.
adminRouter.get('/leads', async (req, res, next) => {
  try {
    const { status, q, from, to, treatment, source } = req.query;
    let assignedTo = req.query.assignedTo;
    if (assignedTo === 'mine') assignedTo = req.user.id;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { total, leads } = await listLeads({
      status, q, from, to, treatment, source, assignedTo, viewer: req.user, limit, offset,
    });
    res.json({ ok: true, total, limit, offset, leads });
  } catch (err) { next(err); }
});

// Bulk delete (admin only) — permanently remove spam / test leads and bookings
// along with their timeline and tasks. Must precede the /leads/:id routes.
adminRouter.post('/leads/delete', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden' });
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = raw.filter((x) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x));
    if (!ids.length) return res.status(400).json({ ok: false, error: 'no_ids' });
    const removed = await deleteLeads(ids);
    res.json({ ok: true, removed });
  } catch (err) { next(err); }
});

adminRouter.get('/leads/:id', async (req, res, next) => {
  try {
    const lead = await getLead(req.params.id);
    if (!lead || !visibleTo(req.user)(lead)) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, lead });
  } catch (err) { next(err); }
});

// The lead's timeline.
adminRouter.get('/leads/:id/activity', async (req, res, next) => {
  try {
    const lead = await getLead(req.params.id);
    if (!lead || !visibleTo(req.user)(lead)) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, activity: await listActivity(req.params.id) });
  } catch (err) { next(err); }
});

// Log a note, a call outcome, or a message against the lead.
adminRouter.post('/leads/:id/activity', async (req, res, next) => {
  try {
    const lead = await getLead(req.params.id);
    if (!lead || !visibleTo(req.user)(lead)) return res.status(404).json({ ok: false, error: 'not_found' });
    const type = ['note', 'call', 'message'].includes(req.body?.type) ? req.body.type : 'note';
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'message' });
    const entry = await logActivity({ leadId: lead.id, type, message, actor: req.user, meta: req.body?.meta || {} });
    res.status(201).json({ ok: true, entry });
  } catch (err) { next(err); }
});

// Update status, assignment, appointment or the notes field. Each change is
// written to the timeline with the actor who made it.
adminRouter.patch('/leads/:id', async (req, res, next) => {
  try {
    const lead = await getLead(req.params.id);
    if (!lead || !visibleTo(req.user)(lead)) return res.status(404).json({ ok: false, error: 'not_found' });
    const patch = req.body || {};

    // Resolve and authorise an assignment change.
    if (patch.assignedTo !== undefined) {
      const assignee = patch.assignedTo === 'me' ? req.user.id : (patch.assignedTo || null);
      if (assignee) {
        const u = await findById(assignee);
        if (!u || !u.active) return res.status(400).json({ ok: false, error: 'invalid_assignee' });
        if (req.user.role === 'agent' && assignee !== req.user.id) return res.status(403).json({ ok: false, error: 'forbidden' });
      } else if (req.user.role === 'agent' && lead.assignedTo && lead.assignedTo !== req.user.id) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
      patch.assignedTo = assignee;
    }

    const before = { status: lead.status, assignedTo: lead.assignedTo, appointmentAt: lead.appointmentAt, notes: lead.notes };
    const updated = await updateLead(req.params.id, patch);

    // Write timeline entries for what actually changed.
    if (patch.status !== undefined && before.status !== updated.status) {
      await logActivity({ leadId: updated.id, type: 'status', message: `Status → ${updated.status}`, actor: req.user });
    }
    if (patch.assignedTo !== undefined && before.assignedTo !== updated.assignedTo) {
      let msg = 'Unassigned';
      if (updated.assignedTo) {
        const u = await findById(updated.assignedTo);
        msg = `Assigned to ${u ? u.name : 'agent'}`;
      }
      await logActivity({ leadId: updated.id, type: 'assigned', message: msg, actor: req.user, meta: { assignedTo: updated.assignedTo } });
    }
    if (patch.appointmentAt !== undefined && before.appointmentAt !== updated.appointmentAt) {
      const msg = updated.appointmentAt ? `Appointment set — ${fmtWhen(updated.appointmentAt)}` : 'Appointment cleared';
      await logActivity({ leadId: updated.id, type: 'appointment', message: msg, actor: req.user });
    }
    if (patch.notes !== undefined && before.notes !== updated.notes) {
      await logActivity({ leadId: updated.id, type: 'note', message: 'Updated the notes field', actor: req.user });
    }

    res.json({ ok: true, lead: updated });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ ok: false, error: err.message });
    next(err);
  }
});

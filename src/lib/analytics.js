import { listLeads, STATUSES } from './store.js';

// Aggregated analytics for the dashboard. Reuses listLeads (so it works on both
// Postgres and the JSON store) and aggregates in JS — fine for clinic volumes.
// Everything is scoped to the viewer (agents see their own + unassigned).

const dayStr = (d) => d.toISOString().slice(0, 10);

function daySeries(from, to, byDay) {
  // Iterate whole days in UTC so the keys match the UTC dates leads are bucketed
  // by (lead.receivedAt.slice(0,10)); mixing local-midnight iteration with UTC
  // keys drops a day in non-UTC server timezones.
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push({ date: k, count: byDay[k] || 0 });
  }
  return out.slice(-183); // safety cap (~6 months of daily buckets)
}

export async function computeAnalytics({ viewer, from, to } = {}) {
  // Default window: last 30 days.
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(Date.now() - 29 * 86400000);
  const fromISO = dayStr(fromDate);
  const toISO = dayStr(toDate);

  const { leads } = await listLeads({ viewer, from: fromISO, to: toISO, limit: 5000, offset: 0 });

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const bySource = {};
  const byTreatment = {};
  const byOwner = {};
  const byDay = {};

  for (const l of leads) {
    if (byStatus[l.status] !== undefined) byStatus[l.status] += 1;
    const src = l.source || 'unknown';
    bySource[src] = (bySource[src] || 0) + 1;
    const tr = l.treatment || '—';
    byTreatment[tr] = (byTreatment[tr] || 0) + 1;
    const day = (l.receivedAt || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;

    const key = l.assignedTo || '__unassigned__';
    byOwner[key] ||= { ownerId: l.assignedTo || null, assigned: 0, contacted: 0, booked: 0, completed: 0 };
    byOwner[key].assigned += 1;
    if (l.status === 'contacted') byOwner[key].contacted += 1;
    if (l.status === 'booked') byOwner[key].booked += 1;
    if (l.status === 'completed') byOwner[key].completed += 1;
  }

  const total = leads.length;
  const contactedPlus = byStatus.contacted + byStatus.booked + byStatus.completed;
  const bookedPlus = byStatus.booked + byStatus.completed;
  const funnel = [
    { stage: 'Received', count: total },
    { stage: 'Contacted', count: contactedPlus },
    { stage: 'Booked', count: bookedPlus },
    { stage: 'Completed', count: byStatus.completed },
  ];

  const topList = (m) => Object.entries(m)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    range: { from: fromISO, to: toISO },
    total,
    byStatus,
    lost: byStatus.cancelled + byStatus.lost,
    booked: byStatus.booked,
    completed: byStatus.completed,
    conversion: total ? Math.round((byStatus.completed / total) * 100) : 0,
    bookingRate: total ? Math.round((bookedPlus / total) * 100) : 0,
    funnel,
    overTime: daySeries(fromDate, toDate, byDay),
    bySource: topList(bySource).slice(0, 8),
    byTreatment: topList(byTreatment).slice(0, 8),
    byOwner: Object.values(byOwner).sort((a, b) => b.assigned - a.assigned),
  };
}

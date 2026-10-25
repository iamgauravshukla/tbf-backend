import crypto from 'node:crypto';
import { read, persist } from './db.js';
import { pgEnabled, query } from './pg.js';

// First-party, cookieless page-view tracking for the dashboard's Visitors view.
// Mirrors store.js: Postgres when DATABASE_URL is set, otherwise the JSON store.
//
// Privacy by design — a visit row carries NO personal data: a client-generated
// session id (sessionStorage, not a cookie), the path, the referring HOST only
// (never the full URL or query string), the first-touch campaign and a coarse
// device class. No IP, no user-agent. "Visitors" = sessions; a "bounce" is a
// single-page-view session (the Plausible/Fathom definition).

const VISITS = 'visits';
const MAX_JSON_ROWS = 50000;        // soft cap so the JSON fallback can't grow forever
const DEVICES = ['mobile', 'tablet', 'desktop'];

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const dayStr = (d) => d.toISOString().slice(0, 10);
const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : new Date(v).toISOString()));

const rowToVisit = (r) => ({
  at: iso(r.at),
  sessionId: r.session_id,
  path: r.path,
  refHost: r.ref_host,
  source: r.source,
  medium: r.medium,
  campaign: r.campaign,
  content: r.content,
  device: r.device,
  isEntry: r.is_entry,
});

// Record one page view. Sanitises and bounds every field; unknown input is
// dropped. Never trusts the client for anything but these coarse, non-PII hints.
export async function recordVisit(input = {}) {
  const rec = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    sessionId: str(input.sid, 40) || crypto.randomUUID(),
    path: (str(input.path, 300) || '/').split('?')[0].split('#')[0],
    refHost: str(input.ref, 120),
    source: str(input.source, 80),
    medium: str(input.medium, 80),
    campaign: str(input.campaign, 120),
    content: str(input.content, 120),
    device: DEVICES.includes(input.device) ? input.device : 'desktop',
    isEntry: Boolean(input.entry),
  };

  if (pgEnabled) {
    await query(
      `INSERT INTO visits (id, at, session_id, path, ref_host, source, medium, campaign, content, device, is_entry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [rec.id, rec.at, rec.sessionId, rec.path, rec.refHost, rec.source, rec.medium,
        rec.campaign, rec.content, rec.device, rec.isEntry],
    );
    return rec;
  }

  const list = await read(VISITS);
  list.unshift(rec);
  if (list.length > MAX_JSON_ROWS) list.length = MAX_JSON_ROWS; // drop oldest
  await persist(VISITS);
  return rec;
}

// Page views within [from, to] (whole days, UTC). Ascending by time so the first
// row of each session is its landing page.
async function listVisitsInRange(fromISO, toISO) {
  const fromT = new Date(fromISO).toISOString();
  const toT = new Date(new Date(toISO).getTime() + 86400000).toISOString(); // `to` inclusive
  if (pgEnabled) {
    const r = await query(
      'SELECT * FROM visits WHERE at >= $1 AND at < $2 ORDER BY at ASC LIMIT 200000',
      [fromT, toT],
    );
    return r.rows.map(rowToVisit);
  }
  const list = await read(VISITS);
  const f = new Date(fromT).getTime();
  const t = new Date(toT).getTime();
  return list
    .filter((v) => { const x = new Date(v.at).getTime(); return x >= f && x < t; })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function daySeries(from, to, byDay) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const out = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    out.push({ date: k, count: byDay[k] || 0 });
  }
  return out.slice(-183);
}

const isBookPath = (p) => /^\/book(\/|$)/.test(p || '');

// Aggregate traffic for the Visitors dashboard: visitors (sessions), page views,
// /book/ views, bounce rate, pages/visit, visitors-over-time, and breakdowns by
// page, landing page, source, campaign and device.
export async function computeVisitAnalytics({ from, to } = {}) {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(Date.now() - 29 * 86400000);
  const fromISO = dayStr(fromDate);
  const toISO = dayStr(toDate);

  const visits = await listVisitsInRange(fromISO, toISO);

  const sessions = new Map();   // sessionId -> session summary (from its landing row)
  const byPath = {};
  let bookViews = 0;

  for (const v of visits) {
    byPath[v.path] = (byPath[v.path] || 0) + 1;
    if (isBookPath(v.path)) bookViews += 1;

    let s = sessions.get(v.sessionId);
    if (!s) {
      // First row seen for this session (ascending time) = the landing page.
      s = {
        pv: 0,
        day: (v.at || '').slice(0, 10),
        entryPath: v.path,
        source: v.source || 'direct',
        campaign: v.campaign || '(none)',
        device: v.device || 'desktop',
      };
      sessions.set(v.sessionId, s);
    }
    s.pv += 1;
  }

  const sessList = [...sessions.values()];
  const visitors = sessList.length;
  const pageviews = visits.length;

  let bounces = 0;
  const byDayVisitors = {};
  const bySource = {};
  const byCampaign = {};
  const byDevice = {};
  const byEntry = {};
  for (const s of sessList) {
    if (s.pv === 1) bounces += 1;
    if (s.day) byDayVisitors[s.day] = (byDayVisitors[s.day] || 0) + 1;
    bySource[s.source] = (bySource[s.source] || 0) + 1;
    byCampaign[s.campaign] = (byCampaign[s.campaign] || 0) + 1;
    byDevice[s.device] = (byDevice[s.device] || 0) + 1;
    byEntry[s.entryPath] = (byEntry[s.entryPath] || 0) + 1;
  }

  const topList = (m) => Object.entries(m)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  return {
    range: { from: fromISO, to: toISO },
    visitors,
    pageviews,
    bookViews,
    bounceRate: visitors ? Math.round((bounces / visitors) * 100) : 0,
    pagesPerVisit: visitors ? Math.round((pageviews / visitors) * 10) / 10 : 0,
    overTime: daySeries(fromDate, toDate, byDayVisitors),
    topPages: topList(byPath).slice(0, 8),
    topLanding: topList(byEntry).slice(0, 8),
    bySource: topList(bySource).slice(0, 8),
    byCampaign: topList(byCampaign).slice(0, 8),
    byDevice: topList(byDevice),
  };
}

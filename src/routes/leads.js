import { Router } from 'express';
import { config } from '../config.js';
import { validateLead } from '../lib/validate.js';
import { createLead, listLeads } from '../lib/store.js';
import { forwardLead, forwardLeadToCrm } from '../lib/notify.js';
import { logActivity } from '../lib/activity.js';

export const leadsRouter = Router();

// Only ever redirect back to the site itself. Stops the endpoint being turned
// into an open redirect via a crafted `_next`.
function safeNext(rawNext) {
  const fallback = new URL(config.thankYouPath, config.siteUrl).href;
  if (!rawNext) return fallback;
  try {
    const target = new URL(rawNext, config.siteUrl);
    const allowed = new Set([new URL(config.siteUrl).host]);
    for (const o of config.allowedOrigins) {
      try { allowed.add(new URL(o).host); } catch { /* skip */ }
    }
    if (allowed.has(target.host)) return target.href;
  } catch { /* fall through */ }
  return fallback;
}

const wantsJson = (req) =>
  req.is('application/json') || (req.headers.accept || '').includes('application/json');

// ── POST /api/leads ── the lead form target (url-encoded or JSON).
leadsRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const redirectTo = safeNext(body._next);

    // Honeypot: bots fill the hidden `_gotcha` field, humans never see it.
    // Pretend success and store nothing.
    if (typeof body._gotcha === 'string' && body._gotcha.trim() !== '') {
      return wantsJson(req) ? res.json({ ok: true }) : res.redirect(303, redirectTo);
    }

    const { valid, errors, data } = validateLead(body);
    if (!valid) {
      if (wantsJson(req)) return res.status(422).json({ ok: false, errors });
      return res.status(422).type('html').send(errorPage(errors, req.get('referer')));
    }

    const record = await createLead(data, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    logActivity({ leadId: record.id, type: 'created', message: `Enquiry received via ${record.source}` });
    forwardLead(record);      // optional webhook (Slack / Zapier)
    forwardLeadToCrm(record); // mirror to the external CRM intake

    // POST → 303 → GET the thank-you page (where the conversion event fires).
    if (wantsJson(req)) return res.status(201).json({ ok: true, id: record.id });
    return res.redirect(303, redirectTo);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/leads ── recent leads for the clinic. Off unless API_KEY is set.
leadsRouter.get('/', async (req, res, next) => {
  try {
    if (!config.apiKey) return res.status(404).json({ ok: false, error: 'not_found' });
    const key = req.get('x-api-key') || req.query.key;
    if (key !== config.apiKey) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const leads = await listLeads(limit);
    res.json({ ok: true, count: leads.length, leads });
  } catch (err) {
    next(err);
  }
});

function errorPage(errors, referer) {
  const back = referer || '/';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Check your details</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:14vh auto;padding:0 1.5rem;color:#1D2526;line-height:1.7}h1{color:#0B4F59}a{color:#167C88}</style>
</head><body>
<h1>We could not read a few details</h1>
<p>Please go back and check these fields: <strong>${errors.join(', ')}</strong>.</p>
<p><a href="${back}">&larr; Back to the form</a></p>
</body></html>`;
}

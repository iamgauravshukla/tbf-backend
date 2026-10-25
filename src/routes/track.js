import { Router } from 'express';
import { recordVisit } from '../lib/visits.js';

export const trackRouter = Router();

// Public, cookieless page-view beacon. The browser sends it with sendBeacon,
// whose body is text/plain — a CORS "simple" request, so there is no preflight —
// and we JSON-parse it here (express.text runs ahead of this in app.js; a
// JSON-content fallback arrives already parsed as an object). Fire-and-forget:
// acknowledge immediately and never let a tracking failure surface to the page.
trackRouter.post('/', (req, res) => {
  res.status(204).end();
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return; } }
    if (!body || typeof body !== 'object') return;
    recordVisit(body).catch((err) => console.error('[track] write failed:', err.message));
  } catch (err) {
    console.error('[track] failed:', err.message);
  }
});

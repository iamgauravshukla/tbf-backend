import crypto from 'node:crypto';
import { config } from '../config.js';

// Meta Conversions API — server-side `Schedule` for a completed booking.
//
// This is the SECOND half of a deduplicated conversion: the browser Pixel fires
// `Schedule` with `eventID = <booking id>`, and this sends the same event with
// `event_id = <booking id>`. Meta collapses the pair into ONE conversion, while
// still counting bookings that the browser event missed (ad blockers, iOS, lost
// tabs). The shared id is the whole point — never send a different id here.
//
// GATED OFF by default. It sends only when META_CAPI_ENABLED=true AND a pixel id
// and access token are configured. That is deliberate: do not enable it until
// any OTHER server-side source of Schedule (e.g. an external CRM's own Meta
// integration) has been removed, or conversions will be double-counted.
//
// Fire-and-forget: the booking is already saved before this runs, so a Meta
// outage can never affect the booking. Never throws.

export const capiReady = () =>
  Boolean(config.metaCapi.enabled && config.metaCapi.pixelId && config.metaCapi.token);

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Meta requires user data lowercased/trimmed and SHA-256 hashed. Empty → omit.
const hashEmail = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return s ? sha256(s) : null;
};

// Phone → digits only, E.164 without '+', best-effort PH normalisation so the
// hash matches what Meta derives from the ad click.
const hashPhone = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0') && d.length === 11) d = '63' + d.slice(1); // 09XXXXXXXXX → 63XXXXXXXXX
  else if (d.length === 10 && d.startsWith('9')) d = '63' + d;     // 9XXXXXXXXX  → 63XXXXXXXXX
  return sha256(d);
};

// Pure builder (no network) so the payload shape can be unit-tested.
export function buildSchedulePayload(record, ctx = {}, cfg = config.metaCapi) {
  const em = hashEmail(record.email);
  const ph = hashPhone(record.phone);

  const user_data = {
    client_ip_address: ctx.clientIp || undefined,
    client_user_agent: ctx.userAgent || undefined,
  };
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];
  if (record.id) user_data.external_id = [sha256(String(record.id))];
  if (ctx.fbp) user_data.fbp = ctx.fbp;
  if (ctx.fbc) user_data.fbc = ctx.fbc;

  const event = {
    event_name: 'Schedule',
    event_time: Math.floor(Date.now() / 1000),
    event_id: record.id,            // MUST equal the browser eventID (dedup)
    action_source: 'website',
    user_data,
    custom_data: {
      currency: cfg.currency,
      value: cfg.value,
      content_name: record.treatment || undefined,
      content_category: 'booking',
    },
  };
  if (ctx.eventSourceUrl) event.event_source_url = ctx.eventSourceUrl;

  const body = { data: [event] };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
  return body;
}

// Send the server-side Schedule. No-op (with one quiet log) when not configured.
export function sendScheduleEvent(record, ctx = {}) {
  if (!config.metaCapi.enabled) return;
  if (!config.metaCapi.pixelId || !config.metaCapi.token) {
    console.warn('[capi] META_CAPI_ENABLED is true but META_PIXEL_ID / META_CAPI_TOKEN are missing — skipping Schedule.');
    return;
  }

  const { pixelId, token, apiVersion } = config.metaCapi;
  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  const payload = buildSchedulePayload(record, ctx);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      const text = await res.text().catch(() => '');
      if (!res.ok) console.error(`[capi] Schedule responded ${res.status}:`, text.slice(0, 400));
      else if (config.metaCapi.testEventCode) console.log('[capi] Schedule (test) sent:', text.slice(0, 300));
    })
    .catch((err) => console.error('[capi] Schedule failed:', err.message))
    .finally(() => clearTimeout(timer));
}

import { config } from '../config.js';

// Fire-and-forget POST. Never blocks or fails the visitor's response — the lead
// is already saved to disk before any of this runs, so an outage downstream can
// never lose an enquiry. An 8s timeout stops a hung request leaking a socket.
function postJson(url, payload, tag) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[notify] ${tag} responded ${res.status}:`, body.slice(0, 300));
      }
    })
    .catch((err) => console.error(`[notify] ${tag} failed:`, err.message))
    .finally(() => clearTimeout(timer));
}

// Forward to a webhook (Slack, Zapier, a CRM inbox).
export function forwardLead(record) {
  if (!config.webhookUrl) return;
  postJson(
    config.webhookUrl,
    {
      text: `New enquiry — ${record.name} · ${record.phone} · ${record.treatment} (via ${record.source})`,
      lead: record,
    },
    'webhook',
  );
}

// Mirror the lead to the external CRM lead intake. It expects its own shape
// (`fullname`, not `name`) and reads `type` / `center` from the query string.
export function forwardLeadToCrm(record) {
  if (!config.crmForwardUrl) return;

  let url;
  try {
    url = new URL(config.crmForwardUrl);
    if (config.crmForwardType) url.searchParams.set('type', config.crmForwardType);
    if (config.crmForwardCenter) url.searchParams.set('center', config.crmForwardCenter);
  } catch {
    console.error('[notify] CRM_FORWARD_URL is not a valid URL:', config.crmForwardUrl);
    return;
  }

  postJson(
    url,
    {
      fullname: record.name,
      email: record.email || '',
      phone: record.phone,
      treatment: record.treatment,
      message: record.message || '',
    },
    'crm-forward',
  );
}

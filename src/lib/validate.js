// Server-side validation. The form enforces `required` in the browser, but the
// endpoint can be hit directly, so nothing is trusted until it is checked here.
const str = (v) => (typeof v === 'string' ? v.trim() : '');

const truthy = (v) => v === 'on' || v === 'true' || v === '1' || v === true;

// A pragmatic email check — one @, a dot in the domain, no spaces. Deliberately
// lenient: the goal is to catch typos, not to reject unusual-but-valid addresses.
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function validateLead(body = {}) {
  const name = str(body.name);
  const email = str(body.email);
  const phone = str(body.phone);
  const treatment = str(body.treatment);
  const message = str(body.message);
  const source = str(body.source) || 'unknown';
  const consent = truthy(body.consent);

  const errors = [];
  if (name.length < 2 || name.length > 80) errors.push('name');

  if (!emailOk(email) || email.length > 160) errors.push('email');

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) errors.push('phone');

  if (!treatment || treatment.length > 120) errors.push('treatment');
  if (message.length > 2000) errors.push('message');
  if (!consent) errors.push('consent');

  return {
    valid: errors.length === 0,
    errors,
    data: { name, email, phone, treatment, message, source, consent },
  };
}

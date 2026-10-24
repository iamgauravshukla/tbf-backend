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

// Direct booking: stricter than an enquiry. Email, age (min 25) and a valid
// future appointment are all required. The booking is stored as a lead with
// source 'booking' so it flows into the same admin pipeline.
const MIN_AGE = 25;

export function validateBooking(body = {}) {
  const name = str(body.name);
  const email = str(body.email);
  const phone = str(body.phone);
  const treatment = str(body.treatment);
  const preMedical = str(body.preMedical);
  const consent = truthy(body.consent);
  const ageNum = Number.parseInt(String(body.age ?? '').trim(), 10);

  // Appointment: accept an ISO instant (the form converts the local date+time to
  // ISO before sending). Must parse and be in the future.
  const apptRaw = str(body.appointmentAt);
  const apptDate = apptRaw ? new Date(apptRaw) : null;
  const apptValid = apptDate && !Number.isNaN(apptDate.getTime());
  const apptFuture = apptValid && apptDate.getTime() > Date.now() - 60 * 1000; // allow 1 min clock skew

  const errors = [];
  if (name.length < 2 || name.length > 80) errors.push('name');
  if (!emailOk(email) || email.length > 160) errors.push('email');

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) errors.push('phone');

  if (!Number.isInteger(ageNum) || ageNum < MIN_AGE || ageNum > 120) errors.push('age');
  if (!treatment || treatment.length > 120) errors.push('treatment');
  if (!apptValid) errors.push('appointmentAt');
  else if (!apptFuture) errors.push('appointmentPast');
  if (preMedical.length > 2000) errors.push('preMedical');
  if (!consent) errors.push('consent');

  return {
    valid: errors.length === 0,
    errors,
    data: {
      name,
      email,
      phone,
      treatment,
      age: Number.isInteger(ageNum) ? ageNum : null,
      appointmentAt: apptValid ? apptDate.toISOString() : null,
      preMedical,
      message: '',
      source: 'booking',
      consent,
    },
  };
}

export { MIN_AGE };

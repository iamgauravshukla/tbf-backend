import { config } from '../config.js';

// Booking-confirmation email over SMTP (the clinic mailbox). Everything here is
// fire-and-forget: the booking is already saved before this runs, so a mail
// outage can never lose a booking. If SMTP is not configured, we log once and
// skip — the booking still appears in the dashboard.

const smtpReady = () => {
  const s = config.smtp;
  return Boolean(s.host && s.user && s.pass && s.from);
};

let transportPromise = null;
async function getTransport() {
  if (!transportPromise) {
    // Lazy import so the app boots even if nodemailer is absent or unused.
    const nodemailer = (await import('nodemailer')).default;
    transportPromise = Promise.resolve(
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      }),
    );
  }
  return transportPromise;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtWhen(iso) {
  if (!iso) return 'To be confirmed';
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: config.clinicTz,
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

// Returns the built { subject, text, html } for the customer confirmation.
// Exported so it can be unit-tested without sending.
export function buildBookingEmail(record) {
  const when = fmtWhen(record.appointmentAt);
  const clinic = config.clinicName;
  const phoneLine = config.clinicPhone ? `\nCall us: ${config.clinicPhone}` : '';
  const subject = `We've received your booking — ${record.treatment}`;

  const text =
`Hi ${record.name},

Thank you for booking with ${clinic}. We've received your request and our team will confirm your slot shortly.

Your request
  Treatment: ${record.treatment}
  Preferred date & time: ${when}
  Name: ${record.name}
  Phone: ${record.phone}

What happens next
  This is a booking request, not yet a confirmed appointment. We'll contact you to confirm the slot and go over your assessment. Every treatment begins with a complimentary assessment, and treatment is scheduled once any required payment is settled.

If any detail is wrong, just reply to this email or message us.${phoneLine}

— ${clinic}`;

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;color:#1D2526;line-height:1.6;max-width:560px;margin:0 auto">
  <h2 style="color:#0B4F59;font-weight:600;margin:0 0 4px">We've received your booking</h2>
  <p style="margin:0 0 16px;color:#6E7B7D">Hi ${esc(record.name)}, thank you for booking with ${esc(clinic)}. Our team will confirm your slot shortly.</p>
  <table style="width:100%;border-collapse:collapse;background:#F7F4EE;border:1px solid #E2DCD1">
    <tr><td style="padding:10px 14px;color:#6E7B7D;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Treatment</td><td style="padding:10px 14px;font-weight:600">${esc(record.treatment)}</td></tr>
    <tr><td style="padding:10px 14px;color:#6E7B7D;font-size:12px;text-transform:uppercase;letter-spacing:.08em;border-top:1px solid #EDE8DF">Date &amp; time</td><td style="padding:10px 14px;font-weight:600;border-top:1px solid #EDE8DF">${esc(when)}</td></tr>
    <tr><td style="padding:10px 14px;color:#6E7B7D;font-size:12px;text-transform:uppercase;letter-spacing:.08em;border-top:1px solid #EDE8DF">Phone</td><td style="padding:10px 14px;border-top:1px solid #EDE8DF">${esc(record.phone)}</td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:14px;color:#46545A"><strong>What happens next.</strong> This is a booking request, not yet a confirmed appointment. We'll contact you to confirm the slot and go over your assessment. Every treatment begins with a complimentary assessment, and treatment is scheduled once any required payment is settled.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#6E7B7D">If any detail is wrong, reply to this email or message us.${config.clinicPhone ? ' Call us: ' + esc(config.clinicPhone) + '.' : ''}</p>
  <p style="margin:20px 0 0;color:#0B4F59;font-weight:600">${esc(clinic)}</p>
</div>`;

  return { subject, text, html };
}

// Send the booking confirmation to the customer. Never throws; never blocks.
export function sendBookingConfirmation(record) {
  if (!smtpReady()) {
    console.warn('[email] SMTP not configured — skipping booking confirmation. Set SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM to enable.');
    return;
  }
  if (!record.email) return;

  (async () => {
    try {
      const t = await getTransport();
      const { subject, text, html } = buildBookingEmail(record);
      await t.sendMail({ from: config.smtp.from, to: record.email, subject, text, html });
    } catch (err) {
      console.error('[email] booking confirmation failed:', err.message);
    }
  })();
}

// Who gets the "new enquiry / new booking" alert: the reception inbox and, if
// set, the bookings inbox. Deduplicated, so no one is emailed twice.
function staffRecipients() {
  return [...new Set([config.receptionEmail, config.smtp.bookingsInbox].filter(Boolean))];
}

function adminLink(id) {
  const base = config.adminUrl || `${(config.siteUrl || '').replace(/\/+$/, '')}/admin/`;
  if (!base) return '';
  return `${base.replace(/\/+$/, '')}/?lead=${id}`.replace('//?', '/?');
}

// Notify reception of a new enquiry (kind 'lead') or booking (kind 'booking').
// Fire-and-forget: the record is already saved before this runs.
export function sendStaffNotification(record, kind = 'lead') {
  if (!smtpReady()) {
    console.warn('[email] SMTP not configured — skipping staff notification.');
    return;
  }
  const to = staffRecipients();
  if (!to.length) {
    console.warn('[email] no RECEPTION_EMAIL / BOOKINGS_INBOX set — skipping staff notification.');
    return;
  }

  const isBooking = kind === 'booking';
  const when = record.appointmentAt ? fmtWhen(record.appointmentAt) : null;
  const link = adminLink(record.id);
  const subject = isBooking
    ? `🗓️ New booking — ${record.name} · ${record.treatment}`
    : `📩 New enquiry — ${record.name}${record.treatment ? ' · ' + record.treatment : ''}`;

  const rows = [
    ['Name', record.name],
    ['Phone', record.phone],
    ['Email', record.email || '—'],
    ['Treatment', record.treatment || '—'],
    isBooking ? ['Age', record.age ?? '—'] : null,
    isBooking ? ['Requested slot', when || '—'] : null,
    ['Source', record.source || '—'],
    record.message ? ['Message', record.message] : null,
    isBooking ? ['Pre-medical', record.preMedical || '(none provided)'] : null,
  ].filter(Boolean);

  const text =
`${isBooking ? 'New booking request' : 'New website enquiry'}

${rows.map(([k, v]) => `  ${k}: ${v}`).join('\n')}

${link ? `Open in the dashboard: ${link}` : 'Open the dashboard to follow up.'}`;

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;color:#1D2526;line-height:1.6;max-width:560px;margin:0 auto">
  <h2 style="color:#0B4F59;font-weight:600;margin:0 0 4px">${isBooking ? 'New booking request' : 'New website enquiry'}</h2>
  <table style="width:100%;border-collapse:collapse;background:#F7F4EE;border:1px solid #E2DCD1;margin-top:12px">
    ${rows.map(([k, v], i) => `<tr><td style="padding:9px 14px;color:#6E7B7D;font-size:12px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;vertical-align:top;${i ? 'border-top:1px solid #EDE8DF' : ''}">${esc(k)}</td><td style="padding:9px 14px;font-weight:600;${i ? 'border-top:1px solid #EDE8DF' : ''}">${esc(v)}</td></tr>`).join('')}
  </table>
  ${link ? `<p style="margin:16px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#0B4F59;color:#F7F4EE;text-decoration:none;padding:10px 18px;font-weight:600;font-size:14px">Open in the dashboard →</a></p>` : ''}
</div>`;

  (async () => {
    try {
      const t = await getTransport();
      await t.sendMail({ from: config.smtp.from, to, replyTo: record.email || undefined, subject, text, html });
    } catch (err) {
      console.error('[email] staff notification failed:', err.message);
    }
  })();
}

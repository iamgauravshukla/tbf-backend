import { Router } from 'express';
import { validateBooking } from '../lib/validate.js';
import { slotForInstant } from '../lib/slots.js';
import { createLead } from '../lib/store.js';
import { forwardLead, forwardLeadToCrm } from '../lib/notify.js';
import { sendBookingConfirmation, sendStaffNotification } from '../lib/email.js';
import { logActivity } from '../lib/activity.js';

export const bookingsRouter = Router();

const fmtWhen = (iso) => {
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

// ── POST /api/bookings ── direct treatment booking (JSON).
// Saved as a lead with source 'booking' and status 'new' (a request pending
// the clinic's confirmation), carrying the requested slot, age and pre-medical
// information. It appears in the dashboard immediately.
bookingsRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};

    // Honeypot: bots fill the hidden field, humans never see it.
    if (typeof body._gotcha === 'string' && body._gotcha.trim() !== '') {
      return res.json({ ok: true });
    }

    const { valid, errors, data } = validateBooking(body);
    if (!valid) return res.status(422).json({ ok: false, errors });

    // Must be a real, non-past slot (blocks out-of-hours / past times). A full
    // slot is still accepted — it comes in as a pending request (waitlist) and
    // is flagged for the team rather than refused.
    const slot = await slotForInstant(data.appointmentAt);
    if (!slot || slot.past) return res.status(422).json({ ok: false, errors: ['appointmentAt'] });
    const overCapacity = slot.remaining <= 0;
    if (overCapacity) data.notes = 'Slot was fully booked at request time — pending / waitlist.';

    const record = await createLead(data, {
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });

    logActivity({
      leadId: record.id,
      type: 'created',
      message: `Booking requested — ${record.treatment} @ ${fmtWhen(record.appointmentAt)} (via booking form)${overCapacity ? ' · ⚠ slot full (waitlist)' : ''}`,
    });
    forwardLead(record);                        // optional webhook (Slack / Zapier)
    forwardLeadToCrm(record);                   // mirror to the external CRM intake
    sendBookingConfirmation(record);            // email the customer (if SMTP configured)
    sendStaffNotification(record, 'booking');   // alert reception / clinic inbox

    res.status(201).json({ ok: true, id: record.id });
  } catch (err) {
    next(err);
  }
});

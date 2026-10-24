import { config } from '../config.js';
import { bookingAppointmentsBetween } from './store.js';

// Fixed appointment slots in the clinic's local time. Everything here works in
// Asia/Manila by default (UTC+8, no DST), so a slot start is converted to a UTC
// instant by appending the offset. If CLINIC_TZ is ever a tz with DST this would
// need a tz library; for Manila the fixed offset is exact.

const TZ_OFFSET = '+08:00'; // Asia/Manila

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Slot start times, e.g. ['10:00','10:45', … ] with start < CLOSE.
export function slotTimes() {
  const open = toMin(config.bookingOpen);
  const close = toMin(config.bookingClose);
  const step = config.slotMinutes;
  const out = [];
  for (let t = open; t < close; t += step) out.push(toHHMM(t));
  return out;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The UTC instant (ms) for a clinic-local date + "HH:MM".
export function slotInstant(dateStr, time) {
  return new Date(`${dateStr}T${time}:00${TZ_OFFSET}`).getTime();
}

// Real availability for a clinic-local date: how many of each slot are left,
// after subtracting existing bookings, with past slots marked unavailable.
export async function getAvailability(dateStr) {
  if (!isDate(dateStr)) throw Object.assign(new Error('bad_date'), { status: 400 });
  const times = slotTimes();
  const capacity = config.slotCapacity;
  const stepMs = config.slotMinutes * 60000;

  const dayStart = new Date(`${dateStr}T00:00:00${TZ_OFFSET}`).toISOString();
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 3600 * 1000).toISOString();
  const booked = await bookingAppointmentsBetween(dayStart, dayEnd);

  const now = Date.now();
  const slots = times.map((time) => {
    const start = slotInstant(dateStr, time);
    const taken = booked.filter((t) => t >= start && t < start + stepMs).length;
    const past = start <= now;
    const remaining = Math.max(0, capacity - taken);
    return { time, remaining, full: past || remaining <= 0, past };
  });
  return { date: dateStr, capacity, slotMinutes: config.slotMinutes, slots };
}

// For a requested appointment instant, return the matching slot's info (used to
// validate a booking and enforce capacity). null if it is not a valid slot.
export async function slotForInstant(appointmentIso) {
  const d = new Date(appointmentIso);
  if (Number.isNaN(d.getTime())) return null;
  // Derive the clinic-local date + HH:MM for this instant.
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: config.clinicTz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: config.clinicTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  if (!slotTimes().includes(time)) return null;
  const { slots } = await getAvailability(dateStr);
  return slots.find((s) => s.time === time) || null;
}

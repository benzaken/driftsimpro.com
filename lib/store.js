// Booking storage backed by Vercel KV (Redis).
//
// Everything lives under two keys:
//   - "all_bookings"   -> JSON array of { id, startAt, endAt, status, expiresAt? }
//   - "blocked_ranges" -> JSON array of { id, start, end, reason }
//
// This is intentionally simple (single JSON blob per key, not per-date
// buckets) so a booking that starts late at night and runs past midnight
// is never split across two records. A short-lived lock serializes writes
// so two people checking out at the same moment can't both grab the same
// slot.

const { kv } = require('@vercel/kv');
const { DateTime } = require('luxon');

const VENUE_TIMEZONE = 'America/New_York';
const SLOT_INTERVAL_MINUTES = 45;
const MINUTES_PER_DAY = 24 * 60;

const BOOKINGS_KEY = 'all_bookings';
const BLOCKED_KEY = 'blocked_ranges';
const LOCK_KEY = 'lock:all_bookings';

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function withLock(fn) {
  const lockValue = `${Date.now()}-${Math.random()}`;
  let acquired = false;
  for (let i = 0; i < 30 && !acquired; i++) {
    acquired = await kv.set(LOCK_KEY, lockValue, { nx: true, ex: 10 });
    if (!acquired) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  if (!acquired) {
    throw new Error('Could not get a lock on the booking calendar, please try again');
  }
  try {
    return await fn();
  } finally {
    const current = await kv.get(LOCK_KEY);
    if (current === lockValue) {
      await kv.del(LOCK_KEY);
    }
  }
}

async function getAllBookings() {
  return (await kv.get(BOOKINGS_KEY)) || [];
}

async function getBlockedRanges() {
  return (await kv.get(BLOCKED_KEY)) || [];
}

function isActive(booking, now) {
  if (booking.status === 'paid') return true;
  if (booking.status === 'pending') return new Date(booking.expiresAt) > now;
  return false;
}

// Returns { busy, blocked } as arrays of { start: Date, end: Date }
async function loadActiveRanges(now) {
  const [bookings, blocked] = await Promise.all([getAllBookings(), getBlockedRanges()]);
  const busy = bookings
    .filter((b) => isActive(b, now))
    .map((b) => ({ start: new Date(b.startAt), end: new Date(b.endAt) }));
  const blockedRanges = blocked.map((r) => ({ start: new Date(r.start), end: new Date(r.end) }));
  return { busy, blockedRanges };
}

function hasConflict(startAt, endAt, busy, blockedRanges) {
  return (
    busy.some((r) => overlaps(startAt, endAt, r.start, r.end)) ||
    blockedRanges.some((r) => overlaps(startAt, endAt, r.start, r.end))
  );
}

/**
 * Try to reserve a temporary hold on a slot. Returns { ok: true } if
 * successful, or { ok: false, reason } if the slot conflicts with an
 * existing booking or a blocked (maintenance) window.
 */
async function reserveHold({ id, startAt, endAt, holdMinutes = 30 }) {
  return withLock(async () => {
    const now = new Date();
    if (startAt < now) {
      return { ok: false, reason: 'past' };
    }
    const { busy, blockedRanges } = await loadActiveRanges(now);
    if (hasConflict(startAt, endAt, busy, blockedRanges)) {
      return { ok: false, reason: 'conflict' };
    }
    const bookings = await getAllBookings();
    bookings.push({
      id,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      status: 'pending',
      expiresAt: new Date(Date.now() + holdMinutes * 60000).toISOString(),
    });
    await kv.set(BOOKINGS_KEY, bookings);
    return { ok: true };
  });
}

async function confirmBooking(id) {
  return withLock(async () => {
    const bookings = await getAllBookings();
    const idx = bookings.findIndex((b) => b.id === id);
    if (idx === -1) return false;
    bookings[idx].status = 'paid';
    delete bookings[idx].expiresAt;
    await kv.set(BOOKINGS_KEY, bookings);
    return true;
  });
}

async function releaseHold(id) {
  return withLock(async () => {
    const bookings = await getAllBookings();
    const filtered = bookings.filter((b) => b.id !== id);
    if (filtered.length !== bookings.length) {
      await kv.set(BOOKINGS_KEY, filtered);
    }
  });
}

/**
 * Returns the list of 45-min-apart start times for a given local date
 * (YYYY-MM-DD, in VENUE_TIMEZONE), each with an availability flag for
 * a session of the given duration starting there.
 */
async function getAvailableSlots(dateStr, durationMinutes) {
  const now = new Date();
  const dayStart = DateTime.fromISO(dateStr, { zone: VENUE_TIMEZONE }).startOf('day');
  if (!dayStart.isValid) {
    throw new Error('Invalid date');
  }
  const { busy, blockedRanges } = await loadActiveRanges(now);

  const slots = [];
  for (let m = 0; m < MINUTES_PER_DAY; m += SLOT_INTERVAL_MINUTES) {
    const startDt = dayStart.plus({ minutes: m });
    const endDt = startDt.plus({ minutes: durationMinutes });
    const startJS = startDt.toJSDate();
    const endJS = endDt.toJSDate();

    let available = startJS >= now;
    if (available) {
      available = !hasConflict(startJS, endJS, busy, blockedRanges);
    }

    slots.push({ start: startDt.toFormat('HH:mm'), available });
  }
  return slots;
}

async function addBlockedRange({ id, start, end, reason }) {
  return withLock(async () => {
    const ranges = await getBlockedRanges();
    ranges.push({ id, start, end, reason: reason || '' });
    await kv.set(BLOCKED_KEY, ranges);
    return ranges;
  });
}

async function removeBlockedRange(id) {
  return withLock(async () => {
    const ranges = await getBlockedRanges();
    const filtered = ranges.filter((r) => r.id !== id);
    await kv.set(BLOCKED_KEY, filtered);
    return filtered;
  });
}

module.exports = {
  VENUE_TIMEZONE,
  SLOT_INTERVAL_MINUTES,
  reserveHold,
  confirmBooking,
  releaseHold,
  getAvailableSlots,
  getBlockedRanges,
  addBlockedRange,
  removeBlockedRange,
};

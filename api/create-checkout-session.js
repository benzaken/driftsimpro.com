const Stripe = require('stripe');
const { DateTime } = require('luxon');
const crypto = require('crypto');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { reserveHold, releaseHold, updateBooking, VENUE_TIMEZONE } = require('../lib/store');

const SITE_URL = 'https://driftsimpro.com';
// Longer than the old payment-only hold (30 min) since the customer now has
// to get through ID verification *and* payment before the slot is released.
const HOLD_MINUTES = 45;

const PRICE_TABLE = {
  30: 1750,
  60: 3500,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { date, time, duration, name, email } = req.body;

    if (!date || !time || !duration || !name || !email) {
      return res.status(400).json({ error: 'Missing required booking details' });
    }

    const minutes = parseInt(duration, 10);
    if (!PRICE_TABLE[minutes]) {
      return res.status(400).json({ error: 'Invalid duration' });
    }

    const startAt = DateTime.fromISO(`${date}T${time}`, { zone: VENUE_TIMEZONE });
    if (!startAt.isValid) {
      return res.status(400).json({ error: 'Invalid date or time' });
    }
    const endAt = startAt.plus({ minutes });

    const bookingId = crypto.randomUUID();
    const hold = await reserveHold({
      id: bookingId,
      startAt: startAt.toJSDate(),
      endAt: endAt.toJSDate(),
      holdMinutes: HOLD_MINUTES,
      meta: { date, time, duration: String(minutes), name, email },
    });

    if (!hold.ok) {
      const message = hold.reason === 'past'
        ? 'That time has already passed. Please pick another slot.'
        : 'That time was just booked or is blocked. Please pick another slot.';
      return res.status(409).json({ error: message });
    }

    let verificationSession;
    try {
      verificationSession = await stripe.identity.verificationSessions.create({
        type: 'document',
        metadata: { bookingId },
        options: {
          document: {
            require_matching_selfie: true,
          },
        },
        // Stripe doesn't template this the way Checkout does, so we bake
        // the bookingId in ourselves and look up the verification session
        // id server-side (see api/verification-status.js).
        return_url: `${SITE_URL}/verify-return.html?bookingId=${bookingId}`,
      });
    } catch (err) {
      await releaseHold(bookingId).catch(() => {});
      throw err;
    }

    await updateBooking(bookingId, {
      verificationSessionId: verificationSession.id,
      verificationStatus: verificationSession.status, // 'requires_input'
    });

    return res.status(200).json({ url: verificationSession.url, bookingId });
  } catch (err) {
    console.error('Verification session error:', err);
    return res.status(500).json({ error: 'Could not start identity verification' });
  }
};

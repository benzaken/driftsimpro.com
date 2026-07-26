const Stripe = require('stripe');
const { DateTime } = require('luxon');
const crypto = require('crypto');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { reserveHold, releaseHold, VENUE_TIMEZONE } = require('../lib/store');

const SITE_URL = 'https://driftsimpro.com';
const HOLD_MINUTES = 30; // matches Stripe's minimum checkout session expiry

// Duration options, keyed by duration in minutes -> price in cents.
// Both prorate at the $35/hr rate.
const PRICE_TABLE = {
  30: 1750, // 30 min — $17.50
  60: 3500, // 1 hr — $35
};

function formatDuration(minutes) {
  if (minutes % 60 === 0) {
    return `${minutes / 60} hr`;
  }
  return `${minutes} min`;
}

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
    const unitAmount = PRICE_TABLE[minutes];
    if (!unitAmount) {
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
    });

    if (!hold.ok) {
      const message = hold.reason === 'past'
        ? 'That time has already passed. Please pick another slot.'
        : 'That time was just booked or is blocked. Please pick another slot.';
      return res.status(409).json({ error: message });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        managed_payments: { enabled: false },
        expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Sim Drift session — ${formatDuration(minutes)} (${date} ${time})`,
              },
              unit_amount: unitAmount,
            },
            quantity: 1,
          },
        ],
        metadata: { date, time, duration: String(minutes), name, email, bookingId },
        success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/book.html`,
      });
    } catch (err) {
      // Stripe session creation failed — free up the slot we just held.
      await releaseHold(bookingId).catch(() => {});
      throw err;
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
};

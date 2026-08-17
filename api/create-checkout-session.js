const Stripe = require('stripe');
const { DateTime } = require('luxon');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { getBooking, updateBooking, VENUE_TIMEZONE } = require('../lib/store');

// Stripe requires checkout session expiry to be at least 30 minutes out.
const MIN_CHECKOUT_MINUTES = 31;

const SITE_URL = 'https://driftsimpro.com';

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
    // Payment now always follows identity verification: the client only
    // ever sends the bookingId it got back from create-verification-session.
    // Everything about the booking (date/time/duration/name/email) is read
    // from the held record itself, not trusted from the request body — that
    // also stops someone from swapping in a cheaper duration after the fact.
    const { bookingId } = req.body;
    if (!bookingId) {
      return res.status(400).json({ error: 'Missing bookingId' });
    }

    const booking = await getBooking(bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'That booking has expired. Please start over.' });
    }
    if (booking.verificationStatus !== 'verified') {
      return res.status(403).json({ error: 'Identity verification has not been completed yet.' });
    }
    if (!booking.meta) {
      return res.status(400).json({ error: 'Booking is missing details. Please start over.' });
    }

    const { date, time, duration, name, email } = booking.meta;
    const minutes = parseInt(duration, 10);
    const unitAmount = PRICE_TABLE[minutes];
    if (!unitAmount) {
      return res.status(400).json({ error: 'Invalid duration' });
    }

    // If ID verification took a while, the original hold may now be too
    // close to expiry for Stripe's 30-min-minimum checkout window. Extend
    // the hold to match rather than let checkout outlive it.
    const minExpiry = Date.now() + MIN_CHECKOUT_MINUTES * 60000;
    let expiresAtMs = new Date(booking.expiresAt).getTime();
    if (expiresAtMs < minExpiry) {
      expiresAtMs = minExpiry;
      await updateBooking(bookingId, { expiresAt: new Date(expiresAtMs).toISOString() });
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        managed_payments: { enabled: false },
        // Expire alongside the underlying hold rather than a fresh 30 min,
        // so we never accept a payment for a slot whose hold already lapsed.
        expires_at: Math.floor(expiresAtMs / 1000),
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
      throw err;
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
};

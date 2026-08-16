const Stripe = require('stripe');
const { DateTime } = require('luxon');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { confirmBooking, releaseHold, updateBooking } = require('../lib/store');

// The local time zone your booking times are entered in.
const VENUE_TIMEZONE = 'America/New_York';

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function createLockCode(session) {
  const { date, time, duration } = session.metadata;
  const minutes = parseInt(duration, 10); // duration is stored in minutes

  const startsAt = DateTime.fromISO(`${date}T${time}`, { zone: VENUE_TIMEZONE });

  // TEST_SHORT_CODES=true in Vercel env vars makes every code expire in
  // 3 minutes instead of the real booked duration, so you don't have to
  // wait a full session length to test expiry. Remove/set to false for
  // real customer bookings.
  const endsAt = process.env.TEST_SHORT_CODES === 'true'
    ? startsAt.plus({ minutes: 3 })
    : startsAt.plus({ minutes });

  const codeName = `SD-${session.id.slice(-12)}`;

  const seamRes = await fetch('https://connect.getseam.com/access_codes/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SEAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_id: process.env.SEAM_DEVICE_ID,
      name: codeName,
      starts_at: startsAt.toUTC().toISO(),
      ends_at: endsAt.toUTC().toISO(),
    }),
  });

  const seamData = await seamRes.json();

  if (!seamRes.ok) {
    console.error('Seam create access code failed:', seamData);
    throw new Error('Seam access code creation failed');
  }

  console.log('Seam access code requested:', codeName, seamData);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      if (session.metadata && session.metadata.bookingId) {
        await confirmBooking(session.metadata.bookingId);
      }
      await createLockCode(session);
    } catch (err) {
      console.error('Failed to create lock code for session', session.id, err);
    }
  }

  // If a customer never finishes paying, Stripe expires the checkout
  // session — free up the slot so someone else can book it.
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    if (session.metadata && session.metadata.bookingId) {
      try {
        await releaseHold(session.metadata.bookingId);
      } catch (err) {
        console.error('Failed to release hold for expired session', session.id, err);
      }
    }
  }

  // Identity verification events — these keep booking.verificationStatus
  // current so create-checkout-session can trust it without an extra
  // round trip to Stripe, and so verify-return.html's polling picks up
  // the result even if the customer's browser is what's slow, not us.
  if (event.type === 'identity.verification_session.verified') {
    const vs = event.data.object;
    const bookingId = vs.metadata && vs.metadata.bookingId;
    if (bookingId) {
      try {
        await updateBooking(bookingId, { verificationStatus: 'verified' });
      } catch (err) {
        console.error('Failed to mark booking verified', bookingId, err);
      }
    }
  }

  if (event.type === 'identity.verification_session.requires_input') {
    // Fires both when verification is still pending input and when it has
    // definitively failed — vs.last_error tells us which.
    const vs = event.data.object;
    const bookingId = vs.metadata && vs.metadata.bookingId;
    if (bookingId) {
      try {
        await updateBooking(bookingId, {
          verificationStatus: 'requires_input',
          verificationError: vs.last_error ? vs.last_error.reason : null,
        });
      } catch (err) {
        console.error('Failed to update booking verification status', bookingId, err);
      }
    }
  }

  if (event.type === 'identity.verification_session.canceled') {
    const vs = event.data.object;
    const bookingId = vs.metadata && vs.metadata.bookingId;
    if (bookingId) {
      try {
        await releaseHold(bookingId);
      } catch (err) {
        console.error('Failed to release hold for canceled verification', bookingId, err);
      }
    }
  }

  return res.status(200).json({ received: true });
}

// Stripe needs the raw request body to verify the webhook signature,
// so we turn off Vercel's automatic JSON parsing for this endpoint.
// (This must be attached to the exported function itself — attaching it
// to module.exports before reassigning module.exports below would get
// silently discarded.)
handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;

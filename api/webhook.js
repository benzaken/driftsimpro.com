const Stripe = require('stripe');
const { DateTime } = require('luxon');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// The local time zone your booking times are entered in.
const VENUE_TIMEZONE = 'America/New_York';

// Stripe needs the raw request body to verify the webhook signature,
// so we turn off Vercel's automatic JSON parsing for this endpoint.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

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
  const hours = parseInt(duration, 10);

  const startsAt = DateTime.fromISO(`${date}T${time}`, { zone: VENUE_TIMEZONE });
  const endsAt = startsAt.plus({ hours });

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

module.exports = async (req, res) => {
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
      await createLockCode(session);
    } catch (err) {
      console.error('Failed to create lock code for session', session.id, err);
    }
  }

  return res.status(200).json({ received: true });
};

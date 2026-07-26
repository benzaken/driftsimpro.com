const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = 'https://driftsimpro.com';

// Duration options, keyed by duration in minutes -> price in cents.
// 40 min is a flat rate; 2 hr and 3 hr stay at the $35/hr rate.
const PRICE_TABLE = {
  40: 2500,   // 40 min — $25 flat
  120: 7000,  // 2 hr — $35/hr
  180: 10500, // 3 hr — $35/hr
};

function formatDuration(minutes) {
  if (minutes % 60 === 0) {
    const hrs = minutes / 60;
    return `${hrs} hr`;
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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      managed_payments: { enabled: false },
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
      metadata: { date, time, duration: String(minutes), name, email },
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/book.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Could not start checkout', debug: err.message });
  }
};

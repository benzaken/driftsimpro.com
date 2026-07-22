const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = 'https://driftsimpro.com';
const HOURLY_RATE_CENTS = 3500; // $35/hr

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

    const hours = parseInt(duration, 10);
    if (!hours || hours < 1 || hours > 12) {
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
              name: `Sim Drift session — ${hours} hr (${date} ${time})`,
            },
            unit_amount: hours * HOURLY_RATE_CENTS,
          },
          quantity: 1,
        },
      ],
      metadata: { date, time, duration: String(hours), name, email },
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/index.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Could not start checkout', debug: err.message });
  }
};

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = 'https://driftsimpro.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(200).json({ status: 'pending' });
    }

    const { date, time, duration } = session.metadata;
    const codeName = `SD-${session.id.slice(-12)}`;

    const listRes = await fetch('https://connect.getseam.com/access_codes/list', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SEAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: process.env.SEAM_DEVICE_ID }),
    });

    const listData = await listRes.json();
    const codes = listData.access_codes || [];
    const match = codes.find((c) => c.name === codeName);

    return res.status(200).json({
      status: 'paid',
      date,
      time,
      duration,
      code: match ? match.code : null,
      codeStatus: match ? match.status : 'processing',
    });
  } catch (err) {
    console.error('get-booking error:', err);
    return res.status(500).json({ error: 'Could not retrieve booking' });
  }
};

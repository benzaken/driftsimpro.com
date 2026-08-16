const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { getBooking, updateBooking } = require('../lib/store');

const SITE_URL = 'https://driftsimpro.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bookingId } = req.query;
  if (!bookingId) {
    return res.status(400).json({ error: 'Missing bookingId' });
  }

  const booking = await getBooking(bookingId);
  if (!booking) {
    return res.status(404).json({ error: 'That booking has expired. Please start over.' });
  }

  // The webhook keeps this current in the normal case. We only hit the
  // Stripe API directly as a fallback, e.g. if the webhook hasn't landed
  // yet the moment the customer is redirected back.
  let status = booking.verificationStatus || 'requires_input';
  if (status !== 'verified' && booking.verificationSessionId) {
    try {
      const vs = await stripe.identity.verificationSessions.retrieve(booking.verificationSessionId);
      status = vs.status; // requires_input | processing | verified | canceled
      if (status !== booking.verificationStatus) {
        await updateBooking(bookingId, { verificationStatus: status });
      }
    } catch (err) {
      console.error('Could not retrieve verification session', err);
    }
  }

  return res.status(200).json({ status });
};

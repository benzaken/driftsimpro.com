const { getAvailableSlots } = require('../lib/store');

const SITE_URL = 'https://driftsimpro.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { date, duration } = req.query;
  const minutes = parseInt(duration, 10);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date (expected YYYY-MM-DD)' });
  }
  if (!minutes || minutes < 1) {
    return res.status(400).json({ error: 'Missing or invalid duration' });
  }

  try {
    const slots = await getAvailableSlots(date, minutes);
    return res.status(200).json({ date, duration: minutes, slots });
  } catch (err) {
    console.error('availability error:', err);
    return res.status(500).json({ error: 'Could not load availability' });
  }
};

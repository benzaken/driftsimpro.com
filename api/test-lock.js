const { DateTime } = require('luxon');

module.exports = async (req, res) => {
  try {
    const now = DateTime.now().setZone('America/New_York');
    const startsAt = now;
    const endsAt = now.plus({ minutes: 15 });

    const seamRes = await fetch('https://connect.getseam.com/access_codes/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SEAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: process.env.SEAM_DEVICE_ID,
        name: 'TEST-LOCK-CHECK',
        starts_at: startsAt.toUTC().toISO(),
        ends_at: endsAt.toUTC().toISO(),
      }),
    });

    const seamData = await seamRes.json();

    if (!seamRes.ok) {
      return res.status(500).json({ error: 'Seam rejected the request', details: seamData });
    }

    return res.status(200).json({
      message: 'Test code created — valid for the next 15 minutes',
      code: seamData.code,
      status: seamData.status,
      starts_at: startsAt.toISO(),
      ends_at: endsAt.toISO(),
      raw: seamData,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

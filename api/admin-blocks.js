const crypto = require('crypto');
const { DateTime } = require('luxon');
const { getBlockedRanges, addBlockedRange, removeBlockedRange, VENUE_TIMEZONE } = require('../lib/store');

const SITE_URL = 'https://driftsimpro.com';

// Simple shared-secret auth: set ADMIN_KEY in your Vercel project's env
// vars, and enter that same value on the admin.html page. This is meant
// to keep casual visitors out, not to be bank-grade security — don't
// reuse a password you care about.
function isAuthorized(req) {
  const key = req.headers['x-admin-key'];
  return !!process.env.ADMIN_KEY && key === process.env.ADMIN_KEY;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Invalid or missing admin key' });
  }

  try {
    if (req.method === 'GET') {
      const ranges = await getBlockedRanges();
      return res.status(200).json({ ranges });
    }

    if (req.method === 'POST') {
      const { date, startTime, endTime, reason } = req.body;
      if (!date || !startTime || !endTime) {
        return res.status(400).json({ error: 'Missing date, startTime, or endTime' });
      }
      const start = DateTime.fromISO(`${date}T${startTime}`, { zone: VENUE_TIMEZONE });
      const end = DateTime.fromISO(`${date}T${endTime}`, { zone: VENUE_TIMEZONE });
      if (!start.isValid || !end.isValid || end <= start) {
        return res.status(400).json({ error: 'Invalid time range' });
      }
      const ranges = await addBlockedRange({
        id: crypto.randomUUID(),
        start: start.toISO(),
        end: end.toISO(),
        reason: reason || '',
      });
      return res.status(200).json({ ranges });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: 'Missing id' });
      }
      const ranges = await removeBlockedRange(id);
      return res.status(200).json({ ranges });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('admin-blocks error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

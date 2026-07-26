// Temporary diagnostic endpoint — reports which environment variable NAMES
// are present (never values) so a storage integration's actual naming can
// be discovered without digging through the Vercel dashboard. Safe to leave
// in short-term; remove once the booking system is confirmed working.
module.exports = async (req, res) => {
  const keys = Object.keys(process.env);
  const relevant = keys.filter((k) =>
    /REDIS|KV_|STORAGE|UPSTASH/i.test(k)
  );
  return res.status(200).json({
    relevantEnvVarNames: relevant,
    ADMIN_KEY: !!process.env.ADMIN_KEY,
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
  });
};

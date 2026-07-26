// Temporary diagnostic endpoint — reports which environment variables are
// present (true/false only, never the actual values) so setup problems can
// be pinpointed without exposing secrets. Safe to leave in, but intended to
// be removed once the booking system is confirmed working.
module.exports = async (req, res) => {
  return res.status(200).json({
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    ADMIN_KEY: !!process.env.ADMIN_KEY,
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
  });
};

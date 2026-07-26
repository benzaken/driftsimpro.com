# Setting up the new booking system

This adds real availability checking (45-minute start-time slots, double-booking
prevention, and a maintenance/cleaning block list) on top of the existing
Stripe + Seam flow. Two things need to be set up in your Vercel dashboard
before this goes live.

## 1. Create a Vercel KV store

1. Go to your project on vercel.com → **Storage** tab.
2. Click **Create Database** → choose **KV** (built on Upstash Redis).
3. Name it anything (e.g. `simdrift-bookings`) and create it.
4. On the next screen, click **Connect Project** and select this project
   (driftsimpro.com / driftsimpro-com). Vercel automatically adds the
   required environment variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`,
   etc.) — you don't need to copy/paste anything yourself.
5. Redeploy the project once (Vercel usually prompts you to) so the new
   env vars take effect.

That's it — bookings, holds, and blocked times are all stored there.

## 2. Set an admin key

The new `admin.html` page lets you block out maintenance/cleaning windows
without touching code. It's protected by a simple shared password.

1. In your Vercel project → **Settings** → **Environment Variables**.
2. Add a new variable: `ADMIN_KEY` = pick any password-like string
   (e.g. a random 20-character string — a password manager can generate one).
3. Redeploy.
4. Visit `https://driftsimpro.com/admin.html`, enter that same value, and
   you can add/remove blocked windows.

## What changed, in plain terms

- Customers now pick a date, a duration, and one of several fixed start
  times spaced 45 minutes apart (e.g. 12:00, 12:45, 1:30...) instead of
  typing in any time they want.
- Times that are already booked, or that you've manually blocked in
  `admin.html`, are shown crossed out and can't be selected.
- When someone starts checkout, that slot is held for 30 minutes (matching
  how long their Stripe payment page stays open). If they don't finish
  paying, the hold expires automatically and the slot opens back up — no
  manual cleanup needed.
- Optional: in your Stripe dashboard, under the webhook endpoint you
  already have configured, you can add the `checkout.session.expired`
  event so an abandoned checkout releases its hold immediately instead of
  waiting the full 30 minutes. Not required — the 30-minute auto-expiry
  covers it either way.

# Orbital Pro: subscriptions

**How it works**

- **Trial:** the desktop app gives everyone a 14-day trial of everything.
  - The trial starts the first time a version with Pro runs.
  - For existing users, that means from the update, so nobody loses days.
- **After the trial:**
  - The free features keep working forever: chat, notes, memory, files, Papers, projects, reminders, focus, dashboards, search and voice.
  - **Pro features** need a subscription ($10/month or $96/year): deep research, the contradiction lab and hypotheses, meetings and recordings, the Media library, opportunity discovery, automations, and knowledge health scans.
  - Anything already made with a Pro feature stays readable. Only *creating* new Pro items is blocked, and that shows an upgrade window.
- Self-hosted servers (not the desktop app) have no plans: everything is unlocked.

```
Website / app "Get Pro"  →  license service /buy  →  Stripe Checkout
Stripe success           →  license service /success  →  shows the key + "Activate in Orbital" (orbital://activate?key=…)
Orbital desktop          →  license service /verify (on activation, then daily)  →  Stripe subscription status
"Manage subscription"    →  license service /portal  →  Stripe customer portal (change plan, card, cancel)
```

**The license service** is `license-server/worker.js`, a Cloudflare Worker.
- A key is the Stripe subscription id plus an HMAC signature (`LICENSE_SECRET`), so nothing is stored.
- `/verify` checks the signature, then asks Stripe whether the subscription is `active`, `trialing` or `past_due`.
- The app saves the answer. Pro keeps working offline until the paid-for period ends, plus 3 days.
- The Stripe secret key lives only in the Worker's secrets. It's never in the app, on GitHub or on the website.

## One-time setup (about 30 minutes)

### 1. Stripe
1. Create an account at **stripe.com** and complete **Activate payments** (business details and bank account).
2. **Product catalog → Add product:**
   - Name **Orbital Pro**.
   - Add two **recurring** prices: **$10 / month** and **$96 / year**.
   - Copy each price id (`price_…`).
3. **Settings → Billing → Customer portal:**
   - Allow customers to **cancel**, **switch plans** (add both prices) and **update payment methods**.
   - Click **Save**.
4. **Developers → API keys:** copy the **Secret key** (`sk_live_…`). Use `sk_test_…` while testing.
5. Optional: **Stripe Tax** adds sales tax/VAT. Turn it on, then set `STRIPE_AUTOMATIC_TAX = "on"` below.

### 2. Cloudflare Worker
1. **dash.cloudflare.com → Workers & Pages → Create → Create Worker.**
   - Name it `orbital-license`, then **Deploy**.
   - Then **Edit code**, replace everything with `license-server/worker.js`, and **Deploy**.
2. **Settings → Variables and Secrets → Add:**
   - `STRIPE_SECRET_KEY` (type **Secret**): your Stripe secret key.
   - `LICENSE_SECRET` (type **Secret**): a long random text, for example the output of `openssl rand -hex 32`. **Never change it.** Every key ever sold depends on it.
   - `PRICE_MONTHLY`, `PRICE_YEARLY` (type **Text**): the two price ids.
   - `SITE_URL` (type **Text**): `https://orbitalai.us`
3. **Settings → Domains & Routes → Add → Custom domain:** `license.orbitalai.us`.
4. Check:
   - **https://license.orbitalai.us/** shows `{"ok":true,…}`.
   - **https://license.orbitalai.us/buy?plan=monthly** opens Stripe Checkout.

With the Wrangler CLI instead: `cd license-server`, fill the prices in `wrangler.toml`, then run:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

```bash
npx wrangler secret put LICENSE_SECRET
```

```bash
npx wrangler deploy
```

### 3. Test a purchase
1. With **test** keys, buy with card `4242 4242 4242 4242`. The success page shows the key.
2. In Orbital, go to **Settings → Plan**, paste the key and click **Activate**. It should show **Orbital Pro · Renews …**.
3. **Manage subscription** should open Stripe's portal.
4. Cancel there. Pro stays until the period ends.
5. Switch the Worker to live keys and live price ids.

## In the app
- **Settings → Plan:** status, Get Pro (monthly or yearly), license key, Manage subscription, Remove from this computer.
- **Sidebar:** "Pro trial · N days left", then "Upgrade to Pro".
- **Upgrade window:** opens whenever the server answers `402 pro_required` (creating research, a meeting, a recording, a hypothesis, opportunity discovery, automations, a health scan, or deep-research chat).
- **`orbital://activate?key=…`:** opens Settings → Plan and activates. It's registered by the app (`protocols` in `electron-builder.yml`).

Configuration (desktop app): `ORBITAL_LICENSE_URL` (default `https://license.orbitalai.us`), `ORBITAL_BILLING=off` to turn plans off.

**Limitation:** the app's code is public, so a technical person could remove the checks and rebuild it. As with most indie apps, the subscription relies on most people preferring to pay.

**Tests:**
- `server/test/plan.test.ts`: trial, blocking, readable past work, keys, offline, cancellation, daily re-check.
- `server/test/license.test.ts`: the Worker against a fake Stripe (checkout, key, forged/tampered keys, cancelled subscriptions, portal).

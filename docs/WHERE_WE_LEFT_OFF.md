# Where we left off (24 November 2026)

This file is the bookmark for picking Orbital back up. Start a new Claude Code session on this repository and say:

> "Read docs/WHERE_WE_LEFT_OFF.md and let's continue."

---

## Where things stand

| | Status |
|---|---|
| **App version in the code** | **0.3.9** (on `main`) |
| **Newest published release** | **0.3.6**. Versions 0.3.7, 0.3.8 and 0.3.9 are built but **not published yet** |
| **Website** | **orbitalai.us** (GitHub Pages, domain bought on Cloudflare) |
| **Website pricing section** | Ready on the branch **`site-pricing`**, not live yet. It waits for payments to be set up |
| **Payments (Orbital Pro)** | Built and tested with a fake Stripe. **Needs your Stripe account and the Cloudflare license service** (below) |
| **AI** | Users add their own Anthropic key in **Settings → AI & research** (no built-in AI) |
| **Tests** | 102 automated tests passing |

## Your to-do list, in order

### 1. Security (do first if you haven't)
- [ ] Delete the **Anthropic** key you pasted into the chat (console.anthropic.com → API Keys).
- [ ] Replace the **Supabase** secret key you pasted (supabase.com → Project Settings → API Keys), or delete that project.

### 2. Check the domain
- [ ] github.com/zaybaker132-spec/orbital/settings/pages → **Custom domain** must say exactly `orbitalai.us` (an earlier attempt had a typo: `www.orbitalai.com`).
- [ ] When it shows "DNS check successful", tick **Enforce HTTPS**.
- [ ] Open https://orbitalai.us to check that the site appears.
- Cloudflare DNS is already done: 4 × A records (185.199.108–111.153) and a CNAME `www` → `zaybaker132-spec.github.io`, all grey ("DNS only"). Ignore Cloudflare's yellow "proxying" warning.

### 3. Set up payments (about 30 minutes). Full steps in `docs/BILLING.md`
- [ ] **Stripe:**
  - Create an account and complete "Activate payments".
  - Add the product **Orbital Pro** with two recurring prices: $10/month and $96/year. Copy both `price_…` ids.
  - Settings → Billing → **Customer portal**: allow cancel, switch plans and update cards → Save.
  - Developers → API keys: copy the **Secret key**. Never paste it into a chat; it only goes into Cloudflare.
- [ ] **Cloudflare license service:**
  - Workers & Pages → Create Worker `orbital-license` → paste `license-server/worker.js`.
  - Add secrets `STRIPE_SECRET_KEY` and `LICENSE_SECRET` (long random text, never change it).
  - Add text variables `PRICE_MONTHLY`, `PRICE_YEARLY` and `SITE_URL=https://orbitalai.us`.
  - Add custom domain `license.orbitalai.us`.
- [ ] **Test** with Stripe test mode, card `4242 4242 4242 4242`, then activate the key in Orbital → Settings → Plan.

### 4. Go live
- [ ] Publish release **v0.3.9**: GitHub → Releases → Draft a new release → tag `v0.3.9` (target `main`) → title `Orbital 0.3.9` → paste `.github/release-notes.md` → Publish. Wait about 6 minutes for the green ✓ in Actions.
- [ ] Ask Claude to **merge the `site-pricing` branch** so the Pricing section goes live on orbitalai.us.

### 5. Getting found on Google
- [ ] Google Search Console → Add property → "Domain" → `orbitalai.us` → add the TXT record in Cloudflare DNS → Verify → Sitemaps → submit `sitemap.xml` → URL inspection → Request indexing.
- [ ] Bing Webmaster Tools → "Import from Google Search Console".
- [ ] GitHub repo **About** (⚙️): add the website, a description and topics (productivity, notes, ai, desktop-app).
- [ ] Launch posts: Product Hunt, Reddit (r/macapps, r/productivity, r/SideProject), Hacker News "Show HN", AlternativeTo.

### Optional, later
- [ ] **Apple Developer Program** ($99/year) removes the Mac "can't be verified" warning. Claude then adds 5 GitHub secrets with you and turns on notarization.
- [ ] **Windows signing** (Azure Trusted Signing, about $10/month) removes the "Windows protected your PC" warning.
- [ ] A contact email: Cloudflare → Email Routing → `hello@orbitalai.us` forwarding to your Gmail. Then ask Claude to add it and a Terms of Service page to the website.
- [ ] One-line Mac installer command on the website (free alternative to Apple signing). Offered, not built yet.

---

## What was built in this stretch

**Releases 0.3.4 to 0.3.6 (published)**
- Custom dashboards and widgets.
- Your environment: layout, accent colour, orb colours, background, text size.
- Card glow.
- Sidebar clock and weather, with automatic location.
- Recently viewed and favorites.
- Media library and meeting recording.

**Website**
- **Hero:** "Download for Mac" / "Download for Windows" buttons. They start the download directly, with no GitHub page, and always give the newest version.
- **Mac chip:** Apple-chip vs Intel detection.
- **After clicking:** a "Your download has started" box.
- **Short share links:** `/download/mac`, `/download/mac-intel`, `/download/windows`, `/download/linux`.
- **Domain:** moved to orbitalai.us.

**0.3.6: reminders**
- Orbital keeps running in the menu bar / tray when the window is closed, so reminders arrive as system notifications.
- Dock/taskbar badge.
- Open at login.
- Repeating reminders (daily, weekdays, chosen days, every N weeks/months/years, end date; time-zone and daylight-saving safe).
- Typed reminders in plain English ("call Sam friday at 3", "pay rent every month on the 1st") on the Reminders page, in chat ("remind me to…") and in ⌘K, with no AI needed.

**0.3.7: voice in the desktop app**
- Speech recognition runs privately on the computer (Whisper).
- Free and offline after a one-time download of about 80 MB.
- Works for voice chat, voice typing in Papers, and "Transcribe" in Media.

**0.3.8: fixes from a new-user walkthrough**
- Forgot password can be reset right in the desktop app.
- A new install opens on "Create your Orbital".
- Chat without an AI key points to Settings → AI & research, where the key box now lives with 3 steps to get a key.
- Removed the wrong "notifications blocked" note on the Reminders page.
- Removed the waitlist link from the desktop sign-in screen, and it now says "on this computer".
- Fixed the Focus page layout.
- The orb now fills its space on computers without 3D graphics.

**0.3.9: Orbital Pro**
- 14-day trial of everything, then the core stays free forever.
- Pro costs $10/month or $96/year and unlocks deep research and hypotheses, meetings and recordings, the Media library, opportunity discovery, automations and knowledge health scans.
- Past work always stays readable.
- In the app:
  - Settings → Plan.
  - An upgrade window when a Pro feature is used after the trial.
  - A sidebar trial badge.
  - "Activate in Orbital" links after purchase.
  - Stripe's own page for managing or cancelling.
- License service in `license-server/` (Cloudflare Worker + Stripe). See `docs/BILLING.md`.

## Decisions made (so they don't need re-asking)
- **AI:** bring your own key. Built-in paid AI was considered and declined.
- **Payments:** Stripe; Pro unlocks features (not AI); free 14-day trial; $10/month or $96/year.
- **Distribution:** downloads from the website (not the App Store). Files are hosted on GitHub Releases, but visitors never see GitHub.
- **Domain:** orbitalai.us, bought on Cloudflare.

## Where things are in the code
- `docs/BILLING.md`: payments setup and how Pro works
- `docs/EVERYDAY.md`: reminders, voice and the other everyday features
- `docs/DESKTOP.md`: desktop app, tray/background, building installers
- `docs/DEPLOY.md`: hosting a web version (only needed for a future web/sync product)
- `.github/release-notes.md`: notes to paste into the next release
- `license-server/`: the Cloudflare Worker for payments
- `site/`: the website (orbitalai.us). The `site-pricing` branch adds the Pricing section

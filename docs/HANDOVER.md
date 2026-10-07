# Handover: LB's cafe site and admin

Written 6 Oct 2026 when work moved from a Claude.ai session to Claude Code.
Repo: `github.com/kaustav1996/lbs-cafe` (public). Local copy: `~/projects/lbs-cafe`.

## 1. Where things stand

| Area | Status |
|---|---|
| Customer site design (home, record-wall menu index, menu, cart, booking, order status) | Done, reviewed with screenshots on desktop and phone |
| API (orders, payments, GST, menu, bookings, reports, staff auth, live stream) | Done, 12 end-to-end tests pass against Postgres 17 |
| Admin (live orders, POS, menu editor, bookings, reports + GST CSV, customers, settings, table QR stickers, staff) | Done, clicked through in a browser against the local API |
| Hosting | **Live on Cloudflare** at https://lbscafe.com (also https://lbs-cafe.cowork-apps.workers.dev) (one Worker: site, admin, API) since 6 Oct 2026 |
| Supabase project | `lbs-cafe` (ref `ldutsphgelixtyptfdbg`, Mumbai, Postgres 17), migrated and seeded |
| Owner logins | Sayan `lbsfrequency@gmail.com` and Kaustav `kaustavsmailbox21@gmail.com`; passwords in `api/.env` (move to a password manager) |
| Domain `lbscafe.com` (bought on Hostinger) | **DNS not pointed yet** |
| Design preview page | Live on claude.ai (Kaustav has the link). Static, no backend; uses the hash-routed `build:preview` output |

The new site isn't on the cafe's domain yet. The old Foduu site (`lbs-cafe.foduu.com`) is still what customers see.

## 2. Next steps, in order

### A. Go live
Done on 6 Oct 2026: Supabase project, Hyperdrive (`lbs-cafe-db`, caching off), Worker `lbs-cafe` deployed,
smoke test passing (`api/scripts/smoke.ts`), both owner logins created. Render and Netlify were dropped (Render
wanted a card for the always-on plan; Kaustav chose Cloudflare). Remaining:
1. ~~Domain~~ Done 6 Oct 2026: nameservers moved to Cloudflare, `lbscafe.com` and `www` are Custom Domains on the
   Worker (`routes` in `wrangler.jsonc`), smoke test passes on both. Always Use HTTPS is on (http:// redirects with a 301).
2. Auto-deploy: every push to `main` runs `.github/workflows/deploy.yml` (tests, migrate, deploy, smoke test).
   Secrets `CLOUDFLARE_API_TOKEN` and `DATABASE_URL` are set on the GitHub repo.
3. Watch CPU on the free plan: logins hash with PBKDF2 (100k iterations). If the dashboard shows
   "exceeded CPU" errors, move to Workers Paid ($5/month).
4. Smoke test on a phone: scan a printed QR (Admin → Settings → Print QR stickers), order, watch it on
   `/admin`, take a UPI payment, check Reports.

### A2. Built since go-live
- **Table codes** (7 Oct 2026, spec feature 1): each table has a 4-digit code in Admin → Settings → Tables, codes and QR.
  A guest's phone needs it once per sitting; it changes when the table's orders are all closed and paid, or with New code.
- **Multiple menus** (7 Oct 2026, spec feature 2): Admin → Menu has a menu picker. "Regular" (live) has every dish.
  New menu copies another; each dish has a stock switch and an on-this-menu switch, and "Price on <menu>" sets a
  per-menu price. Make live switches what guests and the staff order screens see.
- **1-minute hold** (7 Oct 2026, spec feature 3): guest orders wait `hold_seconds` (setting, 60; 0 turns it off;
  change with `PUT /api/admin/settings`) as `held`, with a countdown and Change order on the guest's page. Staff never
  see held orders. LiveHub's alarm releases them (next number, customer record, chime); the board and the guest page
  also release overdue ones as a backstop.
  Next from the spec: invoices, then the loyalty card.

### B. Data the cafe still owes (enter in Admin once live)
- Veg / non-veg for: Recheado Masala, Herbed Rice, Lemongrass Rice, Mexican Rice, Mix Burnt Garlic Hakka Noodles,
  Mix Schezwan Noodles, Mixed Fried Rice, and all 9 desserts (egg or eggless). They show no mark until set.
- Duplicate: "Spring Roll" (Veg ₹299) vs "Veg Spring Roll" ₹279.
- Variants the old site had but didn't list: Classic Cold Coffee, Choco Fudge Brownie, Double Choco Cookie,
  White Choco Blueberry Cookie.
- ~~GSTIN~~ set 7 Oct 2026 (19CNLPC1427M1ZS). Instagram / Facebook URLs (`web/src/data/site.ts`).
- FSSAI licence and other documents: add in Admin → Settings → Licences (upload PDF/image); shown on `/licences`.
- Real dish photos. The old site's coffee photos looked like Google Images results, so they weren't used.
- Owner said GST is 18%. Standalone restaurants usually charge 5%; worth confirming with their CA before launch.

### C. Features still missing vs the old Foduu admin (pick with the owner)
1. **Inventory and recipes** (ingredients, stock, low-stock alerts, recipe → item links). Biggest gap.
2. **Bill uses settings**: `printBill()` in `web/src/admin/Orders.tsx` hard-codes name/address/phone; it should
   read `settings.cafe` (and print GSTIN once set).
3. **Item photos**: upload to Supabase Storage from the menu editor (today it takes a URL).
4. **Reviews** after an order, **CMS** for home-page text/FAQ, **visitor analytics** (Netlify/Plausible is enough).
5. **Customer login / OTP** (old site had email OTP). Only if the owner wants loyalty; ordering works without it.
6. **Notifications**: WhatsApp/SMS for booking confirmations and takeaway-ready.
7. Small: sitemap is static; `web/src/data/site.ts` hours/GST are only fallbacks now (live values come from settings).

## 3. Decisions and why

- **Cloudflare hosting** (changed from Render + Netlify on 6 Oct 2026): one Worker serves site, admin and API on
  one origin, so no CORS or API subdomain. The API was ported from Fastify to Hono. Each request gets its own
  postgres.js client through Hyperdrive (Workers can't share sockets). The admin live feed is a hibernating
  WebSocket on the single `LiveHub` Durable Object (`idFromName('cafe')`), which also holds the per-IP rate limits.
  Hyperdrive caching is off on purpose. Migrations run from Node before deploy since Workers have no boot step.
- **Passwords** are PBKDF2-SHA256 (WebCrypto, 100k iterations, the Workers maximum) instead of bcrypt.
- **Supabase used as plain Postgres** from the API (owner role), not via supabase-js. RLS on, no policies.
- **Admin lives in the same web app** at `/admin` as a lazy chunk, so one Netlify site and one domain.
- **Money in paise, GST split CGST/SGST, rupee round-off**, matching what Indian bills show. Rates are stored on
  each order so changing the rate never rewrites old bills.
- **Customers are keyed by phone** (normalised to `+91…`), created from takeaway, counter orders and bookings.
- **Menu seed** comes from the old site's menu (scraped Oct 2026, `data/old-site-scrape.json`); 139 prices merged
  into 126 rows (veg/non-veg pairs became one item with two options). Spellings were corrected.
- **Design**: lemon yellow from the mascot, Shrikhand display + Archivo body (Google Fonts), the orange record
  wall as the menu index, a dark menu page for dim rooms, black-and-white checker strips from the floor.
  The admin is a dark utilitarian theme in the same palette.

## 4. Facts confirmed by the cafe

- Name: LB's Hemp Cafe & Lounge (from the Limon Bandits music/culture crew). Mascot: the lemon bandit.
- Address (as Google Maps lists it): Bidhan Nagar, 29 BJ, BJ Block, Sector 2, Kolkata, Bidhannagar, West Bengal 700091.
  "Get directions" links to exactly this string.
- Phone +91 98754 31882, email lbsfrequency@gmail.com.
- Hours: 10 am to 10 pm, every day. GST 18%. Payments: cash, cards, UPI.

## 5. Gotchas found along the way

- `embedded-postgres` refuses to run as root; in root containers start Postgres with `pg_ctl` as the `postgres` user
  (see `api/scripts/localdb.ts`; on a Mac `npm run localdb` works as is).
- Playwright `waitUntil: 'networkidle'` never settles on admin pages because of the SSE stream; wait for selectors.
- `pkill -f "<pattern>"` inside a shell whose own command line contains the pattern kills the shell.
- HTML `width`/`height` attributes on `<img>` need `height: auto` in CSS or `aspect-ratio` is ignored (fixed globally).
- The preview build (`--mode preview`) uses `HashRouter` and relative asset paths; production uses `BrowserRouter`
  with Netlify's SPA redirect.

## 6. Suggested first prompt in Claude Code (used 6 Oct 2026)

> Read CLAUDE.md and docs/HANDOVER.md. Then help me deploy: walk me through Supabase, Render and Netlify one step
> at a time, verify each step with curl, and update netlify.toml with the real API URL when we have it.

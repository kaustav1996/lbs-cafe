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
- **Invoices and reconciliation** (7 Oct 2026, spec feature 4, migration 007): Invoice on any order opens the bill
  for its table visit (or the order alone for takeaway/counter), numbered LB/26-27/00001 per financial year. Later
  orders join an open bill. Payments on a bill need a transaction ID for card/UPI and are spread over its orders;
  overpaying is refused everywhere. Guests get their copy at /bill/<token> (waiter drawer "The bill", or Get the bill
  on the order page). Reports → Payments lists one row per transaction with totals per method and a CSV.
- **LB's card, part 1** (7 Oct 2026, migration 008): stamps (one per paid bill a day, up to 4), the 5th-visit 50% reward
  (max ₹1,000), the 20% welcome offer for the first 420, campaign offers (Admin → Offers), one discount per bill (the
  biggest; a manager's manual discount overrides). Staff add a bill to a card by phone on the invoice. Guests see
  their card at /card; sign-in needs WhatsApp (part 2) and says "coming soon" until then. Rules in Settings → LB's card.
  Next: part 2, WhatsApp (Meta Cloud API sending, reminders, broadcasts). Needs Kaustav's Meta setup first.
- **WhatsApp webhook** (7 Oct 2026, built ahead of part 2): `https://lbscafe.com/api/whatsapp/webhook`. GET answers Meta's
  verification with Worker secret `WHATSAPP_VERIFY_TOKEN` (value in `api/.env`, pasted into Meta's webhook form). POST
  needs `WHATSAPP_APP_SECRET` (Meta app secret, set by Kaustav) and a valid `X-Hub-Signature-256`; a STOP reply opts the
  number out. Delivery statuses come with part 2.
- **Live order status** (7 Oct 2026): `web/src/lib/orderWatch.ts` checks this phone's orders (placed here, or the
  order page that's open) every 4 s while the page is visible, 15 s in the background, and stops at completed or
  cancelled. Each move pops up a notice on any page (`components/OrderAlerts.tsx`) and buzzes the phone. The order
  page also lists the phone's other orders with their status. Staff: `order.updated` now carries status, source and
  table; when an order turns ready every admin screen shows a banner (`admin/ReadyAlerts.tsx`) with a chime and Mark
  served / Picked up, and a system notification if the screen is in the background and "Turn on sound and alerts"
  was tapped (it asks for notification permission).
- **Chef and server accounts** (8 Oct 2026, migration 009): Settings → Staff has roles Chef (kitchen screen only:
  to make, preparing, ready; no prices, bills or guests), Server (the floor: orders with table or takeaway, new order,
  table calls, invoices and payments, bookings) and Manager/Owner (everything, plus a Kitchen link). Reports, offers
  and the customer list are managers only. Ready alerts go to servers and managers, not the kitchen.
- **Record player and music gear** (7 Oct 2026): 3D-tilted turntable in the home hero (`components/Gear.tsx`, Deck);
  line drawings mark the menu (turntable), orders and bills (cassette), LB's card (Walkman), booking (boombox).

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
2. ~~Bill uses settings~~ done: invoices print the cafe details and GSTIN from Settings.
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
- **Design** (redesigned 7 Oct 2026, "Ticket", mobile-first): white paper, black ink and dashed rules like a printed bill.
  Lime #D0FF00 is a highlighter (a marked phrase, the selected chip, the active tab), never body text; cyan #00BCC8 is a
  stamp (status, card stamps), with #00747C when it has to be text. Deep teal only in the footer. Shrikhand for one page
  title per page, Archivo for the rest; nothing below 14px; tap targets 44px+. Phones get a bottom bar (Menu, Order,
  Table or Book, Card) and sheets for the cart, booking and waiter; from 1000px a top bar takes over. Checked against
  impeccable.style's anti-pattern catalog (no glows, bounce, pulsing, identical card grids or repeated slogans).
  The admin keeps its own dark theme.

# Handover: LB's cafe site and admin

Written 6 Oct 2026 when work moved from a Claude.ai session to Claude Code.
Repo: `github.com/kaustav1996/lbs-cafe` (public). Local copy: `~/projects/lbs-cafe`.

## 1. Where things stand

| Area | Status |
|---|---|
| Customer site design (home, record-wall menu index, menu, cart, booking, order status) | Done, reviewed with screenshots on desktop and phone |
| API (orders, payments, GST, menu, bookings, reports, staff auth, live stream) | Done, 12 end-to-end tests pass against Postgres 17 |
| Admin (live orders, POS, menu editor, bookings, reports + GST CSV, customers, settings, table QR stickers, staff) | Done, clicked through in a browser against the local API |
| Deploy config (`render.yaml`, `netlify.toml`) | Written, **not deployed yet** |
| Supabase project | **Not created yet** |
| Domain `lbscafe.com` (bought on Hostinger) | **DNS not pointed yet** |
| Design preview page | Live on claude.ai (Kaustav has the link). Static, no backend; uses the hash-routed `build:preview` output |

Nothing is in production. The old Foduu site (`lbs-cafe.foduu.com`) is still what customers see.

## 2. Next steps, in order

### A. Go live (needs Kaustav's accounts; Claude Code can guide and verify)
1. **Supabase**: new project, region Mumbai (`ap-south-1`). Copy *Connect → Session pooler* URI with the DB password.
2. **Render**: *New → Blueprint* from this repo. Fill `DATABASE_URL`, `OWNER_EMAIL`, `OWNER_PASSWORD`.
   Plan is `starter` in `render.yaml` (free sleeps after 15 min; live orders need it awake).
   Verify: `curl https://<service>.onrender.com/health` → `{"ok":true}`; `/api/public/menu` returns 11 sections.
3. **Netlify**: import the repo; `netlify.toml` has build settings and `VITE_API_URL`. If Render's URL isn't
   `https://lbs-cafe-api.onrender.com`, update it there.
4. **DNS at Hostinger**: records Netlify shows for `lbscafe.com` + `www`; CNAME `api` → Render. Then set
   `VITE_API_URL = "https://api.lbscafe.com"` in `netlify.toml` and redeploy. `CORS_ORIGINS` on Render already
   lists `https://lbscafe.com,https://www.lbscafe.com` (and `*.netlify.app` is allowed in code).
5. Smoke test on a phone: scan a printed QR (Admin → Settings → Print QR stickers), order, watch it on
   `/admin`, take a UPI payment, check Reports.

### B. Data the cafe still owes (enter in Admin once live)
- Veg / non-veg for: Recheado Masala, Herbed Rice, Lemongrass Rice, Mexican Rice, Mix Burnt Garlic Hakka Noodles,
  Mix Schezwan Noodles, Mixed Fried Rice, and all 9 desserts (egg or eggless). They show no mark until set.
- Duplicate: "Spring Roll" (Veg ₹299) vs "Veg Spring Roll" ₹279.
- Variants the old site had but didn't list: Classic Cold Coffee, Choco Fudge Brownie, Double Choco Cookie,
  White Choco Blueberry Cookie.
- GSTIN (Admin → Settings → Bill details). Instagram / Facebook URLs (`web/src/data/site.ts`).
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

- **Split hosting**: Netlify (static site + admin) and Render (API) because Kaustav asked for both; DB on Supabase
  at his request. The API is a single instance: the live stream (`/api/auth/stream`, SSE) uses an in-process
  event bus, so **do not scale Render beyond one instance** without moving events to Postgres LISTEN/NOTIFY or Supabase Realtime.
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

## 6. Suggested first prompt in Claude Code

> Read CLAUDE.md and docs/HANDOVER.md. Then help me deploy: walk me through Supabase, Render and Netlify one step
> at a time, verify each step with curl, and update netlify.toml with the real API URL when we have it.

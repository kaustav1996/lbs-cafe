# LB's Hemp Cafe & Lounge — lbscafe.com

Website, QR table ordering and cafe admin for LB’s (29 BJ, BJ Block, Sector 2, Salt Lake, Kolkata 700091). Replaces the Foduu site.

For status, decisions and next steps see [docs/HANDOVER.md](docs/HANDOVER.md). Notes for Claude Code are in [CLAUDE.md](CLAUDE.md).

| Part | Folder | Runs on |
|---|---|---|
| Customer site + admin (`/admin`) | `web/` (Vite, React, TypeScript) | Cloudflare Worker static assets |
| API | `api/` (Hono, TypeScript) | Same Cloudflare Worker |
| Database | migrations in `api/migrations` | Supabase Postgres (via Hyperdrive) |

## What it does

**Guests** (lbscafe.com)
- Home, the record-wall menu index, full menu with search and a veg filter, live sold-out flags
- QR ordering at the table (`/menu?table=7`), takeaway orders, an order status page that updates itself
- "Call a server" for water, the bill or someone to come over
- Table booking requests

**Staff** (lbscafe.com/admin)
- Live orders board with a chime for new orders and table calls: New → Preparing → Ready → Served
- New order (POS) for walk-ins and phone orders, with table picker, discount and pay-now
- Payments by UPI, cash, card; split bills; 80 mm bill printing
- Menu: sold-out switch per item, edit prices, veg/non-veg, add items and sections
- Bookings: confirm or decline online requests, add phone bookings, assign tables
- Reports: sales, payment methods, busiest hours, best sellers, GST report with CSV download
- Customers list with CSV export
- Settings: pause online ordering or bookings, opening hours, GST rate and GSTIN, tables with printable QR stickers, staff logins (owner / manager / staff)

Money is stored in paise. GST (18%, confirmed) is split into CGST and SGST and bills are rounded to the rupee.

## Hosting

One Cloudflare Worker (`lbs-cafe`, config in `api/wrangler.jsonc`) serves the site, the admin and the API.
The database is Supabase Postgres (project `lbs-cafe`, Mumbai), reached through Cloudflare Hyperdrive with
query caching off. Live admin updates go through the `LiveHub` Durable Object over a WebSocket.

Live at https://lbs-cafe.cowork-apps.workers.dev until `lbscafe.com` is pointed at it.

## Deploy

```bash
cd api && npm install
# api/.env (gitignored) needs DATABASE_URL: the Supabase Session pooler string
npm run deploy      # runs migrations, builds web/, then wrangler deploy
BASE=https://lbs-cafe.cowork-apps.workers.dev EMAIL=... PASSWORD=... npx tsx scripts/smoke.ts
```

Set up once (already done): `wrangler login`, `wrangler hyperdrive create lbs-cafe-db --connection-string=... --caching-disabled`
(its id is in `wrangler.jsonc`), `wrangler secret put JWT_SECRET`. The first `npm run migrate` on an empty database
loads the menu, tables 1–12 and the owner login from `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_NAME`.

**Domain:** move `lbscafe.com`'s nameservers from Hostinger to Cloudflare, then add `lbscafe.com` and
`www.lbscafe.com` as Custom Domains on the Worker. The site calls the API on its own origin, so nothing else changes.

## Run locally

```bash
cd api && npm install && npm run localdb          # Postgres on :5433 (separate terminal)
DATABASE_URL=postgres://postgres:postgres@localhost:5433/lbs DATABASE_SSL=disable npm run migrate
echo 'JWT_SECRET=local-dev-secret-at-least-24-chars' > .dev.vars
npm --prefix ../web run build && npm run dev       # site, admin and API on http://localhost:8787
DATABASE_URL=.../lbs_test DATABASE_SSL=disable npm test   # 16 end-to-end tests; wipes that database
```

For hot reload on the site, run `VITE_API_URL=http://localhost:8787 npm run dev` in `web/` as well.

`web/src/data/menu.ts` is the built-in copy of the menu, used if the API can't be reached.
Rebuild it and the API seed from the old site's data with `node scripts/build-menu.mjs data/old-site-scrape.json`.

## Still to confirm with the cafe

Confirmed: opening hours 10 am to 10 pm every day; GST 18% (9% CGST + 9% SGST).

- **Veg / non-veg** for Recheado Masala, Herbed Rice, Lemongrass Rice, Mexican Rice, Mix Burnt Garlic Hakka
  Noodles, Mix Schezwan Noodles, Mixed Fried Rice, and all 9 desserts. Set them in Admin → Menu.
- **Duplicate:** "Spring Roll" (Veg ₹299) and "Veg Spring Roll" ₹279.
- **Variants** the old site had but didn't list: Classic Cold Coffee, Choco Fudge Brownie, Double Choco Cookie,
  White Choco Blueberry Cookie.
- **GSTIN** for bills (Admin → Settings), and **Instagram / Facebook** links (`web/src/data/site.ts`).
- Spellings corrected from the old menu: Caesar, Arrabbiata, Aglio Olio, Margherita, Recheado, Taco, Avocado.

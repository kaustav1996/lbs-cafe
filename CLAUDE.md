# LB's cafe — notes for Claude Code

Website, QR table ordering and admin for LB's Hemp Cafe & Lounge, Salt Lake, Kolkata. Built for a friend of the
repo owner (Kaustav). Read `docs/HANDOVER.md` for status, decisions and the next tasks.

## Layout

- `web/` — Vite + React 18 + TypeScript. Customer site and the staff admin (`/admin`, lazy-loaded). Built into the Worker's static assets.
  - `src/pages/` Home, Menu, OrderStatus. `src/components/` Chrome (nav, footer, cart bar), Panels (cart, booking, waiter drawers).
  - `src/admin/` the admin: `core.tsx` (auth, live event stream, helpers), `ui.tsx`, one file per screen.
  - `src/state/live.tsx` loads menu + settings from the API, falls back to `src/data/menu.ts` (generated).
  - `src/styles.css` customer design tokens; `src/admin/admin.css` admin styles. Plain CSS, no Tailwind.
- `api/` — Hono + TypeScript + `postgres` (porsager) on a Cloudflare Worker (`wrangler.jsonc`, entry `src/worker.ts`).
  Database is Supabase Postgres via Hyperdrive. The same Worker serves `web/dist`.
  - `src/context.ts` gives each request its own DB client; `sql` in `src/db.ts` resolves to it.
  - Public documents (licence scans) live in R2 bucket `lbs-cafe-files` (binding `FILES`), served at `/files/*`;
    `src/files.ts` checks type, magic bytes and size. Everything in that bucket is public.
  - `LiveHub` Durable Object (`src/worker.ts`): admin live feed over a hibernating WebSocket, plus rate limits.
  - `migrations/*.sql` run from Node with `npm run migrate` (part of `npm run deploy`), then `src/seed.ts` fills an empty DB.
  - `src/orders.ts` order pricing/GST/payments; `src/routes/{public,auth,admin}.ts`.
  - Menus: one master list (categories/items/item_options); `menus` + `menu_items` + `menu_prices` select dishes and
    override prices. Exactly one menu is live; guests, pricing and staff order screens use it (`menuTree('live')`).
  - LB's card: `src/loyalty.ts` (the bill's one discount, stamps on payment, linking), `src/routes/card.ts` (guest card),
    `src/messaging.ts` (WhatsApp sender; none in production yet, `CARD_CODES_IN_LOG=yes` in `.dev.vars` prints codes locally).
  - `test/flow.test.ts` end-to-end tests against a real Postgres (Hono app on Node). `scripts/smoke.ts` checks a running Worker.
- `scripts/build-menu.mjs` regenerates `web/src/data/menu.ts` and `api/seed/menu.json` from `data/old-site-scrape.json`.

## Commands

```bash
cd api && npm install
npm run build                                   # wrangler types && tsc (typecheck only)
DATABASE_URL=.../lbs_test DATABASE_SSL=disable npm test     # drops and recreates the public schema!
npm run dev                                     # wrangler dev on :8787 (needs web/dist and .dev.vars with JWT_SECRET)
npm run deploy                                  # by hand: migrate Supabase (api/.env), build web, wrangler deploy
                                                # normally a push to main deploys (.github/workflows/deploy.yml)
BASE=https://lbs-cafe.cowork-apps.workers.dev EMAIL=... PASSWORD=... npx tsx scripts/smoke.ts

cd web && npm install
npm run build                                   # tsc -b && vite build (VITE_API_URL=/ from .env.production)
npm run build:preview                           # hash-routed build used for the claude.ai preview page
```

The test suite wipes the database it points at. Only run it against a throwaway `lbs_test` database.

## Rules that matter

- Money is integer **paise** everywhere in the API and DB. The browser never sends prices; the API prices lines
  from `item_options`. GST is `gst_rate` (0.18, confirmed) on (subtotal − discount), split equally into CGST/SGST,
  total rounded to the rupee with a `round_off_paise` line. Keep `web/src/state/cart.tsx` estimates in sync with `api/src/money.ts`.
- Times: the cafe runs on Asia/Kolkata. Report day ranges use `dayRange()` in `api/src/routes/admin.ts`.
- Supabase: Hyperdrive connects through the **Session pooler** URL with caching disabled (keep it off: the live board
  must never read stale rows); `prepare: false` is set in `api/src/db.ts`. Workers can't share a DB client across requests. All tables have
  RLS enabled with no policies (`002_lock_down.sql`) so the Supabase Data API exposes nothing. Any new table needs
  the same `alter table ... enable row level security` in its migration.
- Roles: `chef` < `staff` (Server) = `server_kitchen` (Server and kitchen) < `manager` < `owner`. A chef gets the
  Kitchen screen and Menu only; the API allows a chef just the routes in `CHEF_ROUTES` (`api/src/routes/admin.ts`)
  and status moves up to ready. Only chefs, server_kitchen, managers and owners move orders to preparing/ready
  (`cooks()`); a plain server serves and bills. Servers get orders, new order, billing, bookings and settings
  (read-only); server_kitchen also gets the Kitchen screen. Reports, offers and customers need
  manager. Discounts, cancelling orders, menu edits and settings changes need manager. Chefs and servers may only
  toggle `available` (sold out) on items. Screens per role are in `NAV` (`web/src/admin/AdminApp.tsx`).
- Migrations are append-only: add `003_*.sql`, never edit an applied one.
- Copy style on the site: plain, sentence case, no ALL-CAPS labels, no middle-dot meta strings, no arrows on buttons.
  Error messages say what happened and how to fix it.
- Commit as the repo owner; end commit messages with the Co-Authored-By line the session provides.
- Passwords are PBKDF2-SHA256 via WebCrypto (`api/src/password.ts`); bcrypt is too CPU-heavy for Workers.
- Secrets live in `api/.env` (gitignored, used by `npm run migrate`) and as Worker secrets (`JWT_SECRET`). Never print them.

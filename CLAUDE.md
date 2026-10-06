# LB's cafe — notes for Claude Code

Website, QR table ordering and admin for LB's Hemp Cafe & Lounge, Salt Lake, Kolkata. Built for a friend of the
repo owner (Kaustav). Read `docs/HANDOVER.md` for status, decisions and the next tasks.

## Layout

- `web/` — Vite + React 18 + TypeScript. Customer site and the staff admin (`/admin`, lazy-loaded). Deploys to Netlify.
  - `src/pages/` Home, Menu, OrderStatus. `src/components/` Chrome (nav, footer, cart bar), Panels (cart, booking, waiter drawers).
  - `src/admin/` the admin: `core.tsx` (auth, live event stream, helpers), `ui.tsx`, one file per screen.
  - `src/state/live.tsx` loads menu + settings from the API, falls back to `src/data/menu.ts` (generated).
  - `src/styles.css` customer design tokens; `src/admin/admin.css` admin styles. Plain CSS, no Tailwind.
- `api/` — Fastify 5 + TypeScript + `postgres` (porsager). Deploys to Render; database is Supabase Postgres.
  - `migrations/*.sql` run in order at boot (`src/migrate.ts`), then `src/seed.ts` fills an empty DB.
  - `src/orders.ts` order pricing/GST/payments; `src/routes/{public,auth,admin}.ts`.
  - `test/flow.test.ts` end-to-end tests against a real Postgres.
- `scripts/build-menu.mjs` regenerates `web/src/data/menu.ts` and `api/seed/menu.json` from `data/old-site-scrape.json`.

## Commands

```bash
# API
cd api && npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5433/lbs DATABASE_SSL=disable JWT_SECRET=dev-secret-at-least-24-chars \
  OWNER_EMAIL=owner@lbscafe.com OWNER_PASSWORD=change-me npm run dev        # :8080
DATABASE_URL=.../lbs_test DATABASE_SSL=disable JWT_SECRET=... npm test      # drops and recreates the public schema!
npm run build                                                               # tsc -> dist/

# Web
cd web && npm install
VITE_API_URL=http://localhost:8080 npm run dev     # :5173, admin at /admin
npm run build                                       # tsc -b && vite build
npm run build:preview                               # hash-routed build used for the claude.ai preview page
```

The test suite wipes the database it points at. Only run it against a throwaway `lbs_test` database.

## Rules that matter

- Money is integer **paise** everywhere in the API and DB. The browser never sends prices; the API prices lines
  from `item_options`. GST is `gst_rate` (0.18, confirmed) on (subtotal − discount), split equally into CGST/SGST,
  total rounded to the rupee with a `round_off_paise` line. Keep `web/src/state/cart.tsx` estimates in sync with `api/src/money.ts`.
- Times: the cafe runs on Asia/Kolkata. Report day ranges use `dayRange()` in `api/src/routes/admin.ts`.
- Supabase: connect through the **Session pooler** URL; `prepare: false` is set in `api/src/db.ts`. All tables have
  RLS enabled with no policies (`002_lock_down.sql`) so the Supabase Data API exposes nothing. Any new table needs
  the same `alter table ... enable row level security` in its migration.
- Roles: `staff` < `manager` < `owner`. Discounts, cancelling orders, menu edits and settings need manager.
  Staff may only toggle `available` (sold out) on items.
- Migrations are append-only: add `003_*.sql`, never edit an applied one.
- Copy style on the site: plain, sentence case, no ALL-CAPS labels, no middle-dot meta strings, no arrows on buttons.
  Error messages say what happened and how to fix it.
- Commit as the repo owner; end commit messages with the Co-Authored-By line the session provides.

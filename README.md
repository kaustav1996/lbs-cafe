# LB's Hemp Cafe & Lounge — lbscafe.com

Website, QR table ordering and cafe admin for LB's (BJ-29, Salt Lake, Kolkata). Replaces the Foduu site.

| Part | Folder | Runs on |
|---|---|---|
| Customer site + admin (`/admin`) | `web/` (Vite, React, TypeScript) | Netlify |
| API | `api/` (Fastify, TypeScript) | Render |
| Database | migrations in `api/migrations` | Supabase Postgres |

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

## Deploy (first time)

1. **Supabase.** Create a project in the Mumbai region. Open *Connect* and copy the **Session pooler**
   connection string (it works from Render; the direct one is IPv6-only). Put your database password in it.
2. **Render.** *New → Blueprint*, pick this repo. It reads `render.yaml` and asks for:
   - `DATABASE_URL`: the Supabase string from step 1
   - `OWNER_EMAIL`, `OWNER_PASSWORD`: the first admin login
   
   On first boot the API creates the tables, loads the menu, adds tables 1–12 and the owner login.
   Check `https://lbs-cafe-api.onrender.com/health` shows `{"ok":true}`.
3. **Netlify.** *Add new site → Import from GitHub*, pick this repo. `netlify.toml` sets everything.
   If Render gave the API a different URL, change `VITE_API_URL` in `netlify.toml`.
4. **Domain (Hostinger).** In Netlify, add `lbscafe.com` under Domain management; it lists the DNS records.
   In Render, add `api.lbscafe.com` as a custom domain; it gives a CNAME. Add both in Hostinger's DNS
   zone editor, then set `VITE_API_URL = "https://api.lbscafe.com"` in `netlify.toml`.
5. Sign in at `lbscafe.com/admin`, print the table QR stickers from Settings, and add staff logins.

Render's free plan sleeps after 15 idle minutes, so the blueprint uses the Starter plan to keep live orders instant.

## Run locally

```bash
# API (needs a Postgres; any local one works)
cd api && cp .env.example .env && npm install
npm run dev                       # http://localhost:8080
DATABASE_URL=... DATABASE_SSL=disable JWT_SECRET=... npm test   # 12 end-to-end tests

# Site + admin
cd web && npm install
VITE_API_URL=http://localhost:8080 npm run dev   # http://localhost:5173 and /admin
```

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

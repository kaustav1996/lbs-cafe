# LB's Hemp Cafe & Lounge — lbscafe.com

New website and cafe management app for LB's (Salt Lake, Kolkata), replacing the Foduu site at lbs-cafe.foduu.com.

## What's here

```
web/        Customer site (Vite + React + TypeScript). Deploys to Netlify.
  src/data/menu.ts   The full menu: 11 sections, 126 rows, 139 prices (generated)
  src/data/site.ts   Address, phone, hours, GST rate, social links
  public/img/        Cafe photos and the Limon Bandit mascot, web-sized
scripts/build-menu.mjs   Rebuilds menu.ts: node scripts/build-menu.mjs data/old-site-scrape.json
data/old-site-scrape.json  Everything scraped from the old Foduu site + admin screenshots
netlify.toml        Netlify build + SPA redirects
```

Coming next: `api/` (Node + Postgres on Render) and the admin (orders, POS, menu editor,
inventory, reservations, GST report, customers, reviews, CMS).

## Run it

```bash
cd web
npm install
npm run dev            # http://localhost:5173
npm run build          # production build in web/dist
npm run build:preview  # hash-routed build in web/dist-preview for sharing as a single page
```

Table QR codes should point at `https://lbscafe.com/menu?table=<number>`. That sets the table on the order
and shows a "Call a server" button.

## Deploy plan

| Piece | Host | Domain |
|---|---|---|
| Customer site + admin | Netlify (from this repo, `netlify.toml`) | lbscafe.com, www.lbscafe.com |
| API + database | Render web service + Render Postgres | api.lbscafe.com |

DNS stays at Hostinger. When you add the domain in Netlify and Render, each shows the exact records to
create; add those in Hostinger's DNS zone editor (apex + `www` for Netlify, a CNAME for `api` to Render).

## To confirm with the cafe

Confirmed: opening hours 10 am to 10 pm every day; GST 18% (9% CGST + 9% SGST).

- **Veg / non-veg** for: Recheado Masala, Herbed Rice, Lemongrass Rice, Mexican Rice, Mix Burnt Garlic Hakka
  Noodles, Mix Schezwan Noodles, Mixed Fried Rice, and all 9 desserts (egg or eggless?). These show no mark
  until confirmed.
- **Duplicates:** "Spring Roll (Veg)" ₹299 and "Veg Spring Roll" ₹279 are both on the menu.
- **Variants** the old site had but didn't list: Classic Cold Coffee, Choco Fudge Brownie, Double Choco Cookie,
  White Choco Blueberry Cookie.
- **Instagram / Facebook links** (hidden until filled in `site.ts`).
- Spellings corrected from the old menu: Caesar, Arrabbiata, Aglio Olio, Margherita, Recheado, Taco, Avocado.

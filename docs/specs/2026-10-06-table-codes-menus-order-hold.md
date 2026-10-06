# Table codes, multiple menus, the 1-minute order hold, and invoices

Agreed with Kaustav on 6 Oct 2026. Four features, built in this order. Features 1–3 share migration `004`;
feature 4 has its own migration `005` and can ship after them.

1. **Table codes**: a 4-digit code per table that a guest gets from their server before their first QR order.
2. **Multiple menus**: named selections from the master dish list, with optional per-menu prices; one menu is live.
3. **Order hold**: customer orders wait 1 minute before reaching the kitchen, so the guest can change them.
4. **Invoices and reconciliation**: one numbered invoice per table visit (or per takeaway/counter order), shown to
   staff and guests; payments carry the POS/UPI transaction ID; a Payments view for reconciliation. Built so a POS
   webhook can later match payments by invoice number.

Rules from `CLAUDE.md` apply throughout: money in paise, the API prices everything, RLS on every new table,
append-only migrations, sentence-case copy, error messages that say what happened and how to fix it.

---

## 1. Table codes

### Behaviour

- Each table has a current **code** (4 random digits) and a **sitting** number.
- Every signed-in admin user (owner, manager, staff) sees each table's code on Settings → Tables, with a
  **New code** button. Customers never see codes.
- A customer ordering from a table (`mode: 'table'`) must hold a valid **table pass** for that table's current
  sitting. Without one, the order is refused and the site asks for the code.
- Entering the right code gives the phone a pass. It keeps working for that table until the sitting changes.
- The sitting changes (new code, sitting + 1, old passes stop working):
  - **automatically**, when the table becomes **free**. A table is free when it has no order matching any of:
    1. `status = 'held'`;
    2. `status in ('new', 'preparing', 'ready', 'served')`;
    3. `status = 'completed' and payment_status <> 'paid' and created_at > now() - interval '2 days'`
       (same 2-day bound as the open board, so a forgotten unpaid bill can't block rotation forever).
  - **manually**, when any staff user taps **New code**.
- One helper, `freeTableCheck(tx, tableLabel)` in `orders.ts`, rotates the sitting only when the change **turns the
  table from busy to free**: callers check whether the table was busy before the change, and the helper rotates only if
  it was busy and is now free. A late edit to an old, already-settled bill (e.g. a discount on yesterday's paid order)
  therefore never rotates the code under a new party that has just been given it. It runs inside the same transaction
  after every change that can free a table: status change (`PATCH /api/admin/orders/:id`), `addPayment`, `recalc`
  callers (discounts, line edits), and moving an order to another table (checked for the old table).
- Takeaway orders don't use codes. Orders placed by staff (`/api/admin/orders`) don't use codes.
- Waiter calls (`/api/public/service-requests`) don't need a code, as today.

### Tables admin

Settings → Tables becomes a list: label, seats (editable), on/off, current code, **New code**. "Add a table" takes a
label and seats. Editing seats, adding and switching tables on/off stay manager-only (as today); viewing codes and
**New code** are open to all staff. The QR stickers are unchanged (`/menu?table=<label>`).

Launch data: Sayan has 5 tables. After deploy, switch tables 6–12 off from the admin (not deleted; old orders
reference them by label).

### API

- `POST /api/public/tables/:label/verify` body `{ code }` →
  `200 { pass }` or `400 { error: 'bad_code', message: "That code doesn't match table 3. Check it with your server." }`.
  Unknown or switched-off table: `400 bad_table` (existing message). Rate limit: 5 tries per 10 minutes per IP *and
  table label* (guests on the cafe Wi-Fi share one IP, so a per-IP-only limit could lock out the whole room).
- The pass is an HS256 JWT signed with `JWT_SECRET`: `{ kind: 'table', table: '<label>', sitting: <n> }`, 12-hour expiry.
  `requireStaff`/`verifyToken` reject any token carrying `kind`, so a pass can never act as a staff token; the pass
  check requires `kind === 'table'`.
- The order placement rate limit (12 per 10 minutes) is keyed per IP *and* table label for table orders (per IP for
  takeaway), for the same shared-Wi-Fi reason.
- `POST /api/public/orders` with `mode: 'table'` takes `pass` in the body. The API checks the pass signature,
  `kind`, `table` equals the order's table, and `sitting` equals the table's current sitting. Otherwise:
  `403 { error: 'table_code', message: "Ask your server for table 3's code, then place the order again." }`.
- `GET /api/admin/tables` adds `otp` and `sitting` to each row (all staff).
- `POST /api/admin/tables/:id/new-code` (all staff) → new code, sitting + 1, returns the table.
- `PATCH /api/admin/tables/:id` keeps `seats`/`active` (manager).
- Event `table.updated` `{ id }` on any code change, so open admin screens refresh the codes.

### Web

- On **Place order** for a table order: send the stored pass (localStorage key `lbs.tablePass.<label>`).
  On `table_code`, open a small dialog: "Ask your server for table 3's code" with a 4-digit input. On success store
  the pass and resend the order automatically. Wrong code shows the API message inline.
- Settings → Tables card as described above, refreshing on `table.updated`.

---

## 2. Multiple menus

### Behaviour

- The master list (categories, items, item_options with their normal `price_paise`) stays as is.
- A **menu** has a name and contains a set of items. For any option (size/variant) of an included item it may
  set a **price override**; with no override the option's normal price applies.
- Exactly one menu is **live**. The public menu, QR ordering, and staff orders (POS and adding lines) all use the
  live menu: only its items, at its prices.
- A section (category) appears on a menu only if at least one of its items is on that menu (no per-menu section setup).
- **Sold out** (`items.available`) and hiding a dish/section everywhere (`active`) stay global.
- Ordering an item that isn't on the live menu is refused with the existing `409 item_gone` message
  ("Something in the order is no longer on the menu. Refresh the menu and try again.").
- Switching menus never changes past orders (lines already store name and unit price).
- No scheduled switching. Staff switch with **Make live**.

### Admin, Menu screen

- A menu picker at the top lists menus; the live one is marked "Live".
- **New menu**: name + "copy from" (any existing menu). The copy includes its items and price overrides.
- **Make live**, **Rename**, **Delete** (refused for the live menu: "Make another menu live before deleting this one.").
- For the selected menu, every dish shows an **On this menu** switch, and each option shows its normal price with an
  optional override field (empty = normal price).
- **Add dish** adds the new dish to the master list and to the selected menu.
- Existing dish/section editing (names, normal prices, veg marks, sold out) is unchanged.
- Viewing is open to all staff; every change here is manager-only, like menu edits today.

### API

- `menuTree(false)` (public) returns only items on the live menu, each option's `price_paise` being the override
  if set, else the normal price. `menuTree(true)` (admin) is unchanged: the full master list.
- `priceLines` joins the live menu and uses `coalesce(override, normal price)`; items not on the live menu → `item_gone`.
- `GET /api/admin/menus` → `[{ id, name, live, items: <count> }]`.
- `GET /api/admin/menus/:id` → `{ id, name, live, itemIds: number[], prices: { [optionId]: paise } }`.
- `POST /api/admin/menus` `{ name, copyFrom?: id }` (manager). Name 1–40 chars, unique (`409` "There's already a menu called …").
- `PATCH /api/admin/menus/:id` `{ name?, live?: true }` (manager). Making one live un-lives the other in one transaction.
- `DELETE /api/admin/menus/:id` (manager), `409 live_menu` for the live one.
- `PUT /api/admin/menus/:id/items/:itemId` `{ on: boolean, prices?: { [optionId]: paise | null } }` (manager).
  `on: false` removes the item and its overrides from that menu. Price overrides must belong to that item's options.
- `POST /api/admin/items` accepts optional `menuId`; the new item is added to that menu (default: the live menu).
- `GET /api/admin/menu/live` (all staff): the live menu for the staff order picker (New order, Add items): only items on
  the live menu, at live prices, **including** sold-out items (staff may still order them, as today), each with its
  `available` flag. `web/src/admin/picker.tsx` (`useAdminMenu`) switches to this endpoint. `GET /api/admin/menu` stays
  the full master list for the menu editor.
- Every change publishes `menu.updated` (existing event).

### Web (customer)

The customer site has no live connection. It re-fetches the menu when the tab becomes visible again, every
2 minutes while open, and immediately after an order is refused with `item_gone`.

---

## 3. Order hold (1 minute)

### Behaviour

- Every order placed through `POST /api/public/orders` (table or takeaway) is created **held** for
  `hold_seconds` (setting, default 60; 0 disables holding). Staff orders are never held.
- While held: the order has no number, isn't on any admin screen, isn't in reports, customers or GST exports,
  and can't be paid or edited by staff.
- The guest's confirmation screen shows the order, total and "Sending to the kitchen in 0:47", counting down
  from the server's remaining seconds, plus **Change order**.
- **Change order** withdraws the order (it's deleted with its lines) and puts the lines back in the cart, opening the
  menu with the cart showing. Placing it again creates a new held order (a fresh minute). A table order needs its
  pass again, which the phone still holds.
- When the hold ends the order is **released**: it gets the next order number, status `new`, `created_at` = release
  time (so kitchen timers count from arrival), its customer record is created/updated (`upsertCustomer` moves from
  placement to release, so a withdrawn takeaway leaves no customer row), and `order.created` is published (the admin
  chimes as today). The guest's screen switches to the normal status view.
- If **Change order** arrives once `hold_until <= now()` (released or not yet released): `409 { error: 'too_late', message: "Too late to change this one: the
  kitchen has it. Ask your server and they can change it." }`. Nothing changes.
- Withdrawn orders leave no trace, so order numbers stay consecutive.

### Release mechanism

- `releaseDue()` (in `orders.ts`), in a transaction: select due orders (`status = 'held' and hold_until <= now()`)
  `order by hold_until for update skip locked`; for each in that order assign `number = nextval('order_number_seq')`,
  `status = 'new'`, `created_at = now()`, `updated_at = now()`, upsert the customer and set `customer_id`; then publish
  `order.created` for each. Concurrent releasers never touch the same row; if two run at once, numbers may be very
  slightly out of `hold_until` order, which is accepted.
- Withdraw locks the order `for update` and only deletes it while `status = 'held' and hold_until > now()`.
- Called from:
  - the `LiveHub` Durable Object **alarm**: placing a held order calls `runtime().scheduleRelease(holdUntil)`, an RPC
    to the hub, which sets its alarm if there is none or the existing one is later (`getAlarm()`). In `alarm()` the hub
    creates its own Hyperdrive client and runs `releaseDue()` inside `withRuntime(...)` with a Runtime whose `publish`
    writes straight to its sockets, ends the client, then re-arms for the earliest remaining held order if any;
  - lazily, at the start of `GET /api/admin/orders` and `GET /api/public/orders/:token` (backstop if an alarm is late).
- `Runtime` gains `scheduleRelease(at: Date): void` (Node tests: no-op).

### API

- `POST /api/public/orders` → `201 { token, order }` where `order.status` is `'held'`, `order.number` is `null`,
  and `order.holdSecondsLeft` is set.
- `GET /api/public/orders/:token` → same shape; `holdSecondsLeft` while held (after a lazy release check).
- `POST /api/public/orders/:token/withdraw` → `200 { lines: [{ itemId, optionId, qty }] }` if still held, else `409 too_late`.
  Rate limit: its own, 20 per 10 minutes per IP (not shared with placement, so a change-and-replace cycle doesn't
  burn the order limit).
- Admin queries exclude `held`: open board (already filtered by status list), day view, `GET /orders/:id`
  (404 while held), payments/edits on a held order (`409` "This order hasn't reached the kitchen yet."),
  reports summary, GST export, customers counts.
- `PUT /api/admin/settings` accepts `hold_seconds` (0–300, manager). Not shown in the admin UI.

### Web (customer)

`OrderStatus` page: while `held`, show countdown + **Change order**; poll the order every 5 s and when the countdown
reaches 0, so it flips to the released view. On withdraw, rebuild the cart from the returned lines (matched against the
current menu; anything no longer on it is dropped with a note) and navigate to `/menu` with the cart open.

---

## 4. Invoices and reconciliation

### Behaviour

- **Scope.** A table invoice covers one sitting (feature 1): every order from that table and sitting that isn't
  `held` or `cancelled`. Takeaway and counter orders get one invoice each.
- **Number.** Assigned when the invoice is first generated: `LB/<yy>-<yy+1>/<5-digit serial>` (e.g. `LB/26-27/00001`),
  consecutive with no gaps within an Indian financial year (1 April to 31 March, Asia/Kolkata), restarting each year.
  Numbers come from a per-year counter row updated inside the creating transaction.
- **Contents** (same for staff and guests): cafe name, address, phone, email and GSTIN from `settings.cafe` (GSTIN
  line omitted while empty); invoice number; date/time; table or "Takeaway"/"Counter"; lines merged across its orders
  by (item, option) with qty, unit price and amount; subtotal, discount, CGST and SGST (each with its rate), round-off
  and total, all summed from the orders' stored values; payments (time, method, amount, transaction ID); balance due;
  a "Paid" mark once settled. Guests never see staff names or phone numbers.
- **Balance.** An invoice's balance is the sum of `greatest(total_paise - paid_paise, 0)` over its non-cancelled orders.
- **Open vs paid.** One helper, `settleInvoiceCheck(tx, invoiceId)` in `orders.ts`, marks an `open` invoice `paid`
  (`paid_at` set) when it has at least one non-cancelled order and its balance is 0. It runs after: invoice creation
  (so a bill whose orders were all prepaid is born paid), invoice payments, an order joining, an order being cancelled,
  and every `recalc` caller (discounts, line edits). A paid invoice never reopens.
  - **Joining.** An order joins its table sitting's open invoice (same number, totals update) at the moment it first
    becomes visible to staff: staff creation, public creation when `hold_seconds` is 0, or release from hold.
    `releaseDue` publishes `invoice.updated` for each join.
  - At most one open invoice per (table, sitting). After it's paid, later orders in the same sitting have no invoice
    until one is generated again (a new number).
  - **Locked orders.** For an order on a **paid** invoice, these are refused with
    `409 { error: 'invoiced', message: "This order is on paid invoice LB/26-27/00001, so it can't be changed." }`:
    cancelling, discounting, adding/changing/removing lines, moving it to another table, and payments.
    **Status moves forward are still allowed** (`new` → … → `served` → `completed`), so staff can close orders after
    the guest pays and the table becomes free (feature 1).
  - **Moving tables.** An order that is on any invoice (open or paid) can't be moved to another table:
    `409 { error: 'invoiced', message: "This order is on invoice LB/26-27/00001. Move it before generating the bill." }`.
  - Cancelled orders on an open invoice simply drop out of its totals.
- **Sitting stamp.** `orders.sitting` is the table's sitting when the order was placed and is kept at release, so a
  held order from a group whose code was reset with **New code** still bills to that group's sitting.
- **Generating.**
  - Staff: **Invoice** on an order (board card and order detail) opens the invoice for that order's table sitting
    (or the order itself for takeaway/counter), creating it if needed. Shown on screen with **Print**.
    This replaces `printBill()` in `web/src/admin/Orders.tsx`.
  - Guest at a table: **Get the bill** (the existing "Ask for the bill" button in the waiter drawer) first raises the
    `bill` waiter call (always, deduplicated as today, even if billing then fails), then generates or fetches the
    invoice using the phone's table pass and opens it at `/bill/<token>`. No pass: the table-code dialog from feature 1. Nothing released yet:
    `400 { error: 'nothing_to_bill', message: "There's nothing on table 3's bill yet." }`.
  - Takeaway guest: **Get the bill** on the order status page (by order token) once the order is released.
- **Payments.** Recorded on the invoice in the admin: amount (defaults to the balance due), method
  (cash / UPI / card / other), transaction ID.
  - The transaction ID is **required for card and UPI** (trimmed, 1–60 chars):
    `400 { error: 'no_reference', message: 'Add the transaction ID from the card slip or UPI app.' }`.
    The same rule applies to the existing per-order payment endpoint and POS order payments.
  - More than the balance due: `400 { error: 'overpaid', message: "That's more than the ₹840 still due." }`.
    This applies to per-order payments too (today they accept overpayment); cash change is not recorded as revenue.
  - **POS pay-now.** When a staff POS order with `payment` joins an open table invoice, the payment is recorded
    through that invoice in the same request (same rules: transaction ID, overpaid). Otherwise it's a per-order
    payment, as today. `web/src/admin/Pos.tsx` gains the transaction ID field (required for card/UPI).
    POS pay-now sends no amount: the server pays the balance due (the order's server total, or the invoice balance
    when it joined one), so a gap between the browser's estimate and the server total can't fail it.
  - **Concurrency.** Joining an invoice and `settleInvoiceCheck` run inside the same transaction as `createOrder` and
    `releaseDue`; invoice payments lock the invoice row (`for update`) before allocating.
  - One invoice payment is split across the invoice's orders oldest first, each order taking up to its own balance,
    as ordinary `payments` rows sharing one `txn_group` and the `invoice_id`, so order `paid_paise`/`payment_status`,
    the live board, reports and the free-table rule (feature 1) keep working unchanged. `freeTableCheck` runs after.
  - An order that is on an invoice can only be paid through the invoice:
    `409 { error: 'use_invoice', message: 'Record this payment on invoice LB/26-27/00001.' }`.
    Orders with no invoice can still be paid per order, as today.
- **Reconciliation.** Reports gets a **Payments** tab: date range (Kolkata days, `dayRange()`), method filter, search
  (transaction ID or invoice number). One row per transaction (`txn_group`, or the single payment row for
  per-order payments): time, invoice number (if any), table or order numbers, method, amount, transaction ID,
  recorded by. Totals per method for the range. CSV download. Visible to all staff, like the other reports.
- **POS webhook (later, not built now).** The invoice number is the match key; waiters may type it into the card
  machine's reference field. A future webhook can find the invoice by number and record or confirm the payment.
  Nothing in this spec depends on it.

### API

- `POST /api/admin/invoices` `{ orderId }` → `{ invoice }` (find or create, as above; all staff). 404 for held orders.
- `GET /api/admin/invoices/:id` → `{ invoice }` (full view incl. staff names on payments).
- `POST /api/admin/invoices/:id/payments` `{ method, amountPaise, reference? }` → `{ invoice }`; `409` if already paid.
- `POST /api/public/tables/:label/bill` `{ pass }` → `{ token }` (rate limited per IP + table, 10 per 10 minutes).
- `POST /api/public/orders/:token/bill` → `{ token }` (takeaway; `nothing_to_bill` while the order is held).
- `GET /api/public/invoices/:token` → `{ invoice }` (guest view).
- `GET /api/admin/reports/payments?from&to&method?&search?&format=json|csv`.
- Events: `invoice.updated { id }` (added to the `CafeEvent` union in `api/src/events.ts`) on creation, orders
  joining, payments and settlement (admin screens refresh).
- `GET /api/admin/reports/gst` gains an **Invoice** column (blank for orders never invoiced). Invoices are the
  consecutive series; orders paid per order without an invoice keep only their order number.

### Data (migration `005_invoices.sql`)

- `invoice_counters (fy text primary key, last int not null default 0)`.
- `invoices (id serial pk, number text not null unique, fy text not null, token text not null unique,
  source text not null check (source in ('table','takeaway','counter')), table_label text, sitting int,
  status text not null default 'open' check (status in ('open','paid')), created_by int references staff,
  created_at timestamptz not null default now(), paid_at timestamptz)`, plus
  `create unique index invoices_one_open on invoices (table_label, sitting) where status = 'open' and source = 'table'`.
- `orders`: add `sitting int` (the table's sitting when the order was placed; null for takeaway/counter) and
  `invoice_id int references invoices`. Feature 1's order placement stamps `sitting` (staff table orders stamp the
  table's current sitting too). Backfill: table orders that are open, or completed and unpaid, get their table's
  current sitting, so orders placed between the `004` and `005` deploys can still be billed.
- `payments`: add `invoice_id int references invoices`, `txn_group uuid not null default gen_random_uuid()`, and
  `check (method in ('cash','other') or length(trim(coalesce(reference, ''))) > 0) not valid` (enforced for new rows).
- RLS enabled on `invoices` and `invoice_counters`.

### Web

- Admin: `InvoiceView` (screen + print) opened from **Invoice** buttons; payment form with the transaction ID field
  shown and required for card/UPI; Reports → **Payments** tab; the per-order payment box and the POS (`Pos.tsx`)
  gain the transaction ID field.
- Customer: `/bill/:token` page (same layout, print-friendly); **Get the bill** in the waiter drawer and on takeaway
  order status.

### Tests

- A table invoice covers all released, non-cancelled orders of the sitting; a later order joins it; a held order
  doesn't; numbers are consecutive (`LB/26-27/00001`, `…00002`) and the financial year is computed in Kolkata time.
- Card payment without a transaction ID → `no_reference`; overpaying → `overpaid` (invoice and per-order); a payment
  splits across orders oldest first and marks the invoice paid; completing the orders then frees the table and
  rotates its code (feature 1); forward status moves on a paid invoice's orders are allowed.
- An invoice whose orders were all prepaid is created `paid`; cancelling the last unpaid order settles an open invoice.
- A staff table order joins the open invoice; POS pay-now on it records through the invoice; moving an invoiced
  order to another table → `invoiced`.
- Per-order payment on an invoiced order → `use_invoice`; editing an order on a paid invoice → `invoiced`.
- Guest bill needs a valid pass; guest view hides staff names; takeaway bill by order token.
- Payments report: one row per transaction, totals per method equal the payments recorded, CSV has the same rows.

## Migration `004_table_codes_menus_hold.sql`

- `dining_tables`: add `otp text not null default lpad(floor(random() * 10000)::int::text, 4, '0')`,
  `sitting int not null default 1`.
- `orders`: replace the status check to include `'held'`; add `hold_until timestamptz`; `number` drops `not null` but
  **keeps its default** (so the Worker still running during a deploy, which migrates first, keeps numbering orders).
  Held inserts pass `number = null` explicitly; release assigns `nextval`. Unique still holds.
- `menus (id serial pk, name text not null unique, live boolean not null default false, created_at timestamptz default now())`
  plus `create unique index menus_one_live on menus (live) where live`.
- `menu_items (menu_id int references menus on delete cascade, item_id int references items, primary key (menu_id, item_id))`.
- `menu_prices (menu_id int references menus on delete cascade, option_id int references item_options,
  price_paise int not null check (price_paise >= 0), primary key (menu_id, option_id))`.
- Insert menu "Regular" (live) containing every existing item.
- `alter table … enable row level security` on `menus`, `menu_items`, `menu_prices`.
- `seed.ts`: on an empty database (items seeded after migrations), add the seeded items to the live menu, creating
  "Regular" if no menu exists. Default setting `hold_seconds: 60`.

## Testing

End-to-end (`api/test/flow.test.ts`). Existing tests that expect a public order on the board run with
`hold_seconds: 0`; hold tests set it to 1 and wait.

- Table codes: order without pass → `table_code`; wrong code → `bad_code`; right code → pass → order accepted;
  pass for another table refused; a pass used as a staff bearer token is refused; completing and paying the table's last order changes the code and the old pass
  is refused; **New code** does the same; codes visible to a `staff` user.
- Menus: new menu copied from Regular; remove an item and override a price; make it live; public menu shows only its
  items at the override price; ordering a removed item → `item_gone`; order total uses the override; can't delete the
  live menu; staff can't edit menus.
- Hold: placed order is `held` with no number and absent from the board, reports and day view; withdraw returns
  the lines and deletes the order; after the hold, a lazy release gives it the next number and `order.created`;
  withdraw after release → `too_late`; staff orders are never held; numbers stay consecutive across a withdrawal;
  a withdrawn takeaway leaves no customer row.
- Staff picker: `GET /api/admin/menu/live` lists only live-menu items at override prices, including sold-out ones.

`scripts/smoke.ts` (production-safe): verify endpoint refuses a wrong code for table 1 (no order created).

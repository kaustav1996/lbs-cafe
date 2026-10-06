# LB's card: stamps, rewards, offers, WhatsApp reminders and broadcasts

Agreed with Kaustav on 6 Oct 2026 (idea from a reel; rules from the cafe). Builds on
`2026-10-06-table-codes-menus-order-hold.md`, especially feature 4 (invoices) and feature 1 (table passes).
Ships after those, as migration `006_loyalty.sql`. Rules from `CLAUDE.md` apply: paise, the API decides every price
and discount, RLS on every new table, append-only migrations, plain sentence-case copy.

## Rules (from the cafe)

- **Stamps**: one per fully paid bill linked to a card, at most one per customer per Kolkata day. A card holds at most
  **4** stamps.
- **Reward**: with 4 stamps, the next visit gets **50% off the whole bill, at most ₹1,000 off**. That visit earns no
  stamp; the card resets to 0. So visits 1–4 earn stamps, visit 5 is rewarded, 6–9 earn, 10 is rewarded, and so on.
- **Welcome offer**: **20% off** the customer's first paid visit on the card, for the **first 420 customers** only.
  That visit also earns stamp 1.
- **Campaign offers**: a percentage off the whole bill or off chosen menu sections, for a date range, for everyone or
  card members only.
- **One discount per bill**: the one worth the most in rupees wins. Ties prefer, in order: campaign offer, welcome,
  reward (so stamps and the welcome offer are kept when possible). If the reward loses, the 4 stamps stay.
- **Reminders**: opted-in customers away 14 days get a WhatsApp reminder, repeated every 14 days while they stay away,
  up to 6 reminders since their last visit.
- Google review and Instagram are plain links. Nothing is ever conditional on them (Google forbids incentivised reviews).

All numbers above are settings (see Data), defaulting to these values.

## 1. Customer identity and the card page

### Behaviour

- `lbscafe.com/card`, also reached from a **Collect stamps** banner on the menu page.
- Sign-in: name, phone, and an unticked checkbox "Send me offers and reminders on WhatsApp". A 6-digit code is sent by
  WhatsApp (template `lbs_login_code`); entering it signs the phone in for 90 days.
  - Codes expire after 10 minutes, 5 wrong tries per code, at most 3 codes per phone per 10 minutes and 10 per IP.
  - Wrong code: "That code doesn't match. Check the latest WhatsApp message from LB's."
  - Phones are normalised with `normalisePhone()` (existing); the customer row is the existing `customers` row for that
    phone, created if missing. Sign-in sets `verified_at`; the checkbox sets `opted_in`/`opted_in_at`.
- Card page: stamps (4 circles), "Your next visit: 50% off, up to ₹1,000" when 4, the welcome offer while available to
  them, current offers (active, for everyone or members), **See the menu**, **Review us on Google**,
  **Follow us on Instagram** (URLs from settings, hidden if empty), **Stop WhatsApp messages** / opt back in,
  **Delete my details** (confirm dialog).
- **Delete my details**: removes the customer row and their codes, messages and stamp history; on their orders sets
  `customer_id`, `customer_name`, `customer_phone` to null; on their reservations sets `customer_id` to null,
  `name` to 'Deleted' and `phone` to '' (both columns are `not null`); on invoices sets `customer_id` to null. Paid
  bills keep their amounts. The card session ends; any card token whose customer row no longer exists gets `401`.
- **Before WhatsApp is live** (no provider configured): sign-in shows "Card sign-in is coming soon. Ask your server to
  add today's bill to your LB's card." Waiter linking (below) works regardless.

### Linking a bill to a card

- Guest: on `/bill/<token>` (and the takeaway order page), a signed-in guest sees **Add to my LB's card**.
- Waiter: on an invoice in the admin, a phone field (+ optional name) links the bill to that customer (creating the
  customer row if needed, no code). Any staff role. A linked customer can be removed or replaced the same way.
- A bill already linked to a different customer:
  `409 { error: 'linked', message: "This bill is already on another LB's card." }` for guests; staff may replace
  (only while the invoice is not frozen, see section 2).
- **Before any payment** (invoice not frozen): linking or unlinking runs the discount calculation (section 2).
- A paid invoice settled more than 24 hours ago can't be linked:
  `409 { error: 'too_old', message: "This bill was paid more than a day ago, so it can't go on a card now." }`.
- **After payment started** (frozen, or already `paid` within the last 24 hours): linking is still allowed but is
  **stamp-only**: no discount is applied or changed. If the invoice is already paid, the stamp rule (section 2,
  "When the bill is paid") runs at once. Unlinking a frozen invoice is refused:
  `409 { error: 'frozen', message: "Payment has started on this bill, so its LB's card can't be removed." }`.
- Linking sets `orders.customer_id` on all of the invoice's orders to the card holder.
- Orders paid one by one with no invoice earn no stamp; staff generate the invoice (feature 4) and link it, which then
  counts as a paid invoice for the stamp rule.

### API

- `POST /api/public/card/code` `{ phone, name, optIn }` → `204`; `503 { error: 'card_off' }` with the coming-soon text
  when no provider is configured.
- `POST /api/public/card/verify` `{ phone, code }` → `{ token }`: HS256 JWT `{ kind: 'customer', sub: <customer id> }`,
  90 days. `requireStaff` already rejects tokens with `kind` (spec 1).
- `GET /api/public/card` (Bearer customer token) → `{ name, phone, stamps, rewardReady, welcomeAvailable, offers,
  links: { google, instagram }, optedIn }`.
- `PATCH /api/public/card` `{ optIn: boolean }`; `DELETE /api/public/card` (delete my details).
- `POST /api/public/invoices/:token/link` (Bearer customer token) → `{ invoice }`.
- `PUT /api/admin/invoices/:id/customer` `{ phone, name? }` or `{ phone: null }` → `{ invoice }` (all staff).

## 2. Stamps, rewards and the bill discount

### Discount calculation

`applyInvoiceDiscount(tx, invoiceId)` in `api/src/loyalty.ts`. Runs when a customer is linked or unlinked, when an
order joins, when lines/cancellations change the invoice's orders, and when an offer is created, edited, paused or
ended (for open, unfrozen invoices; an offer change recalculates each affected invoice in **its own transaction**, so
customer locks are never held across invoices). Afterwards it publishes `invoice.updated`.

**Frozen**: an invoice is frozen once any of its non-cancelled orders has `paid_paise > 0` (whether paid through the
invoice or one by one before it existed). A frozen invoice is never recalculated: joining orders get no automatic
discount, links are stamp-only, and manual discount changes are refused with
`409 { error: 'frozen', message: "Payment has started on this bill, so its discount can't change." }`.

**Locks** (in this order, inside the transaction): the customer row (`for update`, when one is linked), then
`pg_advisory_xact_lock(hashtext('lbs.welcome'))` when the welcome candidate is evaluated. This makes the 420 count and
"one reward per card at a time" safe under concurrency.

1. Base: the invoice's non-cancelled orders' lines (`order_lines.line_paise`), before GST.
2. Candidates:
   - **Reward**: customer linked, `stamps = reward_stamps (4)`, and no *other* open invoice of theirs (frozen or not) has
     `discount_kind = 'reward'` → `min(round(base × 50%), cap ₹1,000)`.
   - **Welcome**: customer linked, no earlier paid invoice linked to them, `welcome_used_at` null, no other open
     invoice of theirs (frozen or not) has `discount_kind = 'welcome'`, and
     `welcomes used + welcomes held < 420`, where *held* counts open invoices with `discount_kind = 'welcome'` created
     in the last 24 hours (older unfinished bills stop holding a place) → `round(base × 20%)`.
   - **Offers**: every offer active today (Kolkata date within `starts_on..ends_on`, not paused), for `everyone`, or
     for `members` when a customer is linked → `round(eligible × percent)` where eligible is the whole base or the lines
     whose item's category is in the offer's sections.
3. Pick the largest; ties: offer, welcome, reward. No candidates → no automatic discount.
4. A **manual** discount set by a manager on the invoice (below) always replaces the automatic one.
5. Store on the invoice: `discount_kind` (`none`/`reward`/`welcome`/`offer`/`manual`), `offer_id`, `discount_paise`.
   Distribute `discount_paise` across the orders: for an offer on sections, in proportion to each order's eligible
   lines; otherwise in proportion to each order's subtotal; largest-remainder rounding in paise. Write each order's
   `discount_paise` and `discount_note` (e.g. "5th-visit reward, 50% off", "Welcome 20% off", the offer name,
   "Manual: <note>") and `recalc()` it, so GST is charged on the reduced amount as today.
6. `settleInvoiceCheck` (spec 1) runs afterwards.

The invoice view shows one discount line with the note. Reports' sales summary adds discount totals by kind and by offer.

### Manual override

- Invoices gain a manager-only **Discount** control: "Best offer (automatic)" or "Manual" with an amount and a note.
  `PUT /api/admin/invoices/:id/discount` `{ mode: 'auto' }` or `{ mode: 'manual', amountPaise, note }`.
- With an invoice, the per-order discount endpoint is refused for its orders:
  `409 { error: 'use_invoice', message: 'Set the discount on invoice LB/26-27/00001.' }`. Orders with no invoice keep
  per-order discounts as today.

### When the bill is paid

In the transaction where `settleInvoiceCheck` marks a linked invoice `paid` (or where a stamp-only link is made to an
already-paid invoice), with the customer row locked:

- `discount_kind = 'reward'` → `stamps = 0`; ledger `reward_used`. No stamp for this visit.
- otherwise, if `discount_kind = 'welcome'` → `welcome_used_at = now()`; ledger `welcome_used`. Then, if
  `stamps < 4` and the customer has no `stamp` ledger entry today (Kolkata), `stamps + 1`; ledger `stamp`.
- Always: `last_visit_at = now()`, `reminders_since_visit = 0`.
- **Visits and spend** (`visits + 1`, `spent_paise + invoice total`) are added once, at settlement of any invoice:
  to the invoice's linked customer, or, with no link, to the orders' shared `customer_id` (e.g. a takeaway phone);
  nobody if neither. For orders on an invoice, `addPayment` no longer counts per order (orders with no invoice keep
  today's per-order behaviour). A stamp-only link made after settlement doesn't add visits/spend again; if the
  settled invoice had credited another customer row, that credit stays where it was.
- A welcome already applied is honoured at payment even if the 420 limit was reached meanwhile by a stale hold
  being paid; `welcome_used_at` is set regardless.

Unlinking a customer before payment, or cancelling every order, releases any welcome reservation (it's only counted
as used when paid).

### Admin

- Customers list adds: stamps, opted in, last visit, rewards used, welcome used. CSV likewise.
- Settings → **Loyalty** (manager): stamps for a reward, reward percent and cap, welcome percent and limit (shows
  "312 of 420 used"), Google review URL, Instagram URL, reminder days, reminder cap, reminder hour.
- Owner-only on a customer: adjust stamps (0 to `reward_stamps`) with a note (ledger `manual_adjust`), for mistakes.
- `stamps` is capped in code at `reward_stamps`; the database only requires `stamps >= 0`, so the setting can change.

## 3. Offers, broadcasts and reminders

### Offers

- Admin → **Campaigns → Offers** (view: all staff; create/edit/pause/end: manager).
- Fields: name (1–40), percent (1–90), scope `bill` or `sections` (one or more menu sections), `starts_on`,
  `ends_on` (Kolkata dates, inclusive), audience `everyone` or `members`, paused.
- List shows each offer's status (scheduled / running / paused / ended), bills that used it and discount given.
- API: `GET/POST /api/admin/offers`, `PATCH /api/admin/offers/:id`. Public card shows running offers.

### Messaging provider

- `api/src/messaging.ts`: interface `Messenger { sendTemplate(phone, template, language, params): Promise<{ id }> }`.
  - `MetaCloud`: WhatsApp Cloud API (`POST https://graph.facebook.com/<version>/<WHATSAPP_PHONE_NUMBER_ID>/messages`),
    used when the secrets below are set.
  - `LogMessenger`: used in tests and local dev; records sends in memory so tests can read codes.
  - None configured in production → card sign-in off (section 1); reminders and broadcasts are disabled with
    "WhatsApp isn't connected yet." in the admin.
- Worker secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- Fixed templates (created in Meta by Kaustav): `lbs_login_code` (authentication), `lbs_we_miss_you` (marketing; name,
  card line), `lbs_reward_ready` (marketing; name). Campaign templates: any approved marketing template.
- Webhook `GET/POST /api/whatsapp/webhook`:
  - GET: if `hub.mode === 'subscribe'` and `hub.verify_token` equals `WHATSAPP_VERIFY_TOKEN`, reply `hub.challenge` as
    plain text; else 403.
  - POST: read the raw body (`await c.req.text()`) before parsing, compute HMAC-SHA256 with `WHATSAPP_APP_SECRET`,
    compare to `X-Hub-Signature-256` in constant time; mismatch → 401.
  - Status updates move forward only (queued < sent < delivered < read; `failed` from any state); late or older
    statuses are ignored.
  - Inbound text "stop" or "unsubscribe" (any case, trimmed) opts out the customer whose phone matches the sender's
    `wa_id` via `normalisePhone()` (handles `91XXXXXXXXXX`).

### Sending

- An `Outbox` Durable Object (single instance) drains a `messages` queue table with an alarm: up to 50
  sends per alarm, re-arming while any `queued` rows remain. Each send updates the row (`sent` + provider id, or
  `failed` + error). Opted-out customers are skipped at send time (`skipped`).
- Login codes are sent directly (not queued) so they arrive within seconds.

### Broadcasts

- Admin → **Campaigns → Messages**. Template picker (approved templates, synced from Meta on open:
  `GET /api/admin/wa/templates`), variables, optional linked offer (shown in the message by the owner's own wording).
- Audience: all opted-in; visited in the last N days; not visited for N days; N or more stamps; welcome not used.
  Always limited to customers with `opted_in = true`. Only the customer can opt in (the card checkbox); waiter-linked
  customers are never messaged until they opt in themselves.
- `POST /api/admin/broadcasts/preview` `{ audience }` → `{ count, estimatedPaise }` (count × `wa_marketing_rate_paise`
  setting, default 80).
- `POST /api/admin/broadcasts` (owner) `{ template, language, params, audience, offerId? }` → queued; the UI confirms
  "Send to 238 people, about ₹190?" first.
- `GET /api/admin/broadcasts`, `/:id`: counts by status.

### Reminders

- Cron trigger **hourly at :30 UTC** (`30 * * * *`, i.e. on the hour in Kolkata) → `scheduled()` in `worker.ts`, which
  sends only when the Kolkata hour equals `reminder_hour`, so the setting takes effect without a redeploy.
  `scheduled()` creates its own Hyperdrive client and runs inside `withRuntime(...)`, like `LiveHub.alarm()`.
- Due: opted in, `last_visit_at <= now() - reminder_days`, (`last_reminder_at` null or `<= now() - reminder_days`),
  `reminders_since_visit < reminder_cap (6)`. Customers who never had a paid visit don't get reminders.
- Template `lbs_reward_ready` when `stamps = 4`, else `lbs_we_miss_you` with a card line ("You're 2 visits from 50%
  off"). Queued like broadcasts; `last_reminder_at = now()`, `reminders_since_visit + 1`.

## Data (migration `006_loyalty.sql`)

- `customers`: add `verified_at`, `opted_in boolean not null default false`, `opted_in_at`, `opted_out_at`,
  `stamps int not null default 0 check (stamps >= 0)`, `welcome_used_at`, `last_visit_at`,
  `last_reminder_at`, `reminders_since_visit int not null default 0`.
- `customer_codes (id serial pk, phone text not null, code_hash text not null, expires_at timestamptz not null,
  attempts int not null default 0, created_at timestamptz not null default now())`.
- `stamp_events (id serial pk, customer_id int not null references customers on delete cascade, invoice_id int
  references invoices, kind text not null check (kind in ('stamp','reward_used','welcome_used','manual_adjust')),
  note text, staff_id int references staff, created_at timestamptz not null default now())`.
- `offers (id serial pk, name text not null, percent int not null check (percent between 1 and 90),
  scope text not null check (scope in ('bill','sections')), audience text not null check (audience in
  ('everyone','members')), starts_on date not null, ends_on date not null, paused boolean not null default false,
  created_by int references staff, created_at timestamptz not null default now(), check (ends_on >= starts_on))`;
  `offer_sections (offer_id int references offers on delete cascade, category_id int references categories,
  primary key (offer_id, category_id))`.
- `invoices`: add `customer_id int references customers`, `discount_kind text not null default 'none'` (check list
  above), `offer_id int references offers`, `discount_paise int not null default 0`, `manual_note text`.
- `broadcasts (id serial pk, template text not null, language text not null, params jsonb not null, audience jsonb not
  null, offer_id int references offers, recipients int not null, estimated_paise int not null, created_by int
  references staff, created_at timestamptz not null default now())`.
- `messages (id serial pk, customer_id int references customers on delete cascade, kind text not null check (kind in
  ('code','reminder','broadcast')), broadcast_id int references broadcasts, template text not null, params jsonb,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','skipped')),
  provider_id text, error text, created_at timestamptz not null default now(), updated_at timestamptz)`.
- Setting `loyalty` (JSON): `{ reward_stamps: 4, reward_percent: 50, reward_cap_paise: 100000, welcome_percent: 20,
  welcome_limit: 420, google_review_url: '', instagram_url: '', reminder_days: 14, reminder_cap: 6,
  reminder_hour: 18, wa_marketing_rate_paise: 80 }`.
- RLS enabled on every new table.
- `stamps` constraint is `check (stamps >= 0)` (not a fixed 4).

## Worker config (`api/wrangler.jsonc`, `api/src/worker.ts`)

- `triggers: { crons: ["30 * * * *"] }`; `worker.ts` exports `scheduled` alongside `fetch`.
- Durable Object binding `OUTBOX` → class `Outbox`, migration tag `v2` with `new_sqlite_classes: ["Outbox"]`;
  `Env` gains `OUTBOX` and the four `WHATSAPP_*` secrets (optional); rerun `wrangler types`.

## Build order

Plan and ship in two parts:

1. **Card, stamps, discounts and offers**: sections 1 and 2, offers from section 3, waiter linking; card sign-in uses
   `LogMessenger` in dev/tests and shows "coming soon" in production until WhatsApp is configured.
2. **WhatsApp**: `MetaCloud`, webhook, `Outbox`, broadcasts, reminders and cron.

## Testing

`LogMessenger` in tests; time-dependent rules use explicit timestamps.

- Card: code sent and verified; wrong code refused; code expiry and try limits; customer token refused as a staff
  token; opt in/out; delete my details nulls the links and removes the row.
- Frozen: linking a card to an invoice whose orders were paid one by one gives a stamp but no discount, and never
  leaves an order with `paid_paise > total_paise`; manual discount on a frozen invoice → `frozen`.
- Concurrency: one card on two open bills gets the reward (or welcome) on only one, including when the first bill is
  part-paid (frozen); two simultaneous welcome calculations at
  419 used give exactly one welcome; a welcome hold older than 24 hours no longer counts.
- Visits/spend counted once per paid invoice, not per order.
- Stamps: paid linked bill → 1 stamp; second paid bill same day → no stamp; 4 stamps cap; 5th visit gets 50% capped
  at ₹1,000 (a ₹3,000 bill gets ₹1,000 off), resets to 0 and earns no stamp; the next four visits earn stamps again.
- Welcome: first paid visit gets 20% and stamp 1; second visit doesn't; the 421st customer doesn't; a reservation is
  released when unlinked.
- Best discount: section offer vs reward vs welcome picks the larger; ties follow the order; a winning offer keeps
  the 4 stamps; manual override replaces automatic and keeps rewards; discount frozen after first payment.
- Offers: date range and pause respected; members-only needs a linked customer.
- Reminders: due selection (14 days, repeat, cap 6, opted-in only, reset on visit); reward-ready template at 4 stamps.
- Broadcasts: audience counts and cost estimate; owner only; opted-out skipped at send.
- Webhook: bad signature refused; status updates; "STOP" opts out.
- Guest-facing guard: a guest can't link a bill already linked to someone else.

## Kaustav's setup (outside the code)

1. Meta Business account, verified; a WhatsApp number not on the WhatsApp app; display name approval.
   Risk: "Hemp" may trigger Meta's restricted-goods review. Fallback: an SMS provider (DLT) behind the same `Messenger`
   interface.
2. Create the three templates above; set the four Worker secrets; set the webhook URL
   `https://lbscafe.com/api/whatsapp/webhook` in Meta.
3. Fill Google review and Instagram URLs in Settings → Loyalty.

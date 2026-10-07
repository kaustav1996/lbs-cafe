-- LB's card, part 1: stamps, the 5th-visit reward, the welcome offer, campaign offers and the bill discount.
-- (WhatsApp messages, broadcasts and reminders come in a later migration.)
alter table customers
  add column if not exists verified_at timestamptz,          -- signed in with a code at least once
  add column if not exists opted_in boolean not null default false,
  add column if not exists opted_in_at timestamptz,
  add column if not exists opted_out_at timestamptz,
  add column if not exists stamps int not null default 0 check (stamps >= 0),
  add column if not exists welcome_used_at timestamptz,
  add column if not exists last_visit_at timestamptz,
  add column if not exists last_reminder_at timestamptz,
  add column if not exists reminders_since_visit int not null default 0;

-- One-time sign-in codes for the card (stored hashed).
create table if not exists customer_codes (
  id         serial primary key,
  phone      text not null,
  code_hash  text not null,
  name       text,                          -- applied to the customer only once the code is entered
  opt_in     boolean not null default false,
  expires_at timestamptz not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists customer_codes_phone_idx on customer_codes (phone, created_at desc);

-- Every stamp, reward and correction, so a card can always be explained.
create table if not exists stamp_events (
  id          serial primary key,
  customer_id int not null references customers(id) on delete cascade,
  invoice_id  int references invoices(id),
  kind        text not null check (kind in ('stamp', 'reward_used', 'welcome_used', 'manual_adjust')),
  note        text,
  staff_id    int references staff(id),
  created_at  timestamptz not null default now()
);
create index if not exists stamp_events_customer_idx on stamp_events (customer_id, created_at desc);

create table if not exists offers (
  id         serial primary key,
  name       text not null,
  percent    int not null check (percent between 1 and 90),
  scope      text not null check (scope in ('bill', 'sections')),
  audience   text not null check (audience in ('everyone', 'members')),
  starts_on  date not null,
  ends_on    date not null,
  paused     boolean not null default false,
  created_by int references staff(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create table if not exists offer_sections (
  offer_id    int not null references offers(id) on delete cascade,
  category_id int not null references categories(id),
  primary key (offer_id, category_id)
);

-- The one discount on a bill: worked out automatically (reward, welcome or an offer) or set by a manager.
alter table invoices
  add column if not exists customer_id int references customers(id),
  add column if not exists discount_kind text not null default 'none'
    check (discount_kind in ('none', 'reward', 'welcome', 'offer', 'manual')),
  add column if not exists offer_id int references offers(id),
  add column if not exists discount_paise int not null default 0,
  add column if not exists manual_note text;
create index if not exists invoices_customer_idx on invoices (customer_id);

insert into settings (key, value) values ('loyalty', '{
  "reward_stamps": 4, "reward_percent": 50, "reward_cap_paise": 100000,
  "welcome_percent": 20, "welcome_limit": 420,
  "google_review_url": "", "instagram_url": "",
  "reminder_days": 14, "reminder_cap": 6, "reminder_hour": 18
}'::jsonb) on conflict (key) do nothing;

alter table customer_codes enable row level security;
alter table stamp_events enable row level security;
alter table offers enable row level security;
alter table offer_sections enable row level security;

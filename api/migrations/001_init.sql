-- LB's cafe: core schema. Money is stored in paise (integer) everywhere.

create table if not exists staff (
  id            serial primary key,
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  role          text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

create table if not exists categories (
  id     serial primary key,
  slug   text not null unique,
  name   text not null,
  color  text not null default '#FFE24A',
  kind   text not null default 'food' check (kind in ('food', 'drink')),
  sort   int not null default 0,
  active boolean not null default true
);

create table if not exists items (
  id          serial primary key,
  category_id int not null references categories(id) on delete restrict,
  slug        text not null unique,
  name        text not null,
  description text,
  sort        int not null default 0,
  active      boolean not null default true,   -- shown on the menu at all
  available   boolean not null default true,   -- in stock today
  featured    boolean not null default false,
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists items_category_idx on items(category_id, sort);

create table if not exists item_options (
  id          serial primary key,
  item_id     int not null references items(id) on delete cascade,
  label       text not null default '',
  diet        text not null default 'unknown' check (diet in ('veg', 'nonveg', 'unknown')),
  price_paise int not null check (price_paise >= 0),
  sort        int not null default 0,
  active      boolean not null default true
);
create index if not exists item_options_item_idx on item_options(item_id, sort);

create table if not exists dining_tables (
  id     serial primary key,
  label  text not null unique,
  seats  int not null default 4,
  active boolean not null default true,
  sort   int not null default 0
);

create table if not exists customers (
  id           serial primary key,
  phone        text not null unique,
  name         text,
  email        text,
  visits       int not null default 0,
  spent_paise  bigint not null default 0,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create sequence if not exists order_number_seq start 1001;

create table if not exists orders (
  id              serial primary key,
  number          int not null unique default nextval('order_number_seq'),
  token           text not null unique,            -- public status link
  source          text not null check (source in ('table', 'takeaway', 'counter')),
  table_label     text,
  customer_id     int references customers(id),
  customer_name   text,
  customer_phone  text,
  status          text not null default 'new'
                  check (status in ('new', 'preparing', 'ready', 'served', 'completed', 'cancelled')),
  payment_status  text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  note            text,
  gst_rate        numeric(5, 4) not null,
  subtotal_paise  int not null,
  discount_paise  int not null default 0,
  discount_note   text,
  taxable_paise   int not null,
  cgst_paise      int not null,
  sgst_paise      int not null,
  round_off_paise int not null default 0,       -- bill total is rounded to the nearest rupee
  total_paise     int not null,
  paid_paise      int not null default 0,
  created_by      int references staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index if not exists orders_created_idx on orders(created_at desc);
create index if not exists orders_status_idx on orders(status);

create table if not exists order_lines (
  id           serial primary key,
  order_id     int not null references orders(id) on delete cascade,
  item_id      int references items(id) on delete set null,
  option_id    int references item_options(id) on delete set null,
  name         text not null,
  option_label text not null default '',
  diet         text not null default 'unknown',
  unit_paise   int not null,
  qty          int not null check (qty > 0),
  line_paise   int not null
);
create index if not exists order_lines_order_idx on order_lines(order_id);

create table if not exists payments (
  id           serial primary key,
  order_id     int not null references orders(id) on delete cascade,
  method       text not null check (method in ('cash', 'upi', 'card', 'other')),
  amount_paise int not null check (amount_paise > 0),
  reference    text,
  staff_id     int references staff(id),
  created_at   timestamptz not null default now()
);
create index if not exists payments_order_idx on payments(order_id);
create index if not exists payments_created_idx on payments(created_at);

create table if not exists service_requests (
  id          serial primary key,
  table_label text not null,
  kind        text not null check (kind in ('water', 'bill', 'server')),
  status      text not null default 'open' check (status in ('open', 'done')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  done_by     int references staff(id)
);

create table if not exists reservations (
  id          serial primary key,
  ref         text not null unique,
  name        text not null,
  phone       text not null,
  party_size  int not null check (party_size between 1 and 50),
  starts_at   timestamptz not null,
  table_label text,
  note        text,
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'rejected', 'no_show')),
  source      text not null default 'web' check (source in ('web', 'staff')),
  customer_id int references customers(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists reservations_starts_idx on reservations(starts_at);

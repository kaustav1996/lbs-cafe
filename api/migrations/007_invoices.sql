-- Invoices: one numbered bill per table visit (sitting), or per takeaway/counter order. Numbers run
-- LB/26-27/00001, LB/26-27/00002, … with no gaps within an Indian financial year (April to March).
create table if not exists invoice_counters (
  fy   text primary key,          -- '26-27'
  last int not null default 0
);

create table if not exists invoices (
  id          serial primary key,
  number      text not null unique,
  fy          text not null,
  token       text not null unique,      -- the guest's /bill/<token> link
  source      text not null check (source in ('table', 'takeaway', 'counter')),
  table_label text,
  sitting     int,
  status      text not null default 'open' check (status in ('open', 'paid')),
  created_by  int references staff(id),
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
-- At most one open bill per table visit.
create unique index if not exists invoices_one_open on invoices (table_label, sitting) where status = 'open' and source = 'table';

alter table orders add column if not exists sitting int;
alter table orders add column if not exists invoice_id int references invoices(id);
create index if not exists orders_invoice_idx on orders (invoice_id);
create index if not exists orders_table_sitting_idx on orders (table_label, sitting);

-- Orders placed before this migration that may still need a bill belong to their table's current visit.
update orders o set sitting = t.sitting
from dining_tables t
where o.table_label = t.label and o.sitting is null
  and (o.status in ('held', 'new', 'preparing', 'ready', 'served')
       or (o.status = 'completed' and o.payment_status <> 'paid'));

alter table payments add column if not exists invoice_id int references invoices(id);
-- One card swipe or UPI transfer can pay several orders on a bill; they share a txn_group.
alter table payments add column if not exists txn_group uuid not null default gen_random_uuid();
create index if not exists payments_txn_idx on payments (txn_group);
-- Card and UPI payments carry the transaction ID from the slip or app (new rows only).
alter table payments drop constraint if exists payments_reference_check;
alter table payments add constraint payments_reference_check
  check (method in ('cash', 'other') or length(trim(coalesce(reference, ''))) > 0) not valid;

alter table invoices enable row level security;
alter table invoice_counters enable row level security;

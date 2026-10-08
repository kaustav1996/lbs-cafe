-- LB's card is claimed from a paid bill, with the number checked by a code every time.
alter table customer_codes add column if not exists invoice_id int references invoices(id) on delete cascade;
alter table invoices
  add column if not exists card_claimed_at timestamptz,
  add column if not exists card_claimed_phone text;

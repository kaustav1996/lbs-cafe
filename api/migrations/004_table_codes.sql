-- Table codes: each table has a 4-digit code staff read out to guests, and a sitting number.
-- A guest's phone needs the current code once per sitting before it can order to that table.
-- When the table frees up (or staff tap New code) the sitting moves on and the code changes.
alter table dining_tables
  add column if not exists otp text not null default lpad(floor(random() * 10000)::int::text, 4, '0'),
  add column if not exists sitting int not null default 1;

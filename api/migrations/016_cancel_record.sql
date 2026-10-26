-- Who cancelled an order and why (the time is closed_at). Any staff member can cancel, so keep a record.
alter table orders add column if not exists cancelled_by integer references staff(id) on delete set null;
alter table orders add column if not exists cancel_reason text;

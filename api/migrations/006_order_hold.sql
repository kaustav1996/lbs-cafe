-- The 1-minute hold: guest orders wait as 'held' (no number, invisible to staff) so the guest can change
-- them; when the hold ends they're released into 'new' with the next order number.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('held', 'new', 'preparing', 'ready', 'served', 'completed', 'cancelled'));
alter table orders add column if not exists hold_until timestamptz;
-- Numbers are given on release. The default stays so a Worker still running the previous code keeps
-- numbering its orders during a deploy; held inserts pass null explicitly.
alter table orders alter column number drop not null;
create index if not exists orders_held_idx on orders (hold_until) where status = 'held';

insert into settings (key, value) values ('hold_seconds', '60'::jsonb) on conflict (key) do nothing;

-- Phones that get push notifications (new orders, tables calling, orders ready, bookings). One row per phone
-- and browser; a staff member can have several. Removed when the push service says the phone unsubscribed.
create table if not exists push_subscriptions (
  id          serial primary key,
  staff_id    integer not null references staff(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_staff on push_subscriptions(staff_id);
alter table push_subscriptions enable row level security;

-- Guests can ask the servers for their table's code. The first guest at a table gives a name and mobile number,
-- which come with the request so the server knows who's asking.
alter table service_requests drop constraint if exists service_requests_kind_check;
alter table service_requests add constraint service_requests_kind_check check (kind in ('water', 'bill', 'server', 'code'));
alter table service_requests add column if not exists guest_name text;
alter table service_requests add column if not exists guest_phone text;

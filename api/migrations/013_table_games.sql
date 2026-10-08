-- Games for a table: on when the table orders (or staff switch them on), off when a server closes them.
-- The games_default setting switches every table on, and each new visit at a table starts with games on.
alter table dining_tables add column if not exists games_on boolean not null default false;
insert into settings (key, value) values ('games_default', 'false'::jsonb) on conflict (key) do nothing;

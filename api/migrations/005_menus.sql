-- Multiple menus (e.g. Regular and a smaller Durga Puja menu). Dishes stay in one master list;
-- a menu is a selection of them, with optional per-menu prices. Exactly one menu is live.
create table if not exists menus (
  id         serial primary key,
  name       text not null unique,
  live       boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists menus_one_live on menus (live) where live;

create table if not exists menu_items (
  menu_id int not null references menus(id) on delete cascade,
  item_id int not null references items(id),
  primary key (menu_id, item_id)
);

create table if not exists menu_prices (
  menu_id     int not null references menus(id) on delete cascade,
  option_id   int not null references item_options(id),
  price_paise int not null check (price_paise >= 0),
  primary key (menu_id, option_id)
);

-- Today's menu becomes "Regular", live, with every dish on it.
insert into menus (name, live) select 'Regular', true where not exists (select 1 from menus);
insert into menu_items (menu_id, item_id)
  select m.id, i.id from menus m cross join items i where m.live
  on conflict do nothing;

alter table menus enable row level security;
alter table menu_items enable row level security;
alter table menu_prices enable row level security;

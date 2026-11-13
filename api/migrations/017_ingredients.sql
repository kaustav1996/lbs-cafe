-- Ingredients and allergens, set per dish in Admin, Menu. Guests filter the menu by them ("I'm allergic to
-- peanuts", "no onion"). One shared list, so every dish says "Onion" the same way. `allergen` puts it in the
-- allergens group on the guest filter.
create table if not exists ingredients (
  id         serial primary key,
  name       text not null,
  allergen   boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists ingredients_name_key on ingredients (lower(name));
alter table ingredients enable row level security;

create table if not exists item_ingredients (
  item_id       int not null references items(id) on delete cascade,
  ingredient_id int not null references ingredients(id) on delete cascade,
  primary key (item_id, ingredient_id)
);
create index if not exists item_ingredients_ingredient on item_ingredients(ingredient_id);
alter table item_ingredients enable row level security;

-- The common allergens, ready to tick. Guests only see the ones a dish on the live menu has.
insert into ingredients (name, allergen) values
  ('Gluten', true), ('Milk', true), ('Egg', true), ('Peanuts', true), ('Tree nuts', true), ('Soy', true),
  ('Sesame', true), ('Mustard', true), ('Fish', true), ('Shellfish', true),
  ('Onion', false), ('Garlic', false), ('Mushroom', false), ('Chilli', false)
on conflict do nothing;

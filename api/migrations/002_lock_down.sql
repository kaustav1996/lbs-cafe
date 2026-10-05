-- Supabase exposes the public schema through its Data API. The cafe only talks to the
-- database from the Render API (as the owner role), so turn on row level security with
-- no policies: the anon/authenticated API roles see nothing, the server is unaffected.
do $$
declare t text;
begin
  foreach t in array array['staff','settings','categories','items','item_options','dining_tables',
                           'customers','orders','order_lines','payments','service_requests','reservations']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- The street address is "29, BJ Block", not "29 BJ, BJ Block". Only touches it if it still has the old wording,
-- so an address the owner has since edited in Settings is left alone.
update settings
set value = jsonb_set(value, '{address}', to_jsonb(replace(value->>'address', '29 BJ, BJ Block', '29, BJ Block')))
where key = 'cafe' and value->>'address' like '%29 BJ, BJ Block%';

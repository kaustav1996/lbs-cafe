-- schema_migrations is created by src/migrate.ts, so 002 missed it. Lock it down the same way,
-- otherwise the Data API's anon role could delete rows and make old migrations re-run.
alter table schema_migrations enable row level security;

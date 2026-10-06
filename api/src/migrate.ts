import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { PG_OPTIONS, type Sql } from './db.js';
import { seed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, '../migrations');

/**
 * Applies any migrations not yet recorded, each in its own transaction, then seeds an empty database.
 * Workers have no boot step, so this runs from Node before each deploy (`npm run migrate`).
 */
export async function migrate(sql: Sql, log: (m: string) => void = console.log) {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map(r => r.name));
  const files = fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const body = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    await sql.begin(async tx => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    log(`migrated ${f}`);
  }
  await seed(sql, log);
}

/** A Node client for scripts and tests. Supabase needs TLS; set DATABASE_SSL=disable for a local database. */
export function nodeSql(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required (Supabase Session pooler connection string)');
  return postgres(url, { ...PG_OPTIONS, ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require', max: 4, onnotice: () => {} });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sql = nodeSql();
  migrate(sql)
    .then(() => sql.end())
    .catch(async e => {
      console.error(e);
      await sql.end();
      process.exit(1);
    });
}

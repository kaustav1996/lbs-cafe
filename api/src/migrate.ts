import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './db.js';
import { seed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, '../migrations');

/** Applies any migrations not yet recorded, each in its own transaction, then seeds an empty database. */
export async function migrate(log: (m: string) => void = console.log) {
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
  await seed(log);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => sql.end())
    .catch(async e => {
      console.error(e);
      await sql.end();
      process.exit(1);
    });
}

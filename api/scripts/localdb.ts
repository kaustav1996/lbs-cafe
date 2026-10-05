// Runs a throwaway Postgres for local development and tests: npm run localdb
// Then: DATABASE_URL=postgres://postgres:postgres@localhost:5433/lbs DATABASE_SSL=disable npm run dev
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';

const dir = process.env.LOCALDB_DIR ?? './.localdb';
const fresh = !fs.existsSync(dir);
// createPostgresUser lets it run inside root-only containers.
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 5433, persistent: true, createPostgresUser: process.getuid?.() === 0 });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('lbs');
console.log('Postgres ready on postgres://postgres:postgres@localhost:5433/lbs');
process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);

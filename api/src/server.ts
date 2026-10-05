import { buildApp } from './app.js';
import { env } from './config.js';
import { migrate } from './migrate.js';
import { sql } from './db.js';

const app = await buildApp();
await migrate(m => app.log.info(m));
await app.listen({ port: env.PORT, host: '0.0.0.0' });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

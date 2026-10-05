import postgres from 'postgres';
import { env } from './config.js';

// Supabase's pooler (Supavisor) in transaction mode doesn't support prepared statements,
// so they're switched off; it costs nothing at this scale.
export const sql = postgres(env.DATABASE_URL, {
  ssl: env.DATABASE_SSL === 'require' ? 'require' : false,
  prepare: false,
  max: 8,
  idle_timeout: 30,
  connect_timeout: 15,
  transform: { undefined: null },
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;

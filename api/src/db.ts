import postgres from 'postgres';
import { runtime } from './context.js';

/** Options shared by every client. Supabase's pooler doesn't support prepared statements in transaction mode. */
export const PG_OPTIONS = {
  prepare: false,
  transform: { undefined: null },
} satisfies postgres.Options<{}>;

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/** The current request's database client. Used exactly like a postgres.js `sql`. */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _this, args) => (runtime().sql as any)(...args),
  get: (_t, p) => {
    const s = runtime().sql as any;
    const v = s[p];
    return typeof v === 'function' ? v.bind(s) : v;
  },
});

import { sign, verify } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';
import { runtime } from './context.js';
import { sql } from './db.js';

export type Role = 'owner' | 'manager' | 'staff';
export interface StaffClaims {
  sub: number;
  name: string;
  role: Role;
}
export type AppEnv = { Variables: { staff: StaffClaims } };

const TTL_SECONDS = 14 * 24 * 3600;

export function signStaff(s: StaffClaims) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return sign({ sub: String(s.sub), name: s.name, role: s.role, exp }, runtime().jwtSecret, 'HS256');
}

export async function verifyToken(token: string): Promise<StaffClaims | null> {
  try {
    const p = await verify(token, runtime().jwtSecret, 'HS256');
    return { sub: Number(p.sub), name: String(p.name), role: p.role as Role };
  } catch {
    return null;
  }
}

/** Bearer token check for every /api/admin route. Also re-checks the account is still active. */
export const requireStaff = createMiddleware<AppEnv>(async (c, next) => {
  const h = c.req.header('authorization');
  const claims = h?.startsWith('Bearer ') ? await verifyToken(h.slice(7)) : null;
  if (!claims) return c.json({ error: 'signed_out', message: 'Your session has ended. Sign in again.' }, 401);
  const [row] = await sql<{ active: boolean; role: Role }[]>`select active, role from staff where id = ${claims.sub}`;
  if (!row?.active) return c.json({ error: 'signed_out', message: 'This account is switched off. Ask the owner.' }, 401);
  c.set('staff', { ...claims, role: row.role });
  await next();
});

const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };
export function atLeast(role: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const s = c.get('staff');
    if (!s || RANK[s.role] < RANK[role]) return c.json({ error: 'forbidden', message: `Only a ${role} can do this.` }, 403);
    await next();
  });
}

/** Per-IP limit on a route, like the old @fastify/rate-limit settings. */
export function rateLimit(name: string, max: number, windowMs: number) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
    if (!(await runtime().allow(`${name}:${ip}`, max, windowMs)))
      return c.json({ error: 'slow_down', message: 'Too many tries. Wait a minute and try again.' }, 429);
    await next();
  });
}

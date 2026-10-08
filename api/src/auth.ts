import { sign, verify } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { runtime } from './context.js';
import { sql } from './db.js';

/**
 * chef: kitchen screen only. staff: a server (serves, bills; doesn't move orders through the kitchen).
 * server_kitchen: both, for quiet days. manager and owner: everything.
 */
export type Role = 'owner' | 'manager' | 'staff' | 'server_kitchen' | 'chef';
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
    // Table passes (and later card tokens) are signed with the same secret; they carry `kind` and are never staff.
    if (p.kind !== undefined || !Number.isInteger(Number(p.sub))) return null;
    return { sub: Number(p.sub), name: String(p.name), role: p.role as Role };
  } catch {
    return null;
  }
}

/** A table pass: proof that this phone was given the table's code during the current sitting. */
export interface TablePass {
  table: string;
  sitting: number;
}
const PASS_TTL_SECONDS = 12 * 3600;

export function signTablePass(p: TablePass) {
  const exp = Math.floor(Date.now() / 1000) + PASS_TTL_SECONDS;
  return sign({ kind: 'table', table: p.table, sitting: p.sitting, exp }, runtime().jwtSecret, 'HS256');
}

export async function verifyTablePass(token: string | undefined): Promise<TablePass | null> {
  if (!token) return null;
  try {
    const p = await verify(token, runtime().jwtSecret, 'HS256');
    if (p.kind !== 'table' || typeof p.table !== 'string' || !Number.isInteger(p.sitting)) return null;
    return { table: p.table, sitting: Number(p.sitting) };
  } catch {
    return null;
  }
}

/** A signed-in LB's card holder (a phone that entered a WhatsApp code), for 90 days. */
const CARD_TTL_SECONDS = 90 * 24 * 3600;
export function signCustomer(id: number) {
  return sign({ kind: 'customer', sub: String(id), exp: Math.floor(Date.now() / 1000) + CARD_TTL_SECONDS }, runtime().jwtSecret, 'HS256');
}
export async function verifyCustomer(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  try {
    const p = await verify(token, runtime().jwtSecret, 'HS256');
    return p.kind === 'customer' && Number.isInteger(Number(p.sub)) ? Number(p.sub) : null;
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

const RANK: Record<Role, number> = { chef: 0, staff: 1, server_kitchen: 1, manager: 2, owner: 3 };
/** Who may move orders to preparing and ready. */
export const cooks = (role: Role) => role !== 'staff';
export const isManager = (role: Role) => RANK[role] >= RANK.manager;
export function atLeast(role: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const s = c.get('staff');
    if (!s || RANK[s.role] < RANK[role]) return c.json({ error: 'forbidden', message: `Only a ${role} can do this.` }, 403);
    await next();
  });
}

/**
 * Per-IP limit on a route. `extra` adds to the key: guests on the cafe Wi-Fi share one IP, so table
 * routes also key by table so one busy table can't lock out the room.
 */
export function rateLimit(name: string, max: number, windowMs: number, extra?: (c: Context) => Promise<string> | string) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
    const more = extra ? await extra(c) : '';
    if (!(await runtime().allow(`${name}:${ip}${more ? `:${more}` : ''}`, max, windowMs)))
      return c.json({ error: 'slow_down', message: 'Too many tries. Wait a minute and try again.' }, 429);
    await next();
  });
}

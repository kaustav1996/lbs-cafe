import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './config.js';
import { sql } from './db.js';

export type Role = 'owner' | 'manager' | 'staff';
export interface StaffClaims {
  sub: number;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffClaims;
  }
}

const TTL = '14d';

export function signStaff(s: StaffClaims) {
  return jwt.sign({ name: s.name, role: s.role }, env.JWT_SECRET, { subject: String(s.sub), expiresIn: TTL });
}

export function verifyToken(token: string): StaffClaims | null {
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    return { sub: Number(p.sub), name: String(p.name), role: p.role as Role };
  } catch {
    return null;
  }
}

/** Bearer token check for every /api/admin route. Also re-checks the account is still active. */
export async function requireStaff(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  const claims = h?.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
  if (!claims) return reply.code(401).send({ error: 'signed_out', message: 'Your session has ended. Sign in again.' });
  const [row] = await sql<{ active: boolean; role: Role }[]>`select active, role from staff where id = ${claims.sub}`;
  if (!row?.active) return reply.code(401).send({ error: 'signed_out', message: 'This account is switched off. Ask the owner.' });
  req.staff = { ...claims, role: row.role };
}

const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };
export function atLeast(role: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.staff || RANK[req.staff.role] < RANK[role])
      return reply.code(403).send({ error: 'forbidden', message: `Only a ${role} can do this.` });
  };
}

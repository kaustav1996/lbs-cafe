import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireStaff, signStaff, verifyToken } from '../auth.js';
import { bus, type CafeEvent } from '../events.js';
import { HttpError } from '../orders.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async req => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const [s] = await sql<{ id: number; name: string; email: string; role: 'owner' | 'manager' | 'staff'; active: boolean; password_hash: string }[]>`
      select id, name, email, role, active, password_hash from staff where email = ${b.email.toLowerCase()}`;
    const ok = s && s.active && (await bcrypt.compare(b.password, s.password_hash));
    if (!ok) throw new HttpError(401, 'That email and password don’t match. Check both and try again.', 'bad_login');
    return { token: signStaff({ sub: s.id, name: s.name, role: s.role }), staff: { id: s.id, name: s.name, email: s.email, role: s.role } };
  });

  app.get('/me', { preHandler: requireStaff }, async req => {
    const [s] = await sql`select id, name, email, role from staff where id = ${req.staff!.sub}`;
    return { staff: s };
  });

  app.post('/password', { preHandler: requireStaff }, async req => {
    const b = z.object({ current: z.string().min(1), next: z.string().min(8).max(100) }).parse(req.body);
    const [s] = await sql<{ password_hash: string }[]>`select password_hash from staff where id = ${req.staff!.sub}`;
    if (!(await bcrypt.compare(b.current, s.password_hash))) throw new HttpError(400, 'Your current password is wrong.', 'bad_password');
    await sql`update staff set password_hash = ${await bcrypt.hash(b.next, 11)} where id = ${req.staff!.sub}`;
    return { ok: true };
  });

  /**
   * Live updates for the admin (new orders, waiter calls, bookings) as Server-Sent Events.
   * EventSource can't send headers, so the token comes in the query string.
   */
  app.get('/stream', async (req, reply) => {
    const token = (req.query as { token?: string }).token ?? '';
    const claims = verifyToken(token);
    if (!claims) return reply.code(401).send({ error: 'signed_out' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': (req.headers.origin as string) ?? '*',
    });
    res.write(`event: hello\ndata: {"ok":true}\n\n`);
    const send = (e: CafeEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    bus.on('event', send);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', send);
    });
  });
}

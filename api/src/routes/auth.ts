import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from '../db.js';
import { rateLimit, requireStaff, signStaff, verifyToken, type AppEnv } from '../auth.js';
import { checkPassword, hashPassword } from '../password.js';
import { HttpError } from '../orders.js';
import { runtime } from '../context.js';

export function authRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/login', rateLimit('login', 10, 10 * 60_000), async c => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).parse(await c.req.json());
    const [s] = await sql<{ id: number; name: string; email: string; role: 'owner' | 'manager' | 'staff'; active: boolean; password_hash: string }[]>`
      select id, name, email, role, active, password_hash from staff where email = ${b.email.toLowerCase()}`;
    const ok = s && s.active && (await checkPassword(b.password, s.password_hash));
    if (!ok) throw new HttpError(401, 'That email and password don’t match. Check both and try again.', 'bad_login');
    return c.json({ token: await signStaff({ sub: s.id, name: s.name, role: s.role }), staff: { id: s.id, name: s.name, email: s.email, role: s.role } });
  });

  app.get('/me', requireStaff, async c => {
    const [s] = await sql`select id, name, email, role from staff where id = ${c.get('staff').sub}`;
    return c.json({ staff: s });
  });

  app.post('/password', requireStaff, async c => {
    const b = z.object({ current: z.string().min(1), next: z.string().min(8).max(100) }).parse(await c.req.json());
    const id = c.get('staff').sub;
    const [s] = await sql<{ password_hash: string }[]>`select password_hash from staff where id = ${id}`;
    if (!(await checkPassword(b.current, s.password_hash))) throw new HttpError(400, 'Your current password is wrong.', 'bad_password');
    await sql`update staff set password_hash = ${await hashPassword(b.next)} where id = ${id}`;
    return c.json({ ok: true });
  });

  /**
   * Live updates for the admin (new orders, waiter calls, bookings) over a WebSocket.
   * Browsers can't set headers on a WebSocket, so the token comes in the query string.
   */
  app.get('/stream', async c => {
    const claims = await verifyToken(c.req.query('token') ?? '');
    if (!claims) return c.json({ error: 'signed_out', message: 'Your session has ended. Sign in again.' }, 401);
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      return c.json({ error: 'upgrade', message: 'Open this with a WebSocket.' }, 426);
    const open = runtime().openStream;
    if (!open) return c.json({ error: 'unavailable', message: 'The live feed isn’t available here.' }, 503);
    return open(c.req.raw);
  });

  return app;
}

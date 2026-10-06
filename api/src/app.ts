import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { runtime } from './context.js';
import { sql } from './db.js';
import { HttpError } from './orders.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';

const BODY_LIMIT = 256 * 1024;

export function buildApp() {
  const app = new Hono();

  // The site is served from the same Worker, so most calls are same-origin. This covers the
  // Vite dev server and *.workers.dev preview URLs.
  app.use(
    '*',
    cors({
      origin: origin => {
        if (!origin) return origin;
        const host = new URL(origin).hostname;
        return runtime().corsOrigins.includes(origin) || host.endsWith('.workers.dev') ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    }),
  );

  app.use('*', async (c, next) => {
    if (Number(c.req.header('content-length') ?? 0) > BODY_LIMIT)
      return c.json({ error: 'too_large', message: 'That request is too large.' }, 413);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return c.json({ error: 'invalid', message: `Check ${first?.path.join('.') || 'the form'}: ${first?.message}`, issues: err.issues }, 400);
    }
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    if (err instanceof SyntaxError) return c.json({ error: 'invalid', message: 'The request body isn’t valid JSON.' }, 400);
    console.error(err);
    return c.json({ error: 'server', message: 'Something went wrong on our side. Try again in a moment.' }, 500);
  });

  app.notFound(c => c.json({ error: 'not_found', message: `There's nothing at ${c.req.path}.` }, 404));

  app.get('/health', async c => {
    await sql`select 1`;
    return c.json({ ok: true });
  });

  app.route('/api/public', publicRoutes());
  app.route('/api/auth', authRoutes());
  app.route('/api/admin', adminRoutes());
  return app;
}

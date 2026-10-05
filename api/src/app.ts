import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { corsOrigins, env } from './config.js';
import { sql } from './db.js';
import { HttpError } from './orders.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
    trustProxy: true, // Render sits in front of us
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin) || /\.netlify\.app$/.test(new URL(origin).hostname)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: 'invalid', message: `Check ${first?.path.join('.') || 'the form'}: ${first?.message}`, issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if ((err as any).statusCode === 429) return reply.code(429).send({ error: 'slow_down', message: 'Too many tries. Wait a minute and try again.' });
    req.log.error(err);
    return reply.code(500).send({ error: 'server', message: 'Something went wrong on our side. Try again in a moment.' });
  });

  app.get('/health', async () => {
    await sql`select 1`;
    return { ok: true };
  });

  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  return app;
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { runtime } from './context.js';
import { sql } from './db.js';
import { HttpError } from './orders.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { cardRoutes } from './routes/card.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { MAX_AUDIO_BYTES, MAX_FILE_BYTES, MUSIC_PATH, PUBLIC_FILE } from './files.js';

const BODY_LIMIT = 256 * 1024;
const UPLOAD_PATH = '/api/admin/files';

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
    const limit = c.req.path === UPLOAD_PATH ? MAX_FILE_BYTES + 64 * 1024 : c.req.path === MUSIC_PATH ? MAX_AUDIO_BYTES : BODY_LIMIT;
    if (Number(c.req.header('content-length') ?? 0) > limit)
      return c.req.path === UPLOAD_PATH
        ? c.json({ error: 'too_large', message: 'That file is over 10 MB. Try a smaller scan or a PDF.' }, 413)
        : c.req.path === MUSIC_PATH
          ? c.json({ error: 'too_large', message: 'That file is over 95 MB. Export it at 96 or 128 kbps and try again.' }, 413)
          : c.json({ error: 'too_large', message: 'That request is too large.' }, 413);
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
    const version = runtime().version;
    return c.json(version ? { ok: true, version } : { ok: true });
  });

  // Public files: licence scans and the music. Keys are random and never reused, so they can be cached for good.
  // Ranges are served so audio can seek (iPhones won't play audio without them).
  app.get('/files/*', async c => {
    const key = decodeURIComponent(c.req.path.slice('/files/'.length));
    const store = runtime().files;
    if (!PUBLIC_FILE.test(key) || !store) return c.json({ error: 'not_found', message: 'That file isn’t here any more.' }, 404);
    const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    let range: { offset: number; length: number } | undefined;
    let f;
    if (m && (m[1] || m[2])) {
      const whole = await store.get(key, { offset: 0, length: 1 });
      if (!whole) return c.json({ error: 'not_found', message: 'That file isn’t here any more.' }, 404);
      const size = whole.size;
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
      range = { offset: start, length: end - start + 1 };
      f = await store.get(key, range);
    } else f = await store.get(key);
    if (!f) return c.json({ error: 'not_found', message: 'That file isn’t here any more.' }, 404);
    const headers: Record<string, string> = {
      'content-type': f.type,
      'content-length': String(range ? range.length : f.size),
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    };
    if (range) headers['content-range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${f.size}`;
    return new Response(f.body, { status: range ? 206 : 200, headers });
  });

  app.route('/api/whatsapp', whatsappRoutes());
  app.route('/api/public/card', cardRoutes());
  app.route('/api/public', publicRoutes());
  app.route('/api/auth', authRoutes());
  app.route('/api/admin', adminRoutes());
  return app;
}

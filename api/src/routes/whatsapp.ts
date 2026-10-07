import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { runtime } from '../context.js';
import { normalisePhone } from '../orders.js';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Inbound words that mean "stop messaging me". */
const STOP_WORDS = new Set(['stop', 'unsubscribe']);

interface WebhookBody {
  entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[];
}

/**
 * Meta's WhatsApp Cloud API webhook (https://lbscafe.com/api/whatsapp/webhook).
 * - GET: the verification handshake Meta runs when the webhook is registered.
 * - POST: notifications, accepted only with a valid X-Hub-Signature-256. Today a STOP reply opts the number out;
 *   delivery statuses are handled once the cafe sends messages (loyalty spec, part 2).
 */
export function whatsappRoutes() {
  const app = new Hono();

  app.get('/webhook', c => {
    const expected = runtime().whatsapp?.verifyToken;
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token') ?? '';
    const challenge = c.req.query('hub.challenge') ?? '';
    if (!expected || mode !== 'subscribe' || !same(token, expected)) return c.text('Verification failed.', 403);
    return c.text(challenge, 200);
  });

  app.post('/webhook', async c => {
    const secret = runtime().whatsapp?.appSecret;
    if (!secret) return c.json({ error: 'not_set_up', message: 'WhatsApp isn’t connected yet.' }, 503);
    // The signature covers the exact bytes Meta sent, so read the raw body before parsing it.
    const raw = await c.req.text();
    const sent = c.req.header('x-hub-signature-256') ?? '';
    const want = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    if (!same(sent, want)) return c.json({ error: 'bad_signature', message: 'Signature check failed.' }, 401);

    let body: WebhookBody;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid', message: 'The request body isn’t valid JSON.' }, 400);
    }
    for (const entry of body.entry ?? [])
      for (const change of entry.changes ?? [])
        for (const m of change.value?.messages ?? []) {
          if (m.type !== 'text' || !STOP_WORDS.has((m.text?.body ?? '').trim().toLowerCase())) continue;
          const phone = normalisePhone(m.from); // wa_id comes as 91XXXXXXXXXX
          if (phone) await sql`update customers set opted_in = false, opted_out_at = now() where phone = ${phone} and opted_in`;
        }
    // Meta retries anything that isn't a quick 200.
    return c.json({ ok: true });
  });

  return app;
}

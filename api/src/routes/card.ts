import { Hono } from 'hono';
import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import { createMiddleware } from 'hono/factory';
import { sql } from '../db.js';
import { runtime } from '../context.js';
import { rateLimit, signCustomer, verifyCustomer } from '../auth.js';
import { HttpError, normalisePhone } from '../orders.js';
import { getInvoice } from '../invoices.js';
import { linkInvoice, loyaltySettings, reapplyDiscount, welcomesTaken } from '../loyalty.js';

type CardEnv = { Variables: { customerId: number } };
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const COMING_SOON = "Card sign-in is coming soon. Ask your server to add today's bill to your LB's card.";

const hashCode = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}:${runtime().jwtSecret}`).digest('hex');

/** The signed-in card holder. A token whose customer was deleted no longer works. */
const requireCard = createMiddleware<CardEnv>(async (c, next) => {
  const h = c.req.header('authorization');
  const id = await verifyCustomer(h?.startsWith('Bearer ') ? h.slice(7) : undefined);
  const [row] = id ? await sql`select 1 from customers where id = ${id}` : [];
  if (!id || !row) return c.json({ error: 'signed_out', message: 'Sign in to your LB’s card again.' }, 401);
  c.set('customerId', id);
  await next();
});

/** LB's card for guests: sign in with a WhatsApp code, see stamps and offers, put a bill on the card. */
export function cardRoutes() {
  const app = new Hono<CardEnv>();

  app.post(
    '/code',
    rateLimit('card-code', 10, 10 * 60_000),
    rateLimit('card-code-phone', 3, 10 * 60_000, async c => normalisePhone(((await c.req.json().catch(() => ({}))) as { phone?: string }).phone) ?? ''),
    async c => {
      const b = z.object({ phone: z.string().trim().max(20), name: z.string().trim().max(60).optional(), optIn: z.boolean().default(false) }).parse(await c.req.json());
      const messenger = runtime().messenger;
      if (!messenger) throw new HttpError(503, COMING_SOON, 'card_off');
      const phone = normalisePhone(b.phone);
      if (!phone) throw new HttpError(400, 'Add a 10-digit mobile number.', 'bad_phone');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      // Name and the WhatsApp choice wait with the code: nothing changes for this number until the code is entered.
      await sql`insert into customer_codes (phone, code_hash, name, opt_in, expires_at)
                values (${phone}, ${hashCode(phone, code)}, ${b.name || null}, ${b.optIn}, now() + make_interval(mins => ${CODE_MINUTES}))`;
      await messenger.sendTemplate(phone, 'lbs_login_code', 'en', [code]);
      return c.body(null, 204);
    },
  );

  app.post('/verify', rateLimit('card-verify', 20, 10 * 60_000), async c => {
    const b = z.object({ phone: z.string().trim().max(20), code: z.string().trim().max(10) }).parse(await c.req.json());
    const phone = normalisePhone(b.phone);
    if (!phone) throw new HttpError(400, 'Add a 10-digit mobile number.', 'bad_phone');
    const id = await sql.begin(async tx => {
      const [row] = await tx<{ id: number; code_hash: string; attempts: number; expired: boolean; name: string | null; opt_in: boolean }[]>`
        select id, code_hash, attempts, expires_at < now() as expired, name, opt_in from customer_codes
        where phone = ${phone} order by created_at desc limit 1 for update`;
      if (!row || row.expired) throw new HttpError(400, 'That code has expired. Ask for a new one.', 'code_expired');
      if (row.attempts >= CODE_TRIES) throw new HttpError(400, 'Too many wrong tries. Ask for a new code.', 'code_locked');
      if (row.code_hash !== hashCode(phone, b.code)) {
        await tx`update customer_codes set attempts = attempts + 1 where id = ${row.id}`;
        return null;
      }
      await tx`delete from customer_codes where phone = ${phone}`;
      const [cust] = await tx<{ id: number }[]>`
        insert into customers (phone, name, verified_at) values (${phone}, ${row.name}, now())
        on conflict (phone) do update set name = coalesce(excluded.name, customers.name), verified_at = now()
        returning id`;
      if (row.opt_in) await tx`update customers set opted_in = true, opted_in_at = now(), opted_out_at = null where id = ${cust.id} and not opted_in`;
      return cust.id;
    });
    if (!id) throw new HttpError(400, "That code doesn't match. Check the latest WhatsApp message from LB's.", 'bad_code');
    return c.json({ token: await signCustomer(id) });
  });

  app.get('/', requireCard, async c => {
    const id = c.get('customerId');
    const ls = await loyaltySettings();
    const [cust] = await sql<{ name: string | null; phone: string; stamps: number; welcome_used_at: Date | null; opted_in: boolean }[]>`
      select name, phone, stamps, welcome_used_at, opted_in from customers where id = ${id}`;
    const [paidBefore] = await sql`select 1 from invoices where customer_id = ${id} and status = 'paid'`;
    const offers = await sql`
      select o.name, o.percent, o.scope, o.audience, to_char(o.ends_on, 'YYYY-MM-DD') as "endsOn",
             coalesce((select array_agg(cat.name order by cat.sort) from offer_sections s join categories cat on cat.id = s.category_id where s.offer_id = o.id), '{}') as sections
      from offers o
      where not o.paused and o.starts_on <= (now() at time zone 'Asia/Kolkata')::date and o.ends_on >= (now() at time zone 'Asia/Kolkata')::date
      order by o.ends_on`;
    return c.json({
      name: cust.name,
      phone: cust.phone,
      stamps: Math.min(cust.stamps, ls.reward_stamps),
      rewardStamps: ls.reward_stamps,
      rewardReady: cust.stamps >= ls.reward_stamps,
      reward: { percent: ls.reward_percent, capPaise: ls.reward_cap_paise },
      welcome: !cust.welcome_used_at && !paidBefore && (await welcomesTaken(sql)) < ls.welcome_limit ? { percent: ls.welcome_percent } : null,
      offers,
      links: { google: ls.google_review_url, instagram: ls.instagram_url },
      optedIn: cust.opted_in,
    });
  });

  app.patch('/', requireCard, async c => {
    const { optIn } = z.object({ optIn: z.boolean() }).parse(await c.req.json());
    const id = c.get('customerId');
    if (optIn) await sql`update customers set opted_in = true, opted_in_at = now(), opted_out_at = null where id = ${id}`;
    else await sql`update customers set opted_in = false, opted_out_at = now() where id = ${id}`;
    return c.json({ optedIn: optIn });
  });

  /** Delete my details: the card, its history and personal details; bills keep their amounts. */
  app.delete('/', requireCard, async c => {
    const id = c.get('customerId');
    const reopen = await sql.begin(async tx => {
      const [cust] = await tx<{ phone: string }[]>`select phone from customers where id = ${id} for update`;
      const open = await tx<{ id: number }[]>`select id from invoices where customer_id = ${id} and status = 'open'`;
      await tx`update orders set customer_id = null, customer_name = null, customer_phone = null where customer_id = ${id}`;
      await tx`update reservations set customer_id = null, name = 'Deleted', phone = '' where customer_id = ${id}`;
      await tx`update invoices set customer_id = null where customer_id = ${id}`;
      await tx`delete from customer_codes where phone = ${cust.phone}`;
      await tx`delete from customers where id = ${id}`;
      return open.map(o => o.id);
    });
    // Bills that were holding a reward or welcome offer for them go back to the best offer for anyone.
    for (const inv of reopen) await reapplyDiscount(inv);
    return c.body(null, 204);
  });

  /** Add to my LB's card, from the guest's copy of the bill. */
  app.post('/invoices/:token', requireCard, async c => {
    const [inv] = await sql<{ id: number }[]>`select id from invoices where token = ${c.req.param('token') ?? ''}`;
    if (!inv) throw new HttpError(404, 'We couldn’t find that bill. The link may be incomplete.', 'not_found');
    await linkInvoice(inv.id, c.get('customerId'), 'guest');
    return c.json({ invoice: await getInvoice({ id: inv.id }, 'guest') });
  });

  return app;
}

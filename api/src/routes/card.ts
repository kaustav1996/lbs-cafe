import { Hono } from 'hono';
import { createHash, randomInt } from 'node:crypto';
import { z } from 'zod';
import { createMiddleware } from 'hono/factory';
import { sql } from '../db.js';
import { runtime } from '../context.js';
import { rateLimit, signCustomer, verifyCustomer } from '../auth.js';
import { HttpError, normalisePhone } from '../orders.js';
import { linkInvoice, loyaltySettings, reapplyDiscount, welcomesTaken } from '../loyalty.js';
import { publishInvoice } from '../invoices.js';

type CardEnv = { Variables: { customerId: number } };
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const COMING_SOON = "Claiming LB's card opens soon. Ask your server to add this bill to your card.";

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

/** A bill that might be claimed, by its guest link. */
async function claimable(token: string) {
  const [inv] = await sql<{ id: number; status: string; card_claimed_at: Date | null; old: boolean }[]>`
    select id, status, card_claimed_at, coalesce(paid_at < now() - interval '1 day', false) as old from invoices where token = ${token}`;
  if (!inv) throw new HttpError(404, 'We couldn’t find that bill. The link may be incomplete.', 'not_found');
  return inv;
}
function checkOpen(inv: Awaited<ReturnType<typeof claimable>>) {
  if (inv.status !== 'paid') throw new HttpError(409, 'Claim LB’s card once the bill is paid.', 'unpaid');
  if (inv.card_claimed_at) throw new HttpError(409, 'This bill is already on an LB’s card.', 'claimed');
  if (inv.old) throw new HttpError(409, 'This bill was paid more than a day ago, so it can’t go on a card now.', 'too_old');
}

/**
 * LB's card for guests. A card only starts from a paid bill: the guest claims it from their bill with a code
 * sent to their number, every time (even a number checked on an earlier visit). Then they see stamps and offers.
 */
export function cardRoutes() {
  const app = new Hono<CardEnv>();

  /** What the claim box on a bill needs: whether it can be claimed yet, and the number given at the table. */
  app.get('/claim/:token', async c => {
    const inv = await claimable(c.req.param('token') ?? '');
    const [guest] = await sql<{ name: string | null; phone: string | null }[]>`
      select customer_name as name, customer_phone as phone from orders
      where invoice_id = ${inv.id} and customer_phone is not null order by created_at desc limit 1`;
    return c.json({
      state: inv.card_claimed_at ? 'claimed' : inv.status !== 'paid' ? 'unpaid' : inv.old ? 'too_old' : runtime().messenger ? 'open' : 'soon',
      name: guest?.name ?? null,
      phone: guest?.phone ?? null,
    });
  });

  // Claiming LB's card from a paid bill: a code to the number (the one given at the table, or another), every time.
  app.post(
    '/claim/:token/code',
    rateLimit('card-code', 10, 10 * 60_000),
    rateLimit('card-code-phone', 3, 10 * 60_000, async c => normalisePhone(((await c.req.json().catch(() => ({}))) as { phone?: string }).phone) ?? ''),
    async c => {
      const b = z.object({ phone: z.string().trim().max(20) }).parse(await c.req.json());
      const inv = await claimable(c.req.param('token') ?? '');
      checkOpen(inv);
      const messenger = runtime().messenger;
      if (!messenger) throw new HttpError(503, COMING_SOON, 'card_off');
      const phone = normalisePhone(b.phone);
      if (!phone) throw new HttpError(400, 'Add a 10-digit mobile number.', 'bad_phone');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await sql`insert into customer_codes (phone, code_hash, invoice_id, expires_at)
                values (${phone}, ${hashCode(phone, code)}, ${inv.id}, now() + make_interval(mins => ${CODE_MINUTES}))`;
      await messenger.sendTemplate(phone, 'lbs_login_code', 'en', [code]);
      return c.body(null, 204);
    },
  );

  app.post('/claim/:token/verify', rateLimit('card-verify', 20, 10 * 60_000), async c => {
    const b = z
      .object({ phone: z.string().trim().max(20), code: z.string().trim().max(10), name: z.string().trim().max(60).optional(), optIn: z.boolean().default(false) })
      .parse(await c.req.json());
    const inv = await claimable(c.req.param('token') ?? '');
    checkOpen(inv);
    const phone = normalisePhone(b.phone);
    if (!phone) throw new HttpError(400, 'Add a 10-digit mobile number.', 'bad_phone');
    const id = await sql.begin(async tx => {
      const [row] = await tx<{ id: number; code_hash: string; attempts: number; expired: boolean }[]>`
        select id, code_hash, attempts, expires_at < now() as expired from customer_codes
        where phone = ${phone} and invoice_id = ${inv.id} order by created_at desc limit 1 for update`;
      if (!row || row.expired) throw new HttpError(400, 'That code has expired. Ask for a new one.', 'code_expired');
      if (row.attempts >= CODE_TRIES) throw new HttpError(400, 'Too many wrong tries. Ask for a new code.', 'code_locked');
      if (row.code_hash !== hashCode(phone, b.code)) {
        await tx`update customer_codes set attempts = attempts + 1 where id = ${row.id}`;
        return null;
      }
      await tx`delete from customer_codes where phone = ${phone}`;
      // One customer per number; the latest name given wins.
      const [cust] = await tx<{ id: number }[]>`
        insert into customers (phone, name, verified_at) values (${phone}, ${b.name || null}, now())
        on conflict (phone) do update set name = coalesce(excluded.name, customers.name), verified_at = now()
        returning id`;
      if (b.optIn) await tx`update customers set opted_in = true, opted_in_at = now(), opted_out_at = null where id = ${cust.id} and not opted_in`;
      return cust.id;
    });
    if (!id) throw new HttpError(400, "That code doesn't match. Check the latest message from LB's.", 'bad_code');
    await linkInvoice(inv.id, id, 'guest');
    await sql`update invoices set card_claimed_at = now(), card_claimed_phone = ${phone} where id = ${inv.id}`;
    publishInvoice(inv.id);
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

  return app;
}

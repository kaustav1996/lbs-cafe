import { Hono, type Context } from 'hono';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.js';
import { bus } from '../events.js';
import { rateLimit, signTablePass, verifyTablePass } from '../auth.js';
import { getInvoice, invoiceForOrder } from '../invoices.js';
import { confirmOrder, createOrder, getOrder, getSettings, HttpError, normalisePhone, releaseDue, upsertCustomer, withdrawOrder } from '../orders.js';

/**
 * The menu as a tree of sections, items and options.
 * - `live`: what guests (and the staff order picker) see: only dishes on the live menu, at the live menu's
 *   prices, sold-out ones included (marked by `available`), hidden dishes and sections left out.
 * - `all`: the full master list for the menu editor, normal prices, hidden things included.
 */
export async function menuTree(mode: 'live' | 'all' = 'live') {
  const all = mode === 'all';
  const cats = await sql`
    select id, slug, name, color, kind, sort, active from categories
    where ${all} or active order by sort, id`;
  const items = await sql`
    select i.id, i.category_id, i.slug, i.name, i.description, i.sort, i.active, i.available, i.featured, i.image_url
    from items i
    where ${all} or (i.active and exists (
      select 1 from menu_items mi join menus m on m.id = mi.menu_id where m.live and mi.item_id = i.id))
    order by i.sort, i.id`;
  const opts = all
    ? await sql`select id, item_id, label, diet, price_paise, sort, active from item_options order by sort, id`
    : await sql`
        select o.id, o.item_id, o.label, o.diet, coalesce(mp.price_paise, o.price_paise) as price_paise, o.sort, o.active
        from item_options o
        left join menu_prices mp on mp.option_id = o.id and mp.menu_id = (select id from menus where live)
        where o.active order by o.sort, o.id`;
  const optsByItem = new Map<number, any[]>();
  for (const o of opts) {
    if (!optsByItem.has(o.item_id)) optsByItem.set(o.item_id, []);
    optsByItem.get(o.item_id)!.push(o);
  }
  const itemsByCat = new Map<number, any[]>();
  for (const i of items) {
    const options = optsByItem.get(i.id) ?? [];
    if (!all && !options.length) continue;
    if (!itemsByCat.has(i.category_id)) itemsByCat.set(i.category_id, []);
    itemsByCat.get(i.category_id)!.push({ ...i, options });
  }
  return cats
    .map(c => ({ ...c, items: itemsByCat.get(c.id) ?? [] }))
    .filter(c => all || c.items.length > 0);
}

const OrderBody = z.object({
  mode: z.enum(['table', 'takeaway']),
  table: z.string().trim().max(10).optional(),
  pass: z.string().max(1000).optional(),
  name: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  note: z.string().trim().max(280).optional(),
  lines: z
    .array(z.object({ itemId: z.number().int().positive(), optionId: z.number().int().positive(), qty: z.number().int().min(1).max(50) }))
    .min(1)
    .max(60),
});

const ReservationBody = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().trim().min(8).max(20),
  partySize: z.number().int().min(1).max(50),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  note: z.string().trim().max(280).optional(),
});

/** What a customer's status page shows. No phone numbers or staff details. */
function publicOrder(o: any) {
  return {
    number: o.number,
    status: o.status,
    // While held: seconds until the kitchen gets it, from the server's clock (the phone's may be off).
    holdSecondsLeft: o.status === 'held' && o.hold_until ? Math.max(0, Math.ceil((new Date(o.hold_until).getTime() - Date.now()) / 1000)) : null,
    source: o.source,
    table: o.table_label,
    createdAt: o.created_at,
    paymentStatus: o.payment_status,
    totals: {
      subtotal: o.subtotal_paise,
      discount: o.discount_paise,
      cgst: o.cgst_paise,
      sgst: o.sgst_paise,
      roundOff: o.round_off_paise,
      total: o.total_paise,
    },
    lines: o.lines.map((l: any) => ({ name: l.name, option: l.option_label, qty: l.qty, unit: l.unit_paise, total: l.line_paise })),
  };
}

export function publicRoutes() {
  const app = new Hono();

  app.get('/menu', async c => c.json({ categories: await menuTree('live') }));

  app.get('/settings', async c => {
    const s = await getSettings();
    return c.json({
      gstRate: Number(s.gst_rate),
      hours: s.hours,
      orderingEnabled: !!s.ordering_enabled,
      takeawayEnabled: !!s.takeaway_enabled,
      bookingEnabled: !!s.booking_enabled,
      cafe: s.cafe,
      licences: s.licences ?? [],
    });
  });

  // Table orders count per IP and table, takeaway per IP.
  const orderKey = async (c: Context) => {
    const b = (await c.req.json().catch(() => ({}))) as { mode?: string; table?: string };
    return b?.mode === 'table' && typeof b.table === 'string' ? `t${b.table.trim().slice(0, 10)}` : '';
  };

  app.post('/tables/:label/verify', rateLimit('table-code', 5, 10 * 60_000, c => (c.req.param('label') ?? '').slice(0, 10)), async c => {
    const label = c.req.param('label');
    const { code } = z.object({ code: z.string().trim().max(10) }).parse(await c.req.json());
    const [t] = await sql<{ otp: string; sitting: number }[]>`select otp, sitting from dining_tables where label = ${label} and active`;
    if (!t) throw new HttpError(400, `There's no table "${label}". Check the number on your table's QR stand.`, 'bad_table');
    if (code !== t.otp) throw new HttpError(400, `That code doesn't match table ${label}. Check it with your server.`, 'bad_code');
    return c.json({ pass: await signTablePass({ table: label, sitting: t.sitting }) });
  });

  app.post('/orders', rateLimit('orders', 12, 10 * 60_000, orderKey), async c => {
    const body = OrderBody.parse(await c.req.json());
    if (body.mode === 'table' && !body.table) throw new HttpError(400, 'Add your table number. It’s on the QR stand.', 'no_table');
    if (body.mode === 'table') {
      const label = body.table!.trim();
      const [t] = await sql<{ sitting: number }[]>`select sitting from dining_tables where label = ${label} and active`;
      if (!t) throw new HttpError(400, `There's no table "${label}". Check the number on your table's QR stand.`, 'bad_table');
      const pass = await verifyTablePass(body.pass);
      if (!pass || pass.table !== label || pass.sitting !== t.sitting)
        throw new HttpError(403, `Ask your server for table ${label}'s code, then place the order again.`, 'table_code');
    }
    if (body.mode === 'takeaway' && !normalisePhone(body.phone))
      throw new HttpError(400, 'Add a 10-digit mobile number so we can call when your order is ready.', 'no_phone');
    const o = await createOrder({ source: body.mode, table: body.table, name: body.name, phone: body.phone, note: body.note, lines: body.lines });
    return c.json({ token: o!.token, order: publicOrder(o) }, 201);
  });

  app.get('/orders/:token', async c => {
    const [row] = await sql<{ id: number; due: boolean }[]>`
      select id, (status = 'held' and hold_until <= now()) as due from orders where token = ${c.req.param('token')}`;
    if (!row) throw new HttpError(404, 'We couldn’t find that order. The link may be incomplete.', 'not_found');
    if (row.due) await releaseDue(); // backstop if the release alarm is running late
    return c.json({ order: publicOrder(await getOrder(row.id)) });
  });

  // Confirm order: the guest is happy, send it to the kitchen without waiting out the hold. Safe to repeat.
  app.post('/orders/:token/confirm', rateLimit('withdraw', 20, 10 * 60_000), async c =>
    c.json({ order: publicOrder(await getOrder(await confirmOrder(c.req.param('token') ?? ''))) }),
  );

  // Change order: only while the order is still held.
  app.post('/orders/:token/withdraw', rateLimit('withdraw', 20, 10 * 60_000), async c =>
    c.json({ lines: await withdrawOrder(c.req.param('token') ?? '') }),
  );

  app.post('/service-requests', rateLimit('service', 10, 5 * 60_000), async c => {
    const body = z.object({ table: z.string().trim().min(1).max(10), kind: z.enum(['water', 'bill', 'server']) }).parse(await c.req.json());
    const r = await callServer(body.table, body.kind);
    return r.duplicate ? c.json(r) : c.json({ id: r.id }, 201);
  });

  // Get the bill at a table: tell the staff first (always), then open the visit's bill for this phone.
  app.post('/tables/:label/bill', rateLimit('bill', 10, 10 * 60_000, c => (c.req.param('label') ?? '').slice(0, 10)), async c => {
    const label = c.req.param('label') ?? '';
    const { pass } = z.object({ pass: z.string().max(1000).optional() }).parse(await c.req.json().catch(() => ({})));
    await callServer(label, 'bill');
    const [t] = await sql<{ sitting: number }[]>`select sitting from dining_tables where label = ${label} and active`;
    const p = await verifyTablePass(pass);
    if (!p || p.table !== label || p.sitting !== t.sitting)
      throw new HttpError(403, `Ask your server for table ${label}'s code, then get the bill again.`, 'table_code');
    const [o] = await sql<{ id: number }[]>`
      select id from orders where table_label = ${label} and sitting = ${t.sitting} and status not in ('held', 'cancelled')
      order by id limit 1`;
    if (!o) throw new HttpError(400, `There's nothing on table ${label}'s bill yet.`, 'nothing_to_bill');
    const inv = await invoiceForOrder(o.id, null, () => {
      throw new HttpError(400, `There's nothing on table ${label}'s bill yet.`, 'nothing_to_bill');
    });
    return c.json({ token: inv.token });
  });

  // Get the bill from an order's status page (takeaway, or a table order from this phone).
  app.post('/orders/:token/bill', rateLimit('bill', 10, 10 * 60_000), async c => {
    const [o] = await sql<{ id: number }[]>`select id from orders where token = ${c.req.param('token') ?? ''}`;
    if (!o) throw new HttpError(404, 'We couldn’t find that order. The link may be incomplete.', 'not_found');
    const inv = await invoiceForOrder(o.id, null, () => {
      throw new HttpError(400, 'Your order is still on its way to the kitchen. Get the bill in a minute.', 'nothing_to_bill');
    });
    return c.json({ token: inv.token });
  });

  app.get('/invoices/:token', async c => {
    const inv = await getInvoice({ token: c.req.param('token') ?? '' }, 'guest');
    if (!inv) throw new HttpError(404, 'We couldn’t find that bill. The link may be incomplete.', 'not_found');
    return c.json({ invoice: inv });
  });

  app.post('/reservations', rateLimit('reservations', 5, 10 * 60_000), async c => {
    const body = ReservationBody.parse(await c.req.json());
    const s = await getSettings();
    if (!s.booking_enabled) throw new HttpError(403, `Online bookings are paused. Call ${s.cafe?.phone ?? 'us'} to book.`, 'booking_off');
    const phone = normalisePhone(body.phone);
    if (!phone) throw new HttpError(400, 'Add a 10-digit mobile number.', 'bad_phone');
    const startsAt = new Date(`${body.date}T${body.time}:00+05:30`);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() + 15 * 60_000)
      throw new HttpError(400, 'Pick a time at least 15 minutes from now.', 'too_soon');
    const day = new Date(`${body.date}T12:00:00+05:30`).getUTCDay();
    const h = (s.hours as { open: string; close: string }[])[day];
    if (body.time < h.open || body.time > h.close) throw new HttpError(400, `We’re open ${h.open} to ${h.close} that day.`, 'closed');
    const ref = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    const r = await sql.begin(async tx => {
      const customerId = await upsertCustomer(tx, phone, body.name);
      const [row] = await tx<{ id: number; ref: string }[]>`
        insert into reservations (ref, name, phone, party_size, starts_at, note, source, customer_id)
        values (${ref}, ${body.name}, ${phone}, ${body.partySize}, ${startsAt}, ${body.note ?? null}, 'web', ${customerId})
        returning id, ref`;
      return row;
    });
    bus.publish({ type: 'reservation.created', id: r.id, ref: r.ref });
    return c.json({ ref: r.ref, status: 'pending' }, 201);
  });

  return app;
}

/** A waiter call from a table. One open request of each kind per table is enough. */
async function callServer(table: string, kind: 'water' | 'bill' | 'server') {
  const [t] = await sql`select 1 from dining_tables where label = ${table} and active`;
  if (!t) throw new HttpError(400, `There's no table "${table}".`, 'bad_table');
  const [existing] = await sql<{ id: number }[]>`
    select id from service_requests where table_label = ${table} and kind = ${kind} and status = 'open'`;
  if (existing) return { id: existing.id, duplicate: true };
  const [r] = await sql<{ id: number }[]>`insert into service_requests (table_label, kind) values (${table}, ${kind}) returning id`;
  bus.publish({ type: 'service.created', id: r.id, table, kind });
  return { id: r.id, duplicate: false };
}

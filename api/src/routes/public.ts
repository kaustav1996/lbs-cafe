import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.js';
import { bus } from '../events.js';
import { createOrder, getOrder, getSettings, HttpError, normalisePhone, upsertCustomer } from '../orders.js';

export async function menuTree(includeHidden = false) {
  const cats = await sql`
    select id, slug, name, color, kind, sort, active from categories
    where ${includeHidden} or active order by sort, id`;
  const items = await sql`
    select i.id, i.category_id, i.slug, i.name, i.description, i.sort, i.active, i.available, i.featured, i.image_url
    from items i where ${includeHidden} or i.active order by i.sort, i.id`;
  const opts = await sql`
    select id, item_id, label, diet, price_paise, sort, active from item_options
    where ${includeHidden} or active order by sort, id`;
  const optsByItem = new Map<number, any[]>();
  for (const o of opts) {
    if (!optsByItem.has(o.item_id)) optsByItem.set(o.item_id, []);
    optsByItem.get(o.item_id)!.push(o);
  }
  const itemsByCat = new Map<number, any[]>();
  for (const i of items) {
    const options = optsByItem.get(i.id) ?? [];
    if (!includeHidden && !options.length) continue;
    if (!itemsByCat.has(i.category_id)) itemsByCat.set(i.category_id, []);
    itemsByCat.get(i.category_id)!.push({ ...i, options });
  }
  return cats
    .map(c => ({ ...c, items: itemsByCat.get(c.id) ?? [] }))
    .filter(c => includeHidden || c.items.length > 0);
}

const OrderBody = z.object({
  mode: z.enum(['table', 'takeaway']),
  table: z.string().trim().max(10).optional(),
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

export async function publicRoutes(app: FastifyInstance) {
  app.get('/menu', async () => ({ categories: await menuTree(false) }));

  app.get('/settings', async () => {
    const s = await getSettings();
    return {
      gstRate: Number(s.gst_rate),
      hours: s.hours,
      orderingEnabled: !!s.ordering_enabled,
      takeawayEnabled: !!s.takeaway_enabled,
      bookingEnabled: !!s.booking_enabled,
      cafe: s.cafe,
    };
  });

  app.post('/orders', { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = OrderBody.parse(req.body);
    if (body.mode === 'table' && !body.table) throw new HttpError(400, 'Add your table number. It’s on the QR stand.', 'no_table');
    if (body.mode === 'takeaway' && !normalisePhone(body.phone))
      throw new HttpError(400, 'Add a 10-digit mobile number so we can call when your order is ready.', 'no_phone');
    const o = await createOrder({ source: body.mode, table: body.table, name: body.name, phone: body.phone, note: body.note, lines: body.lines });
    reply.code(201);
    return { token: o!.token, order: publicOrder(o) };
  });

  app.get<{ Params: { token: string } }>('/orders/:token', async req => {
    const [row] = await sql<{ id: number }[]>`select id from orders where token = ${req.params.token}`;
    if (!row) throw new HttpError(404, 'We couldn’t find that order. The link may be incomplete.', 'not_found');
    return { order: publicOrder(await getOrder(row.id)) };
  });

  app.post('/service-requests', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = z.object({ table: z.string().trim().min(1).max(10), kind: z.enum(['water', 'bill', 'server']) }).parse(req.body);
    const [t] = await sql`select 1 from dining_tables where label = ${body.table} and active`;
    if (!t) throw new HttpError(400, `There's no table "${body.table}".`, 'bad_table');
    // One open request of each kind per table is enough.
    const [existing] = await sql<{ id: number }[]>`
      select id from service_requests where table_label = ${body.table} and kind = ${body.kind} and status = 'open'`;
    if (existing) return { id: existing.id, duplicate: true };
    const [r] = await sql<{ id: number }[]>`
      insert into service_requests (table_label, kind) values (${body.table}, ${body.kind}) returning id`;
    bus.publish({ type: 'service.created', id: r.id, table: body.table, kind: body.kind });
    reply.code(201);
    return { id: r.id };
  });

  app.post('/reservations', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = ReservationBody.parse(req.body);
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
    reply.code(201);
    return { ref: r.ref, status: 'pending' };
  });
}

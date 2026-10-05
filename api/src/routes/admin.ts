import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.js';
import { bus } from '../events.js';
import { atLeast, requireStaff } from '../auth.js';
import { addLines, addPayment, createOrder, getOrder, getSettings, HttpError, normalisePhone, publishUpdate, recalc, upsertCustomer } from '../orders.js';
import { menuTree } from './public.js';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LineIn = z.object({ itemId: z.number().int().positive(), optionId: z.number().int().positive(), qty: z.number().int().min(1).max(99) });
const Method = z.enum(['cash', 'upi', 'card', 'other']);
const OPEN_STATUSES = ['new', 'preparing', 'ready', 'served'];

/** Kolkata calendar days -> [start, end) instants. */
export function dayRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T00:00:00+05:30`);
  end.setUTCDate(end.getUTCDate() + 1);
  if (end <= start) throw new HttpError(400, 'The end date is before the start date.', 'bad_range');
  return { start, end };
}

export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function csv(rows: (string | number | null)[][]) {
  return rows
    .map(r => r.map(v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','))
    .join('\n');
}
const r2 = (paise: number) => (paise / 100).toFixed(2);

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireStaff);

  // ---------- Orders ----------
  app.get('/orders', async req => {
    const q = z
      .object({ view: z.enum(['open', 'day']).default('open'), date: Day.optional(), search: z.string().trim().max(40).optional() })
      .parse(req.query);
    if (q.view === 'open') {
      // Everything the floor still has to act on: not finished, or finished but not paid.
      const rows = await sql`
        select o.*, (select coalesce(json_agg(json_build_object('name', l.name, 'option', l.option_label, 'qty', l.qty, 'diet', l.diet) order by l.id), '[]')
                     from order_lines l where l.order_id = o.id) as lines
        from orders o
        where o.status = any(${OPEN_STATUSES}) or (o.status = 'completed' and o.payment_status <> 'paid' and o.created_at > now() - interval '2 days')
        order by o.created_at asc`;
      return { orders: rows };
    }
    const { start, end } = dayRange(q.date ?? todayIST(), q.date ?? todayIST());
    const s = q.search ? `%${q.search}%` : null;
    const rows = await sql`
      select o.*, (select coalesce(json_agg(json_build_object('name', l.name, 'option', l.option_label, 'qty', l.qty, 'diet', l.diet) order by l.id), '[]')
                   from order_lines l where l.order_id = o.id) as lines
      from orders o
      where o.created_at >= ${start} and o.created_at < ${end}
        and (${s}::text is null or o.number::text like ${s} or o.customer_name ilike ${s} or o.customer_phone like ${s} or o.table_label = ${q.search ?? ''})
      order by o.created_at desc`;
    return { orders: rows };
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async req => {
    const o = await getOrder(Number(req.params.id));
    if (!o) throw new HttpError(404, 'Order not found.', 'not_found');
    return { order: o };
  });

  app.post('/orders', async (req, reply) => {
    const b = z
      .object({
        source: z.enum(['table', 'takeaway', 'counter']),
        table: z.string().trim().max(10).optional(),
        name: z.string().trim().max(60).optional(),
        phone: z.string().trim().max(20).optional(),
        note: z.string().trim().max(280).optional(),
        lines: z.array(LineIn).min(1).max(80),
        discountPaise: z.number().int().min(0).optional(),
        discountNote: z.string().trim().max(80).optional(),
        payment: z.object({ method: Method, amountPaise: z.number().int().positive(), reference: z.string().max(60).optional() }).optional(),
      })
      .parse(req.body);
    if (b.source === 'table' && !b.table) throw new HttpError(400, 'Pick a table for a dine-in order.', 'no_table');
    let o = await createOrder({ ...b, staffId: req.staff!.sub });
    if (b.payment && o) o = await addPayment(o.id, b.payment.method, b.payment.amountPaise, req.staff!.sub, b.payment.reference);
    reply.code(201);
    return { order: o };
  });

  app.patch<{ Params: { id: string } }>('/orders/:id', async req => {
    const id = Number(req.params.id);
    const b = z
      .object({
        status: z.enum(['new', 'preparing', 'ready', 'served', 'completed', 'cancelled']).optional(),
        discountPaise: z.number().int().min(0).optional(),
        discountNote: z.string().trim().max(80).nullable().optional(),
        note: z.string().trim().max(280).nullable().optional(),
        table: z.string().trim().max(10).nullable().optional(),
      })
      .parse(req.body);
    if ((b.status === 'cancelled' || b.discountPaise !== undefined) && req.staff!.role === 'staff')
      throw new HttpError(403, 'Only a manager can cancel an order or give a discount.', 'forbidden');
    await sql.begin(async tx => {
      const [o] = await tx<{ id: number; status: string }[]>`select id, status from orders where id = ${id} for update`;
      if (!o) throw new HttpError(404, 'Order not found.', 'not_found');
      if (b.status) {
        const closing = b.status === 'completed' || b.status === 'cancelled';
        await tx`update orders set status = ${b.status}, closed_at = ${closing ? new Date() : null}, updated_at = now() where id = ${id}`;
      }
      if (b.note !== undefined) await tx`update orders set note = ${b.note}, updated_at = now() where id = ${id}`;
      if (b.table !== undefined) await tx`update orders set table_label = ${b.table}, updated_at = now() where id = ${id}`;
      if (b.discountPaise !== undefined) {
        await tx`update orders set discount_paise = ${b.discountPaise}, discount_note = ${b.discountNote ?? null} where id = ${id}`;
        await recalc(tx, id);
      }
    });
    return { order: await publishUpdate(id) };
  });

  app.post<{ Params: { id: string } }>('/orders/:id/lines', async req => {
    const b = z.object({ lines: z.array(LineIn).min(1).max(40) }).parse(req.body);
    return { order: await addLines(Number(req.params.id), b.lines) };
  });

  app.patch<{ Params: { id: string; lineId: string } }>('/orders/:id/lines/:lineId', async req => {
    const id = Number(req.params.id);
    const b = z.object({ qty: z.number().int().min(0).max(99) }).parse(req.body);
    await sql.begin(async tx => {
      const [o] = await tx<{ status: string }[]>`select status from orders where id = ${id} for update`;
      if (!o) throw new HttpError(404, 'Order not found.', 'not_found');
      if (o.status === 'completed' || o.status === 'cancelled') throw new HttpError(409, 'This order is closed.', 'closed');
      if (b.qty === 0) {
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from order_lines where order_id = ${id}`;
        if (n <= 1) throw new HttpError(409, 'An order needs at least one item. Cancel the order instead.', 'last_line');
        await tx`delete from order_lines where id = ${Number(req.params.lineId)} and order_id = ${id}`;
      } else {
        await tx`update order_lines set qty = ${b.qty}, line_paise = unit_paise * ${b.qty}
                 where id = ${Number(req.params.lineId)} and order_id = ${id}`;
      }
      await recalc(tx, id);
    });
    return { order: await publishUpdate(id) };
  });

  app.post<{ Params: { id: string } }>('/orders/:id/payments', async req => {
    const b = z.object({ method: Method, amountPaise: z.number().int().positive(), reference: z.string().max(60).optional() }).parse(req.body);
    return { order: await addPayment(Number(req.params.id), b.method, b.amountPaise, req.staff!.sub, b.reference) };
  });

  // ---------- Service requests (call a server) ----------
  app.get('/service-requests', async () => ({
    requests: await sql`select * from service_requests where status = 'open' order by created_at`,
  }));
  app.patch<{ Params: { id: string } }>('/service-requests/:id', async req => {
    const id = Number(req.params.id);
    await sql`update service_requests set status = 'done', done_at = now(), done_by = ${req.staff!.sub} where id = ${id}`;
    bus.publish({ type: 'service.updated', id });
    return { ok: true };
  });

  // ---------- Menu ----------
  app.get('/menu', async () => ({ categories: await menuTree(true) }));

  const CategoryIn = z.object({
    name: z.string().trim().min(1).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    kind: z.enum(['food', 'drink']).optional(),
    sort: z.number().int().optional(),
    active: z.boolean().optional(),
  });
  const slugify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  app.post('/categories', { preHandler: atLeast('manager') }, async (req, reply) => {
    const b = CategoryIn.parse(req.body);
    const [{ max }] = await sql<{ max: number }[]>`select coalesce(max(sort), 0)::int as max from categories`;
    const [c] = await sql`
      insert into categories (slug, name, color, kind, sort)
      values (${slugify(b.name) + '-' + randomBytes(2).toString('hex')}, ${b.name}, ${b.color ?? '#FFE24A'}, ${b.kind ?? 'food'}, ${b.sort ?? max + 10})
      returning *`;
    bus.publish({ type: 'menu.updated' });
    reply.code(201);
    return { category: c };
  });

  app.patch<{ Params: { id: string } }>('/categories/:id', { preHandler: atLeast('manager') }, async req => {
    const b = CategoryIn.partial().parse(req.body);
    const [c] = await sql`
      update categories set
        name = coalesce(${b.name ?? null}, name), color = coalesce(${b.color ?? null}, color),
        kind = coalesce(${b.kind ?? null}, kind), sort = coalesce(${b.sort ?? null}, sort),
        active = coalesce(${b.active ?? null}, active)
      where id = ${Number(req.params.id)} returning *`;
    if (!c) throw new HttpError(404, 'Section not found.', 'not_found');
    bus.publish({ type: 'menu.updated' });
    return { category: c };
  });

  const OptionIn = z.object({
    id: z.number().int().positive().optional(),
    label: z.string().trim().max(30).default(''),
    diet: z.enum(['veg', 'nonveg', 'unknown']),
    pricePaise: z.number().int().min(0).max(10_000_000),
  });
  const ItemIn = z.object({
    categoryId: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).nullable().optional(),
    active: z.boolean().optional(),
    available: z.boolean().optional(),
    featured: z.boolean().optional(),
    imageUrl: z.string().url().max(500).nullable().optional(),
    sort: z.number().int().optional(),
    options: z.array(OptionIn).min(1).max(8),
  });

  async function saveOptions(tx: any, itemId: number, options: z.infer<typeof OptionIn>[]) {
    // Options that disappear are switched off rather than deleted, so old bills keep their links.
    const keep = options.filter(o => o.id).map(o => o.id!);
    await tx`update item_options set active = false where item_id = ${itemId} and not (id = any(${keep}))`;
    for (const [i, o] of options.entries()) {
      if (o.id) {
        await tx`update item_options set label = ${o.label}, diet = ${o.diet}, price_paise = ${o.pricePaise}, sort = ${i}, active = true
                 where id = ${o.id} and item_id = ${itemId}`;
      } else {
        await tx`insert into item_options (item_id, label, diet, price_paise, sort) values (${itemId}, ${o.label}, ${o.diet}, ${o.pricePaise}, ${i})`;
      }
    }
  }

  app.post('/items', { preHandler: atLeast('manager') }, async (req, reply) => {
    const b = ItemIn.parse(req.body);
    const item = await sql.begin(async tx => {
      const [{ max }] = await tx<{ max: number }[]>`select coalesce(max(sort), 0)::int as max from items where category_id = ${b.categoryId}`;
      const [it] = await tx<{ id: number }[]>`
        insert into items (category_id, slug, name, description, active, available, featured, image_url, sort)
        values (${b.categoryId}, ${slugify(b.name) + '-' + randomBytes(3).toString('hex')}, ${b.name}, ${b.description ?? null},
                ${b.active ?? true}, ${b.available ?? true}, ${b.featured ?? false}, ${b.imageUrl ?? null}, ${b.sort ?? max + 10})
        returning id`;
      await saveOptions(tx, it.id, b.options);
      return it;
    });
    bus.publish({ type: 'menu.updated' });
    reply.code(201);
    return { id: item.id };
  });

  app.patch<{ Params: { id: string } }>('/items/:id', async req => {
    const id = Number(req.params.id);
    const b = ItemIn.partial().parse(req.body);
    // Staff can mark things sold out; everything else needs a manager.
    const onlyAvailability = Object.keys(b).every(k => k === 'available');
    if (!onlyAvailability && req.staff!.role === 'staff') throw new HttpError(403, 'Only a manager can edit menu items.', 'forbidden');
    await sql.begin(async tx => {
      const [it] = await tx`
        update items set
          category_id = coalesce(${b.categoryId ?? null}, category_id), name = coalesce(${b.name ?? null}, name),
          description = ${b.description === undefined ? sql`description` : b.description},
          active = coalesce(${b.active ?? null}, active), available = coalesce(${b.available ?? null}, available),
          featured = coalesce(${b.featured ?? null}, featured),
          image_url = ${b.imageUrl === undefined ? sql`image_url` : b.imageUrl},
          sort = coalesce(${b.sort ?? null}, sort), updated_at = now()
        where id = ${id} returning id`;
      if (!it) throw new HttpError(404, 'Item not found.', 'not_found');
      if (b.options) await saveOptions(tx, id, b.options);
    });
    bus.publish({ type: 'menu.updated' });
    return { ok: true };
  });

  // ---------- Reservations ----------
  app.get('/reservations', async req => {
    const q = z.object({ from: Day.optional(), to: Day.optional(), status: z.string().optional() }).parse(req.query);
    const from = q.from ?? todayIST();
    const { start, end } = dayRange(from, q.to ?? from);
    const rows = await sql`
      select * from reservations
      where starts_at >= ${start} and starts_at < ${end} and (${q.status ?? null}::text is null or status = ${q.status ?? ''})
      order by starts_at`;
    const [{ pending }] = await sql<{ pending: number }[]>`
      select count(*)::int as pending from reservations where status = 'pending' and starts_at > now() - interval '2 hours'`;
    return { reservations: rows, pending };
  });

  app.post('/reservations', async (req, reply) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(60),
        phone: z.string().trim().min(8).max(20),
        partySize: z.number().int().min(1).max(50),
        date: Day,
        time: z.string().regex(/^\d{2}:\d{2}$/),
        table: z.string().trim().max(10).optional(),
        note: z.string().trim().max(280).optional(),
      })
      .parse(req.body);
    const phone = normalisePhone(b.phone);
    if (!phone) throw new HttpError(400, 'Add a 10-digit mobile number.', 'bad_phone');
    const ref = randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    const r = await sql.begin(async tx => {
      const customerId = await upsertCustomer(tx, phone, b.name);
      const [row] = await tx`
        insert into reservations (ref, name, phone, party_size, starts_at, table_label, note, status, source, customer_id)
        values (${ref}, ${b.name}, ${phone}, ${b.partySize}, ${new Date(`${b.date}T${b.time}:00+05:30`)}, ${b.table ?? null},
                ${b.note ?? null}, 'confirmed', 'staff', ${customerId})
        returning *`;
      return row;
    });
    bus.publish({ type: 'reservation.created', id: r.id, ref: r.ref });
    reply.code(201);
    return { reservation: r };
  });

  app.patch<{ Params: { id: string } }>('/reservations/:id', async req => {
    const b = z
      .object({
        status: z.enum(['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'rejected', 'no_show']).optional(),
        table: z.string().trim().max(10).nullable().optional(),
        partySize: z.number().int().min(1).max(50).optional(),
        note: z.string().trim().max(280).nullable().optional(),
      })
      .parse(req.body);
    const [r] = await sql`
      update reservations set
        status = coalesce(${b.status ?? null}, status),
        table_label = ${b.table === undefined ? sql`table_label` : b.table},
        party_size = coalesce(${b.partySize ?? null}, party_size),
        note = ${b.note === undefined ? sql`note` : b.note},
        updated_at = now()
      where id = ${Number(req.params.id)} returning *`;
    if (!r) throw new HttpError(404, 'Booking not found.', 'not_found');
    bus.publish({ type: 'reservation.updated', id: r.id });
    return { reservation: r };
  });

  // ---------- Reports ----------
  app.get('/reports/summary', async req => {
    const q = z.object({ from: Day, to: Day }).parse(req.query);
    const { start, end } = dayRange(q.from, q.to);
    const [totals] = await sql`
      select count(*)::int as orders,
             coalesce(sum(total_paise), 0)::bigint as gross,
             coalesce(sum(subtotal_paise), 0)::bigint as subtotal,
             coalesce(sum(discount_paise), 0)::bigint as discount,
             coalesce(sum(taxable_paise), 0)::bigint as taxable,
             coalesce(sum(cgst_paise), 0)::bigint as cgst,
             coalesce(sum(sgst_paise), 0)::bigint as sgst,
             coalesce(sum(greatest(total_paise - paid_paise, 0)), 0)::bigint as unpaid
      from orders where status <> 'cancelled' and created_at >= ${start} and created_at < ${end}`;
    const [{ cancelled }] = await sql`
      select count(*)::int as cancelled from orders where status = 'cancelled' and created_at >= ${start} and created_at < ${end}`;
    const byMethod = await sql`
      select method, count(*)::int as count, sum(amount_paise)::bigint as amount
      from payments where created_at >= ${start} and created_at < ${end} group by method order by amount desc`;
    const bySource = await sql`
      select source, count(*)::int as orders, sum(total_paise)::bigint as amount
      from orders where status <> 'cancelled' and created_at >= ${start} and created_at < ${end} group by source`;
    const daily = await sql`
      select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*)::int as orders, sum(total_paise)::bigint as amount
      from orders where status <> 'cancelled' and created_at >= ${start} and created_at < ${end} group by 1 order by 1`;
    const hourly = await sql`
      select extract(hour from created_at at time zone 'Asia/Kolkata')::int as hour, count(*)::int as orders
      from orders where status <> 'cancelled' and created_at >= ${start} and created_at < ${end} group by 1 order by 1`;
    const topItems = await sql`
      select l.name, sum(l.qty)::int as qty, sum(l.line_paise)::bigint as amount
      from order_lines l join orders o on o.id = l.order_id
      where o.status <> 'cancelled' and o.created_at >= ${start} and o.created_at < ${end}
      group by l.name order by qty desc, amount desc limit 10`;
    return { range: q, totals: { ...totals, cancelled }, byMethod, bySource, daily, hourly, topItems };
  });

  app.get('/reports/gst', async (req, reply) => {
    const q = z.object({ from: Day, to: Day, format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
    const { start, end } = dayRange(q.from, q.to);
    const rows = await sql`
      select number, created_at, to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as at,
             coalesce(customer_name, case source when 'table' then 'Table ' || table_label else initcap(source) end) as customer,
             subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, round_off_paise, total_paise, payment_status
      from orders where status <> 'cancelled' and created_at >= ${start} and created_at < ${end} order by created_at`;
    if (q.format === 'csv') {
      const s = await getSettings();
      const head = [['Order', 'Date', 'Customer', 'Subtotal', 'Discount', 'Taxable value', `CGST ${Number(s.gst_rate) * 50}%`, `SGST ${Number(s.gst_rate) * 50}%`, 'Round off', 'Total', 'Payment']];
      const body = rows.map(r => [r.number, r.at, r.customer, r2(r.subtotal_paise), r2(r.discount_paise), r2(r.taxable_paise), r2(r.cgst_paise), r2(r.sgst_paise), r2(r.round_off_paise), r2(r.total_paise), r.payment_status]);
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="lbs-gst-${q.from}-to-${q.to}.csv"`);
      return csv([...head, ...body]);
    }
    return { rows };
  });

  // ---------- Customers ----------
  app.get('/customers', async (req, reply) => {
    const q = z.object({ search: z.string().trim().max(40).optional(), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
    const s = q.search ? `%${q.search}%` : null;
    const rows = await sql`
      select c.*, (select count(*)::int from orders o where o.customer_id = c.id) as orders,
                  (select count(*)::int from reservations r where r.customer_id = c.id) as bookings
      from customers c
      where ${s}::text is null or c.name ilike ${s} or c.phone like ${s} or c.email ilike ${s}
      order by c.last_seen_at desc limit 500`;
    if (q.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="lbs-customers.csv"');
      return csv([
        ['Name', 'Phone', 'Email', 'Orders', 'Bookings', 'Paid visits', 'Spent (₹)', 'First seen', 'Last seen'],
        ...rows.map(r => [r.name, r.phone, r.email, r.orders, r.bookings, r.visits, r2(Number(r.spent_paise)), r.created_at.toISOString().slice(0, 10), r.last_seen_at.toISOString().slice(0, 10)]),
      ]);
    }
    return { customers: rows };
  });

  // ---------- Settings & tables ----------
  app.get('/settings', async () => ({ settings: await getSettings() }));

  app.put('/settings', { preHandler: atLeast('manager') }, async req => {
    const b = z
      .object({
        gst_rate: z.number().min(0).max(0.28).optional(),
        hours: z.array(z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })).length(7).optional(),
        ordering_enabled: z.boolean().optional(),
        takeaway_enabled: z.boolean().optional(),
        booking_enabled: z.boolean().optional(),
        cafe: z
          .object({ name: z.string().max(80), address: z.string().max(160), phone: z.string().max(20), email: z.string().max(80), gstin: z.string().max(15) })
          .partial()
          .optional(),
      })
      .parse(req.body);
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      if (k === 'cafe') {
        await sql`update settings set value = value || ${sql.json(v as never)} where key = 'cafe'`;
      } else {
        await sql`insert into settings (key, value) values (${k}, ${sql.json(v as never)})
                  on conflict (key) do update set value = excluded.value`;
      }
    }
    bus.publish({ type: 'menu.updated' });
    return { settings: await getSettings() };
  });

  app.get('/tables', async () => ({ tables: await sql`select * from dining_tables order by sort, id` }));
  app.post('/tables', { preHandler: atLeast('manager') }, async (req, reply) => {
    const b = z.object({ label: z.string().trim().min(1).max(10), seats: z.number().int().min(1).max(30).default(4) }).parse(req.body);
    const [{ max }] = await sql<{ max: number }[]>`select coalesce(max(sort), 0)::int as max from dining_tables`;
    const [t] = await sql`insert into dining_tables (label, seats, sort) values (${b.label}, ${b.seats}, ${max + 1})
                          on conflict (label) do update set active = true returning *`;
    reply.code(201);
    return { table: t };
  });
  app.patch<{ Params: { id: string } }>('/tables/:id', { preHandler: atLeast('manager') }, async req => {
    const b = z.object({ seats: z.number().int().min(1).max(30).optional(), active: z.boolean().optional() }).parse(req.body);
    const [t] = await sql`update dining_tables set seats = coalesce(${b.seats ?? null}, seats), active = coalesce(${b.active ?? null}, active)
                          where id = ${Number(req.params.id)} returning *`;
    return { table: t };
  });

  // ---------- Staff ----------
  app.get('/staff', { preHandler: atLeast('manager') }, async () => ({
    staff: await sql`select id, name, email, role, active, created_at from staff order by id`,
  }));
  app.post('/staff', { preHandler: atLeast('owner') }, async (req, reply) => {
    const b = z
      .object({ name: z.string().trim().min(1).max(60), email: z.string().email(), password: z.string().min(8).max(100), role: z.enum(['owner', 'manager', 'staff']) })
      .parse(req.body);
    const hash = await bcrypt.hash(b.password, 11);
    const [s] = await sql`insert into staff (name, email, password_hash, role) values (${b.name}, ${b.email.toLowerCase()}, ${hash}, ${b.role})
                          on conflict (email) do nothing returning id, name, email, role, active`;
    if (!s) throw new HttpError(409, 'Someone already signs in with that email.', 'exists');
    reply.code(201);
    return { staff: s };
  });
  app.patch<{ Params: { id: string } }>('/staff/:id', { preHandler: atLeast('owner') }, async req => {
    const id = Number(req.params.id);
    const b = z.object({ role: z.enum(['owner', 'manager', 'staff']).optional(), active: z.boolean().optional(), password: z.string().min(8).optional() }).parse(req.body);
    if (id === req.staff!.sub && (b.active === false || (b.role && b.role !== 'owner')))
      throw new HttpError(409, 'You can’t switch off or demote your own account.', 'self');
    const hash = b.password ? await bcrypt.hash(b.password, 11) : null;
    const [s] = await sql`update staff set role = coalesce(${b.role ?? null}, role), active = coalesce(${b.active ?? null}, active),
                            password_hash = coalesce(${hash}, password_hash)
                          where id = ${id} returning id, name, email, role, active`;
    return { staff: s };
  });
}

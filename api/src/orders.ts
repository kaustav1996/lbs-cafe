import { randomBytes } from 'node:crypto';
import { sql, type Tx } from './db.js';
import { computeTotals } from './money.js';
import { bus } from './events.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'bad_request') {
    super(message);
  }
}

/**
 * A table is busy while it has an order that's held, still with the kitchen or floor, or completed but
 * unpaid in the last 2 days (the same window as the open board). When it goes from busy to free the
 * sitting moves on and the code changes (see freeTableCheck).
 */
const BUSY_STATUSES = ['held', 'new', 'preparing', 'ready', 'served'];

async function tableBusy(tx: Tx, label: string) {
  const [r] = await tx<{ busy: boolean }[]>`
    select exists (
      select 1 from orders where table_label = ${label} and (
        status = any(${BUSY_STATUSES})
        or (status = 'completed' and payment_status <> 'paid' and created_at > now() - interval '2 days'))
    ) as busy`;
  return r.busy;
}

/** Locks the table's row for the rest of the transaction and says whether it's busy right now. */
export async function lockTable(tx: Tx, label: string | null | undefined): Promise<boolean> {
  if (!label) return false;
  await tx`select 1 from dining_tables where label = ${label} for update`;
  return tableBusy(tx, label);
}

/** New sitting and a fresh code. Returns the table id so the caller can publish table.updated after commit. */
export async function newSitting(tx: Tx, label: string): Promise<number | null> {
  const [t] = await tx<{ id: number }[]>`
    update dining_tables set sitting = sitting + 1, otp = lpad(floor(random() * 10000)::int::text, 4, '0')
    where label = ${label} returning id`;
  return t?.id ?? null;
}

/** Call after a change that may free a table, with what lockTable() returned before the change. */
export async function freeTableCheck(tx: Tx, label: string | null | undefined, wasBusy: boolean): Promise<number | null> {
  if (!label || !wasBusy || (await tableBusy(tx, label))) return null;
  return newSitting(tx, label);
}

export function publishTable(id: number | null) {
  if (id) bus.publish({ type: 'table.updated', id });
}

export async function getSettings(db: typeof sql | Tx = sql): Promise<Record<string, any>> {
  const rows = await db<{ key: string; value: unknown }[]>`select key, value from settings`;
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export interface LineInput {
  itemId: number;
  optionId: number;
  qty: number;
}

interface PricedLine {
  item_id: number;
  option_id: number;
  name: string;
  option_label: string;
  diet: string;
  unit_paise: number;
  qty: number;
  line_paise: number;
}

/** Looks every line up in the live menu so the browser never decides a price. */
async function priceLines(tx: Tx, lines: LineInput[], allowUnavailable: boolean): Promise<PricedLine[]> {
  if (!lines.length) throw new HttpError(400, 'Add at least one item to the order.', 'empty_order');
  const ids = [...new Set(lines.map(l => l.optionId))];
  const rows = await tx<
    { option_id: number; item_id: number; name: string; label: string; diet: string; price_paise: number; ok: boolean; available: boolean }[]
  >`
    select o.id as option_id, i.id as item_id, i.name, o.label, o.diet, o.price_paise,
           (o.active and i.active and c.active) as ok, i.available
    from item_options o join items i on i.id = o.item_id join categories c on c.id = i.category_id
    where o.id = any(${ids})`;
  const byId = new Map(rows.map(r => [r.option_id, r]));
  const merged = new Map<number, PricedLine>();
  for (const l of lines) {
    const r = byId.get(l.optionId);
    if (!r || r.item_id !== l.itemId || !r.ok) throw new HttpError(409, 'Something in the order is no longer on the menu. Refresh the menu and try again.', 'item_gone');
    if (!r.available && !allowUnavailable) throw new HttpError(409, `${r.name} is sold out right now. Remove it and try again.`, 'sold_out');
    const prev = merged.get(r.option_id);
    const qty = (prev?.qty ?? 0) + l.qty;
    merged.set(r.option_id, {
      item_id: r.item_id,
      option_id: r.option_id,
      name: r.name,
      option_label: r.label,
      diet: r.diet,
      unit_paise: r.price_paise,
      qty,
      line_paise: r.price_paise * qty,
    });
  }
  return [...merged.values()];
}

export async function upsertCustomer(tx: Tx, phone?: string | null, name?: string | null): Promise<number | null> {
  const p = normalisePhone(phone);
  if (!p) return null;
  const [row] = await tx<{ id: number }[]>`
    insert into customers (phone, name) values (${p}, ${name?.trim() || null})
    on conflict (phone) do update set
      name = coalesce(excluded.name, customers.name),
      last_seen_at = now()
    returning id`;
  return row.id;
}

export function normalisePhone(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length >= 8) return '+' + digits;
  return null;
}

export interface CreateOrderInput {
  source: 'table' | 'takeaway' | 'counter';
  table?: string | null;
  name?: string | null;
  phone?: string | null;
  note?: string | null;
  lines: LineInput[];
  discountPaise?: number;
  discountNote?: string | null;
  staffId?: number | null;
}

export async function createOrder(input: CreateOrderInput) {
  const order = await sql.begin(async tx => {
    const settings = await getSettings(tx);
    const fromStaff = !!input.staffId;
    if (!fromStaff) {
      if (!settings.ordering_enabled) throw new HttpError(403, 'Online ordering is paused right now. Please order with your server.', 'ordering_off');
      if (input.source === 'takeaway' && !settings.takeaway_enabled)
        throw new HttpError(403, 'Takeaway orders are paused right now. Call us to order.', 'takeaway_off');
    }
    if (input.source === 'table') {
      const label = (input.table ?? '').trim();
      const [t] = await tx`select 1 from dining_tables where label = ${label} and active`;
      if (!t) throw new HttpError(400, `There's no table "${label}". Check the number on your table's QR stand.`, 'bad_table');
    }
    const lines = await priceLines(tx, input.lines, fromStaff);
    const subtotal = lines.reduce((a, l) => a + l.line_paise, 0);
    const rate = Number(settings.gst_rate ?? 0.18);
    const t = computeTotals(subtotal, input.discountPaise ?? 0, rate);
    const customerId = await upsertCustomer(tx, input.phone, input.name);
    const token = randomBytes(12).toString('base64url');
    const [o] = await tx<{ id: number; number: number; token: string }[]>`
      insert into orders (token, source, table_label, customer_id, customer_name, customer_phone, note, gst_rate,
                          subtotal_paise, discount_paise, discount_note, taxable_paise, cgst_paise, sgst_paise,
                          round_off_paise, total_paise, created_by)
      values (${token}, ${input.source}, ${input.source === 'table' ? input.table!.trim() : null}, ${customerId},
              ${input.name?.trim() || null}, ${normalisePhone(input.phone)}, ${input.note?.trim() || null}, ${rate},
              ${t.subtotal}, ${t.discount}, ${input.discountNote ?? null}, ${t.taxable}, ${t.cgst}, ${t.sgst},
              ${t.roundOff}, ${t.total}, ${input.staffId ?? null})
      returning id, number, token`;
    for (const l of lines) {
      await tx`insert into order_lines (order_id, item_id, option_id, name, option_label, diet, unit_paise, qty, line_paise)
               values (${o.id}, ${l.item_id}, ${l.option_id}, ${l.name}, ${l.option_label}, ${l.diet}, ${l.unit_paise}, ${l.qty}, ${l.line_paise})`;
    }
    return o;
  });
  bus.publish({ type: 'order.created', orderId: order.id, number: order.number, source: input.source, table: input.table ?? null });
  return getOrder(order.id);
}

/** Re-prices an order after its discount or lines change. Keeps payments as they are. */
export async function recalc(tx: Tx, orderId: number) {
  const [o] = await tx<{ gst_rate: string; discount_paise: number; paid_paise: number }[]>`
    select gst_rate, discount_paise, paid_paise from orders where id = ${orderId} for update`;
  const [{ s }] = await tx<{ s: number }[]>`select coalesce(sum(line_paise), 0)::int as s from order_lines where order_id = ${orderId}`;
  const t = computeTotals(s, o.discount_paise, Number(o.gst_rate));
  const paymentStatus = o.paid_paise <= 0 ? 'unpaid' : o.paid_paise >= t.total ? 'paid' : 'partial';
  await tx`update orders set subtotal_paise = ${t.subtotal}, discount_paise = ${t.discount}, taxable_paise = ${t.taxable},
             cgst_paise = ${t.cgst}, sgst_paise = ${t.sgst}, round_off_paise = ${t.roundOff}, total_paise = ${t.total},
             payment_status = ${paymentStatus}, updated_at = now()
           where id = ${orderId}`;
}

export async function addLines(orderId: number, lines: LineInput[]) {
  await sql.begin(async tx => {
    const [o] = await tx<{ status: string }[]>`select status from orders where id = ${orderId} for update`;
    if (!o) throw new HttpError(404, 'Order not found.', 'not_found');
    if (o.status === 'completed' || o.status === 'cancelled') throw new HttpError(409, 'This order is closed. Start a new order instead.', 'closed');
    const priced = await priceLines(tx, lines, true);
    for (const l of priced) {
      await tx`insert into order_lines (order_id, item_id, option_id, name, option_label, diet, unit_paise, qty, line_paise)
               values (${orderId}, ${l.item_id}, ${l.option_id}, ${l.name}, ${l.option_label}, ${l.diet}, ${l.unit_paise}, ${l.qty}, ${l.line_paise})`;
    }
    await recalc(tx, orderId);
  });
  return publishUpdate(orderId);
}

export async function addPayment(orderId: number, method: string, amountPaise: number, staffId: number, reference?: string | null) {
  const freed = await sql.begin(async tx => {
    const [{ table_label: label } = { table_label: null }] = await tx<{ table_label: string | null }[]>`select table_label from orders where id = ${orderId}`;
    const wasBusy = await lockTable(tx, label);
    const [o] = await tx<{ status: string; total_paise: number; paid_paise: number }[]>`
      select status, total_paise, paid_paise from orders where id = ${orderId} for update`;
    if (!o) throw new HttpError(404, 'Order not found.', 'not_found');
    if (o.status === 'cancelled') throw new HttpError(409, 'This order was cancelled.', 'cancelled');
    await tx`insert into payments (order_id, method, amount_paise, reference, staff_id)
             values (${orderId}, ${method}, ${amountPaise}, ${reference ?? null}, ${staffId})`;
    const paid = o.paid_paise + amountPaise;
    const status = paid >= o.total_paise ? 'paid' : 'partial';
    await tx`update orders set paid_paise = ${paid}, payment_status = ${status}, updated_at = now() where id = ${orderId}`;
    if (status === 'paid') {
      const [row] = await tx<{ customer_id: number | null; total_paise: number }[]>`select customer_id, total_paise from orders where id = ${orderId}`;
      if (row.customer_id)
        await tx`update customers set visits = visits + 1, spent_paise = spent_paise + ${row.total_paise}, last_seen_at = now()
                 where id = ${row.customer_id}`;
    }
    return freeTableCheck(tx, label, wasBusy);
  });
  publishTable(freed);
  return publishUpdate(orderId);
}

export async function publishUpdate(orderId: number) {
  const o = await getOrder(orderId);
  if (o) bus.publish({ type: 'order.updated', orderId, number: o.number });
  return o;
}

export async function getOrder(id: number) {
  const [o] = await sql<({ id: number; number: number; token: string } & Record<string, any>)[]>`select * from orders where id = ${id}`;
  if (!o) return null;
  const lines = await sql`select id, item_id, option_id, name, option_label, diet, unit_paise, qty, line_paise
                          from order_lines where order_id = ${id} order by id`;
  const payments = await sql`select id, method, amount_paise, reference, created_at from payments where order_id = ${id} order by id`;
  return { ...o, lines, payments };
}

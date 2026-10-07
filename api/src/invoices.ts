import { randomBytes, randomUUID } from 'node:crypto';
import { sql, type Tx } from './db.js';
import { bus } from './events.js';
import { freeTableCheck, getSettings, HttpError, lockTable, publishTable, publishUpdate } from './orders.js';

/** ₹840 or ₹840.50, for messages. */
export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Indian financial year for a moment, in Kolkata time: 1 April 2026 to 31 March 2027 is '26-27'. */
export function financialYear(at = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .format(at)
    .split('-')
    .map(Number);
  const start = m >= 4 ? y : y - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return `${yy(start)}-${yy(start + 1)}`;
}

async function nextNumber(tx: Tx) {
  const fy = financialYear();
  const [r] = await tx<{ last: number }[]>`
    insert into invoice_counters (fy, last) values (${fy}, 1)
    on conflict (fy) do update set last = invoice_counters.last + 1
    returning last`;
  return { fy, number: `LB/${fy}/${String(r.last).padStart(5, '0')}` };
}

/** Card and UPI payments need the transaction ID from the slip or app. Returns the trimmed reference. */
export function checkReference(method: string, reference?: string | null) {
  const ref = reference?.trim() || null;
  if ((method === 'card' || method === 'upi') && !ref)
    throw new HttpError(400, 'Add the transaction ID from the card slip or UPI app.', 'no_reference');
  return ref;
}

/**
 * Marks an open invoice paid once it has a non-cancelled order and nothing is left to pay.
 * Run after anything that can change that: creation, payments, joins, cancellations, discounts, line edits.
 */
export async function settleInvoiceCheck(tx: Tx, invoiceId: number | null | undefined): Promise<boolean> {
  if (!invoiceId) return false;
  const [r] = await tx`
    update invoices set status = 'paid', paid_at = now()
    where id = ${invoiceId} and status = 'open'
      and exists (select 1 from orders where invoice_id = ${invoiceId} and status <> 'cancelled')
      and not exists (select 1 from orders where invoice_id = ${invoiceId} and status <> 'cancelled' and paid_paise < total_paise)
    returning id`;
  return !!r;
}

/** A table order that just reached the kitchen joins its visit's open bill, if there is one. */
export async function joinOpenInvoice(tx: Tx, orderId: number): Promise<number | null> {
  const [r] = await tx<{ id: number }[]>`
    update orders o set invoice_id = i.id
    from invoices i
    where o.id = ${orderId} and o.invoice_id is null and o.table_label is not null and o.sitting is not null
      and i.source = 'table' and i.status = 'open' and i.table_label = o.table_label and i.sitting = o.sitting
    returning i.id`;
  if (!r) return null;
  await settleInvoiceCheck(tx, r.id);
  return r.id;
}

export function publishInvoice(id: number | null | undefined) {
  if (id) bus.publish({ type: 'invoice.updated', id });
}

/** For edits to an order: refuse once its bill is paid (or, for moving tables, once it's on any bill). */
export async function refuseInvoiced(tx: Tx, orderId: number, change: 'edit' | 'move') {
  const [r] = await tx<{ number: string; status: string }[]>`
    select i.number, i.status from orders o join invoices i on i.id = o.invoice_id where o.id = ${orderId}`;
  if (!r) return;
  if (change === 'move')
    throw new HttpError(409, `This order is on invoice ${r.number}. Move it before generating the bill.`, 'invoiced');
  if (r.status === 'paid') throw new HttpError(409, `This order is on paid invoice ${r.number}, so it can't be changed.`, 'invoiced');
}

/**
 * The bill for an order: its table visit's bill (created if needed, collecting the visit's orders) or, for
 * takeaway and counter orders, a bill of its own. Returns the invoice id and its guest token.
 */
export async function invoiceForOrder(orderId: number, staffId: number | null, held: () => never): Promise<{ id: number; token: string }> {
  const attempt = () =>
    sql.begin(async tx => {
      const [o] = await tx<{ id: number; status: string; source: string; table_label: string | null; sitting: number | null; invoice_id: number | null }[]>`
        select id, status, source, table_label, sitting, invoice_id from orders where id = ${orderId} for update`;
      if (!o) throw new HttpError(404, 'Order not found.', 'not_found');
      if (o.status === 'held') held();
      if (o.invoice_id) {
        const [inv] = await tx<{ id: number; token: string }[]>`select id, token from invoices where id = ${o.invoice_id}`;
        return inv;
      }
      if (o.status === 'cancelled') throw new HttpError(409, 'This order was cancelled, so there is nothing to bill.', 'cancelled');
      const visit = o.table_label && o.sitting !== null;
      if (visit) {
        const [open] = await tx<{ id: number; token: string }[]>`
          select id, token from invoices where source = 'table' and status = 'open' and table_label = ${o.table_label} and sitting = ${o.sitting}`;
        if (open) {
          await tx`update orders set invoice_id = ${open.id} where id = ${o.id}`;
          await settleInvoiceCheck(tx, open.id);
          return open;
        }
      }
      const { fy, number } = await nextNumber(tx);
      const [inv] = await tx<{ id: number; token: string }[]>`
        insert into invoices (number, fy, token, source, table_label, sitting, created_by)
        values (${number}, ${fy}, ${randomBytes(12).toString('base64url')}, ${visit ? 'table' : o.source},
                ${o.table_label}, ${visit ? o.sitting : null}, ${staffId})
        returning id, token`;
      if (visit) {
        await tx`update orders set invoice_id = ${inv.id}
                 where table_label = ${o.table_label} and sitting = ${o.sitting} and invoice_id is null
                   and status not in ('held', 'cancelled')`;
      } else {
        await tx`update orders set invoice_id = ${inv.id} where id = ${o.id}`;
      }
      // Orders that were already paid one by one make a bill that is paid from the start.
      await settleInvoiceCheck(tx, inv.id);
      return inv;
    });
  let inv: { id: number; token: string };
  try {
    inv = await attempt();
  } catch (e) {
    // Two people opened the same visit's bill at the same moment: the other one won, use theirs.
    if ((e as { code?: string }).code !== '23505') throw e;
    inv = await attempt();
  }
  publishInvoice(inv.id);
  return inv;
}

/** Records one payment (one card swipe or UPI transfer) on a bill, spread over its orders oldest first. */
export async function payInvoice(invoiceId: number, method: string, amountPaise: number | undefined, staffId: number, reference?: string | null) {
  const ref = checkReference(method, reference);
  const [head] = await sql<{ table_label: string | null }[]>`select table_label from invoices where id = ${invoiceId}`;
  if (!head) throw new HttpError(404, 'Invoice not found.', 'not_found');
  const result = await sql.begin(async tx => {
    // Same lock order as everywhere else: the table first, then the bill and its orders.
    const wasBusy = await lockTable(tx, head.table_label);
    const [inv] = await tx<{ status: string; number: string }[]>`select status, number from invoices where id = ${invoiceId} for update`;
    if (inv.status === 'paid') throw new HttpError(409, `Invoice ${inv.number} is already paid.`, 'paid');
    const orders = await tx<{ id: number; total_paise: number; paid_paise: number; customer_id: number | null }[]>`
      select id, total_paise, paid_paise, customer_id from orders
      where invoice_id = ${invoiceId} and status <> 'cancelled'
      order by created_at, id for update`;
    const due = orders.reduce((a, o) => a + Math.max(o.total_paise - o.paid_paise, 0), 0);
    if (due === 0) throw new HttpError(409, `Nothing is left to pay on invoice ${inv.number}.`, 'paid');
    const amount = amountPaise ?? due;
    if (amount > due) throw new HttpError(400, `That's more than the ${rupees(due)} still due.`, 'overpaid');
    const group = randomUUID();
    let left = amount;
    const touched: number[] = [];
    for (const o of orders) {
      const take = Math.min(Math.max(o.total_paise - o.paid_paise, 0), left);
      if (take <= 0) continue;
      await tx`insert into payments (order_id, method, amount_paise, reference, staff_id, invoice_id, txn_group)
               values (${o.id}, ${method}, ${take}, ${ref}, ${staffId}, ${invoiceId}, ${group})`;
      const paid = o.paid_paise + take;
      const status = paid >= o.total_paise ? 'paid' : 'partial';
      await tx`update orders set paid_paise = ${paid}, payment_status = ${status}, updated_at = now() where id = ${o.id}`;
      if (status === 'paid' && o.customer_id)
        await tx`update customers set visits = visits + 1, spent_paise = spent_paise + ${o.total_paise}, last_seen_at = now()
                 where id = ${o.customer_id}`;
      touched.push(o.id);
      left -= take;
      if (left === 0) break;
    }
    await settleInvoiceCheck(tx, invoiceId);
    return { touched, freed: await freeTableCheck(tx, head.table_label, wasBusy) };
  });
  publishTable(result.freed);
  for (const id of result.touched) await publishUpdate(id);
  publishInvoice(invoiceId);
  return getInvoice({ id: invoiceId }, 'staff');
}

interface InvoiceRow {
  id: number;
  number: string;
  token: string;
  source: string;
  table_label: string | null;
  status: string;
  created_at: Date;
  paid_at: Date | null;
}

/** The bill as shown to staff (with who took each payment) or to the guest (without). */
export async function getInvoice(by: { id: number } | { token: string }, view: 'staff' | 'guest') {
  const [inv] =
    'id' in by
      ? await sql<InvoiceRow[]>`select id, number, token, source, table_label, status, created_at, paid_at from invoices where id = ${by.id}`
      : await sql<InvoiceRow[]>`select id, number, token, source, table_label, status, created_at, paid_at from invoices where token = ${by.token}`;
  if (!inv) return null;
  const s = await getSettings();
  const orders = await sql<{ id: number; number: number; gst_rate: string; subtotal_paise: number; discount_paise: number; discount_note: string | null; taxable_paise: number; cgst_paise: number; sgst_paise: number; round_off_paise: number; total_paise: number; paid_paise: number }[]>`
    select id, number, gst_rate, subtotal_paise, discount_paise, discount_note, taxable_paise, cgst_paise, sgst_paise,
           round_off_paise, total_paise, paid_paise
    from orders where invoice_id = ${inv.id} and status <> 'cancelled' order by created_at, id`;
  const ids = orders.map(o => o.id);
  const lines = await sql<{ name: string; option: string; diet: string; unit: number; qty: number; amount: number }[]>`
    select name, option_label as option, diet, unit_paise as unit, sum(qty)::int as qty, sum(line_paise)::int as amount
    from order_lines where order_id = any(${ids})
    group by item_id, option_id, name, option_label, diet, unit_paise
    order by min(id)`;
  const payments = await sql<{ at: Date; method: string; amount: number; reference: string | null; staff: string | null }[]>`
    select min(p.created_at) as at, p.method, sum(p.amount_paise)::int as amount, max(p.reference) as reference, max(s.name) as staff
    from payments p left join staff s on s.id = p.staff_id
    where p.order_id = any(${ids})
    group by p.txn_group, p.method order by min(p.created_at)`;
  const sum = (k: keyof (typeof orders)[number]) => orders.reduce((a, o) => a + Number(o[k]), 0);
  const rate = orders.length ? Number(orders[0].gst_rate) : Number(s.gst_rate ?? 0.18);
  const discountNotes = [...new Set(orders.map(o => o.discount_note).filter(Boolean))];
  return {
    id: inv.id,
    number: inv.number,
    token: inv.token,
    status: inv.status,
    createdAt: inv.created_at,
    paidAt: inv.paid_at,
    source: inv.source,
    table: inv.table_label,
    orders: orders.map(o => o.number),
    cafe: { name: s.cafe?.name ?? '', address: s.cafe?.address ?? '', phone: s.cafe?.phone ?? '', email: s.cafe?.email ?? '', gstin: s.cafe?.gstin ?? '' },
    lines,
    totals: {
      subtotal: sum('subtotal_paise'),
      discount: sum('discount_paise'),
      discountNote: discountNotes.join(', ') || null,
      taxable: sum('taxable_paise'),
      cgstRate: rate / 2,
      sgstRate: rate / 2,
      cgst: sum('cgst_paise'),
      sgst: sum('sgst_paise'),
      roundOff: sum('round_off_paise'),
      total: sum('total_paise'),
      paid: sum('paid_paise'),
      due: orders.reduce((a, o) => a + Math.max(o.total_paise - o.paid_paise, 0), 0),
    },
    payments: payments.map(p => ({ at: p.at, method: p.method, amount: p.amount, reference: p.reference, ...(view === 'staff' ? { staff: p.staff } : {}) })),
  };
}
export type InvoiceView = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

import { sql, type Tx } from './db.js';
import { HttpError, recalc } from './orders.js';
import { publishInvoice, settleInvoiceCheck } from './invoices.js';

/** The card's rules. Stored in the `loyalty` setting; these are the cafe's defaults. */
export const LOYALTY_DEFAULTS = {
  reward_stamps: 4,
  reward_percent: 50,
  reward_cap_paise: 100_000,
  welcome_percent: 20,
  welcome_limit: 420,
  google_review_url: '',
  instagram_url: '',
  reminder_days: 14,
  reminder_cap: 6,
  reminder_hour: 18,
};
export type LoyaltySettings = typeof LOYALTY_DEFAULTS;

export async function loyaltySettings(db: Tx | typeof sql = sql): Promise<LoyaltySettings> {
  const [r] = await db<{ value: Partial<LoyaltySettings> }[]>`select value from settings where key = 'loyalty'`;
  return { ...LOYALTY_DEFAULTS, ...(r?.value ?? {}) };
}

/** Payment has started on a bill once any of its orders has money against it; its discount is then fixed. */
export async function isFrozen(tx: Tx, invoiceId: number) {
  const [r] = await tx<{ frozen: boolean }[]>`
    select exists (select 1 from orders where invoice_id = ${invoiceId} and status <> 'cancelled' and paid_paise > 0) as frozen`;
  return r.frozen;
}

/** How many welcome offers are used or held on an unfinished bill from the last day (excluding one bill). */
export async function welcomesTaken(tx: Tx | typeof sql, exceptInvoice = 0) {
  const [r] = await tx<{ n: number }[]>`
    select (select count(*) from customers where welcome_used_at is not null)
         + (select count(*) from invoices where status = 'open' and discount_kind = 'welcome'
              and created_at > now() - interval '1 day' and id <> ${exceptInvoice})::int as n`;
  return Number(r.n);
}

interface Candidate {
  kind: 'offer' | 'welcome' | 'reward' | 'manual';
  amount: number;
  note: string;
  offerId: number | null;
  /** How the amount is shared between the bill's orders (by subtotal, or by the lines an offer covers). */
  weights: Map<number, number>;
}
const RANK = { offer: 0, welcome: 1, reward: 2, manual: 3 };

/**
 * Works out and applies the one discount on an open bill that hasn't started being paid: a manager's manual
 * discount if set, otherwise the best of the 5th-visit reward, the welcome offer and running offers.
 * Each order gets its share, so GST is charged on the reduced amount. Returns true if it ran.
 */
export async function applyInvoiceDiscount(tx: Tx, invoiceId: number): Promise<boolean> {
  const [inv] = await tx<{ id: number; status: string; customer_id: number | null; discount_kind: string; discount_paise: number; manual_note: string | null }[]>`
    select id, status, customer_id, discount_kind, discount_paise, manual_note from invoices where id = ${invoiceId} for update`;
  if (!inv || inv.status !== 'open' || (await isFrozen(tx, invoiceId))) return false;
  const orders = await tx<{ id: number; subtotal_paise: number }[]>`
    select id, subtotal_paise from orders where invoice_id = ${invoiceId} and status <> 'cancelled' order by created_at, id for update`;
  const ids = orders.map(o => o.id);
  const bySubtotal = new Map(orders.map(o => [o.id, o.subtotal_paise]));
  const base = orders.reduce((a, o) => a + o.subtotal_paise, 0);

  let choice: Candidate | null = null;
  if (inv.discount_kind === 'manual') {
    choice = { kind: 'manual', amount: Math.min(inv.discount_paise, base), note: `Manual: ${inv.manual_note ?? 'discount'}`, offerId: null, weights: bySubtotal };
  } else if (orders.length) {
    const ls = await loyaltySettings(tx);
    const candidates: Candidate[] = [];
    const [customer] = inv.customer_id
      ? await tx<{ id: number; stamps: number; welcome_used_at: Date | null }[]>`
          select id, stamps, welcome_used_at from customers where id = ${inv.customer_id} for update`
      : [];

    // Campaign offers running today (Kolkata date).
    const offers = await tx<{ id: number; name: string; percent: number; scope: string; audience: string; cats: number[] | null }[]>`
      select o.id, o.name, o.percent, o.scope, o.audience, array_remove(array_agg(s.category_id), null) as cats
      from offers o left join offer_sections s on s.offer_id = o.id
      where not o.paused and o.starts_on <= (now() at time zone 'Asia/Kolkata')::date and o.ends_on >= (now() at time zone 'Asia/Kolkata')::date
      group by o.id`;
    const lines = offers.some(o => o.scope === 'sections')
      ? await tx<{ order_id: number; line_paise: number; category_id: number }[]>`
          select l.order_id, l.line_paise, i.category_id from order_lines l join items i on i.id = l.item_id where l.order_id = any(${ids})`
      : [];
    for (const o of offers) {
      if (o.audience === 'members' && !customer) continue;
      let weights = bySubtotal;
      if (o.scope === 'sections') {
        const cats = new Set(o.cats ?? []);
        weights = new Map(ids.map(id => [id, 0]));
        for (const l of lines) if (cats.has(l.category_id)) weights.set(l.order_id, (weights.get(l.order_id) ?? 0) + l.line_paise);
      }
      const eligible = [...weights.values()].reduce((a, b) => a + b, 0);
      candidates.push({ kind: 'offer', amount: Math.round((eligible * o.percent) / 100), note: `${o.name}, ${o.percent}% off`, offerId: o.id, weights });
    }

    if (customer) {
      // The 5th-visit reward, unless another unfinished bill of theirs already holds it.
      const [otherReward] = await tx`select 1 from invoices where customer_id = ${customer.id} and status = 'open' and discount_kind = 'reward' and id <> ${inv.id}`;
      if (customer.stamps >= ls.reward_stamps && !otherReward)
        candidates.push({
          kind: 'reward',
          amount: Math.min(Math.round((base * ls.reward_percent) / 100), ls.reward_cap_paise),
          note: `5th-visit reward, ${ls.reward_percent}% off`,
          offerId: null,
          weights: bySubtotal,
        });

      // The welcome offer: first paid visit on the card, while places remain.
      const [paidBefore] = await tx`select 1 from invoices where customer_id = ${customer.id} and status = 'paid'`;
      const [otherWelcome] = await tx`select 1 from invoices where customer_id = ${customer.id} and status = 'open' and discount_kind = 'welcome' and id <> ${inv.id}`;
      if (!customer.welcome_used_at && !paidBefore && !otherWelcome) {
        await tx`select pg_advisory_xact_lock(hashtext('lbs.welcome'))`;
        if ((await welcomesTaken(tx, inv.id)) < ls.welcome_limit)
          candidates.push({ kind: 'welcome', amount: Math.round((base * ls.welcome_percent) / 100), note: `Welcome ${ls.welcome_percent}% off`, offerId: null, weights: bySubtotal });
      }
    }

    // One discount per bill: the biggest wins; on a tie keep the stamps and the welcome offer for later.
    candidates.sort((a, b) => b.amount - a.amount || RANK[a.kind] - RANK[b.kind]);
    choice = candidates.find(c => c.amount > 0) ?? null;
  }

  // Share the amount between the orders (largest remainder, in paise) and re-price each.
  const amount = choice?.amount ?? 0;
  const weights = choice?.weights ?? bySubtotal;
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  const shares = new Map<number, number>();
  if (amount > 0 && totalWeight > 0) {
    const raw = ids.map(id => ({ id, exact: (amount * (weights.get(id) ?? 0)) / totalWeight }));
    let given = 0;
    for (const r of raw) {
      shares.set(r.id, Math.floor(r.exact));
      given += Math.floor(r.exact);
    }
    for (const r of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1)).slice(0, amount - given)) shares.set(r.id, shares.get(r.id)! + 1);
  }
  for (const id of ids) {
    const share = shares.get(id) ?? 0;
    await tx`update orders set discount_paise = ${share}, discount_note = ${share ? choice!.note : null} where id = ${id}`;
    await recalc(tx, id);
  }
  const kind = choice ? choice.kind : inv.discount_kind === 'manual' ? 'manual' : 'none';
  await tx`update invoices set discount_kind = ${kind}, offer_id = ${choice?.offerId ?? null}, discount_paise = ${amount} where id = ${inv.id}`;
  await settleInvoiceCheck(tx, inv.id);
  return true;
}

/** Applies the discount in its own transaction and tells open admin screens. */
export async function reapplyDiscount(invoiceId: number) {
  const ran = await sql.begin(tx => applyInvoiceDiscount(tx, invoiceId));
  if (ran) publishInvoice(invoiceId);
}

/** An offer changed: every open bill that hasn't started being paid is worked out again, one at a time. */
export async function reapplyOpenBills() {
  const open = await sql<{ id: number }[]>`
    select i.id from invoices i where i.status = 'open'
      and not exists (select 1 from orders o where o.invoice_id = i.id and o.status <> 'cancelled' and o.paid_paise > 0)`;
  for (const { id } of open) await reapplyDiscount(id);
}

/** The card side of a bill being paid: the reward used, the welcome used, a stamp, and the visit. */
async function stampCard(tx: Tx, customerId: number, invoiceId: number, discountKind: string) {
  const ls = await loyaltySettings(tx);
  const [c] = await tx<{ stamps: number }[]>`select stamps from customers where id = ${customerId} for update`;
  if (!c) return;
  if (discountKind === 'reward') {
    await tx`update customers set stamps = 0 where id = ${customerId}`;
    await tx`insert into stamp_events (customer_id, invoice_id, kind) values (${customerId}, ${invoiceId}, 'reward_used')`;
  } else {
    if (discountKind === 'welcome') {
      await tx`update customers set welcome_used_at = now() where id = ${customerId}`;
      await tx`insert into stamp_events (customer_id, invoice_id, kind) values (${customerId}, ${invoiceId}, 'welcome_used')`;
    }
    const [today] = await tx`
      select 1 from stamp_events where customer_id = ${customerId} and kind = 'stamp'
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`;
    if (c.stamps < ls.reward_stamps && !today) {
      await tx`update customers set stamps = stamps + 1 where id = ${customerId}`;
      await tx`insert into stamp_events (customer_id, invoice_id, kind) values (${customerId}, ${invoiceId}, 'stamp')`;
    }
  }
  await tx`update customers set last_visit_at = now(), reminders_since_visit = 0 where id = ${customerId}`;
}

/** Called by settleInvoiceCheck when a bill becomes paid. */
export async function onInvoicePaid(tx: Tx, invoiceId: number) {
  const [inv] = await tx<{ customer_id: number | null; discount_kind: string }[]>`select customer_id, discount_kind from invoices where id = ${invoiceId}`;
  // A visit counts once per bill paid through the bill (orders paid one by one were counted as they were paid).
  const [paidHere] = await tx`select 1 from payments where invoice_id = ${invoiceId} limit 1`;
  if (paidHere) {
    const [o] = await tx<{ total: number; customers: number[] }[]>`
      select coalesce(sum(total_paise), 0)::int as total, array_remove(array_agg(distinct customer_id), null) as customers
      from orders where invoice_id = ${invoiceId} and status <> 'cancelled'`;
    const visitor = inv.customer_id ?? (o.customers.length === 1 ? o.customers[0] : null);
    if (visitor)
      await tx`update customers set visits = visits + 1, spent_paise = spent_paise + ${o.total}, last_seen_at = now() where id = ${visitor}`;
  }
  if (inv.customer_id) await stampCard(tx, inv.customer_id, invoiceId, inv.discount_kind);
}

/**
 * Puts a bill on a customer's card (or takes it off with `customerId = null`). Before payment starts this also
 * works out the discount; after, it only earns the stamp.
 */
export async function linkInvoice(invoiceId: number, customerId: number | null, by: 'guest' | 'staff') {
  await sql.begin(async tx => {
    const [inv] = await tx<{ id: number; status: string; customer_id: number | null; discount_kind: string; old: boolean }[]>`
      select id, status, customer_id, discount_kind, (paid_at < now() - interval '1 day') as old from invoices where id = ${invoiceId} for update`;
    if (!inv) throw new HttpError(404, 'We couldn’t find that bill.', 'not_found');
    if (inv.customer_id === customerId) return;
    const started = inv.status === 'paid' || (await isFrozen(tx, invoiceId));
    if (inv.customer_id && by === 'guest') throw new HttpError(409, "This bill is already on another LB's card.", 'linked');
    if (inv.customer_id && started) throw new HttpError(409, "Payment has started on this bill, so its LB's card can't be removed.", 'frozen');
    if (customerId && inv.status === 'paid' && inv.old) throw new HttpError(409, "This bill was paid more than a day ago, so it can't go on a card now.", 'too_old');
    await tx`update invoices set customer_id = ${customerId} where id = ${invoiceId}`;
    if (customerId) await tx`update orders set customer_id = ${customerId} where invoice_id = ${invoiceId}`;
    if (inv.status === 'paid' && customerId) await stampCard(tx, customerId, invoiceId, 'none'); // stamp only
    else if (!started) await applyInvoiceDiscount(tx, invoiceId);
  });
  publishInvoice(invoiceId);
}

/** A manager's own discount on a bill, or back to the best automatic one. */
export async function setManualDiscount(invoiceId: number, manual: { amountPaise: number; note: string } | null) {
  await sql.begin(async tx => {
    const [inv] = await tx<{ status: string }[]>`select status from invoices where id = ${invoiceId} for update`;
    if (!inv) throw new HttpError(404, 'Invoice not found.', 'not_found');
    if (inv.status === 'paid' || (await isFrozen(tx, invoiceId)))
      throw new HttpError(409, "Payment has started on this bill, so its discount can't change.", 'frozen');
    if (manual) await tx`update invoices set discount_kind = 'manual', discount_paise = ${manual.amountPaise}, manual_note = ${manual.note} where id = ${invoiceId}`;
    else await tx`update invoices set discount_kind = 'none', discount_paise = 0, manual_note = null where id = ${invoiceId}`;
    await applyInvoiceDiscount(tx, invoiceId);
  });
  publishInvoice(invoiceId);
}

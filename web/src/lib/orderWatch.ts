import { api, ApiError, HAS_API } from './api';
import { forgetOrder, recentOrders } from './orders';

export interface PublicOrder {
  number: number | null;
  status: 'held' | 'new' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  holdSecondsLeft: number | null;
  source: 'table' | 'takeaway' | 'counter';
  table: string | null;
  createdAt: string;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  totals: {
    subtotal: number;
    discount: number;
    cgst: number;
    sgst: number;
    roundOff: number;
    total: number;
  };
  lines: {
    name: string;
    option: string;
    qty: number;
    unit: number;
    total: number;
  }[];
}

export const STEPS = [
  { key: 'new', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'served', label: 'Served' },
] as const;

export function headline(o: PublicOrder) {
  switch (o.status) {
    case 'held':
      return 'Order placed. Confirm it now, or change it within a minute.';
    case 'new':
      return 'The kitchen has your order.';
    case 'preparing':
      return 'It’s being made now.';
    case 'ready':
      return o.source === 'takeaway' ? 'Ready. Pick it up at the counter.' : 'Ready. It’s on its way to your table.';
    case 'served':
      return 'Served. Enjoy.';
    case 'completed':
      return o.paymentStatus === 'paid' ? 'All done and paid. Thanks for coming.' : 'All done.';
    case 'cancelled':
      return 'This order was cancelled. Ask your server if that’s a surprise.';
  }
}

/** Short name of a status, for the pop-up title. */
export function statusName(s: PublicOrder['status']) {
  return s === 'held' ? 'Placed' : s === 'completed' ? 'Done' : s === 'cancelled' ? 'Cancelled' : STEPS.find(x => x.key === s)!.label;
}

export type OrderUpdate = { token: string; order: PublicOrder; prev: PublicOrder['status'] | null };
type Listener = (u: OrderUpdate) => void;

/**
 * Watches this phone's orders (the ones it placed, plus any order page that's open) by asking the API every few
 * seconds, and tells listeners each time. `prev` is the status last seen, so a listener can tell a change from a
 * repeat. Orders that are done or cancelled stop being checked.
 */
const VISIBLE_MS = 4000;
const HIDDEN_MS = 15000;
const DONE = new Set(['completed', 'cancelled']);
const seen = new Map<string, PublicOrder['status']>();
const extra = new Map<string, number>();
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastRun = 0;
let running = false;

function tokens() {
  const all = new Set([...recentOrders().map(o => o.token), ...extra.keys()]);
  return [...all].filter(t => !DONE.has(seen.get(t) ?? '') || extra.has(t));
}

async function check(force = false) {
  if (running || !HAS_API) return;
  const gap = document.hidden ? HIDDEN_MS : VISIBLE_MS;
  if (!force && Date.now() - lastRun < gap - 200) return;
  running = true;
  lastRun = Date.now();
  try {
    await Promise.all(
      tokens().map(async token => {
        try {
          const { order } = await api<{ order: PublicOrder }>(`/api/public/orders/${encodeURIComponent(token)}`);
          const prev = seen.get(token) ?? null;
          seen.set(token, order.status);
          listeners.forEach(fn => fn({ token, order, prev }));
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) forgetOrder(token);
        }
      }),
    );
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => void check(), 1000);
  document.addEventListener('visibilitychange', onVisible);
  void check(true);
}

function stop() {
  if (!timer || listeners.size) return;
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisible);
}

function onVisible() {
  if (!document.hidden) void check(true);
}

export function onOrderUpdate(fn: Listener) {
  listeners.add(fn);
  start();
  return () => {
    listeners.delete(fn);
    stop();
  };
}

/** Keeps an order checked while its page is open, even if this phone didn't place it. */
export function watchOrder(token: string) {
  extra.set(token, (extra.get(token) ?? 0) + 1);
  return () => {
    const n = (extra.get(token) ?? 1) - 1;
    if (n > 0) extra.set(token, n);
    else extra.delete(token);
  };
}

/** Check now, e.g. right after the guest confirmed or the countdown ran out. */
export function refreshOrders() {
  void check(true);
}

/** Record a status the page already knows, so it doesn't pop up as a change. */
export function noteStatus(token: string, status: PublicOrder['status']) {
  seen.set(token, status);
}

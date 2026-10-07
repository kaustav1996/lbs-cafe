/** Orders placed from this phone, so customers can get back to the status page. */
const KEY = 'lbs.orders.v1';
export interface Remembered { token: string; number: number | null; at: number }

export function recentOrders(): Remembered[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Remembered[];
    return list.filter(o => Date.now() - o.at < 12 * 3600_000);
  } catch {
    return [];
  }
}

export function rememberOrder(token: string, number: number | null) {
  try {
    localStorage.setItem(KEY, JSON.stringify([{ token, number, at: Date.now() }, ...recentOrders()].slice(0, 5)));
  } catch {
    /* fine: the status link still works */
  }
}

/** Drop an order the guest withdrew with Change order. */
export function forgetOrder(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentOrders().filter(o => o.token !== token)));
  } catch {
    /* fine */
  }
}

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { MenuCategory, MenuItem, MenuOption } from '../data/types';
import { useLive } from './live';

export interface CartLine {
  key: string; // itemSlug|optionLabel
  itemId: string;
  name: string;
  option: string;
  price: number;
  qty: number;
  dbItemId?: number;
  dbOptionId?: number;
}

export type OrderMode = 'table' | 'takeaway';

interface CartState {
  lines: CartLine[];
  mode: OrderMode;
  table: string;
  note: string;
  name: string;
  phone: string;
}

type Action =
  | { type: 'add'; item: MenuItem; option: MenuOption }
  | { type: 'qty'; key: string; delta: number }
  | { type: 'clear' }
  | { type: 'mode'; mode: OrderMode }
  | { type: 'table'; table: string }
  | { type: 'note'; note: string }
  | { type: 'contact'; name?: string; phone?: string }
  | { type: 'sync'; menu: MenuCategory[] };

const STORAGE_KEY = 'lbs.cart.v2';
const EMPTY: CartState = { lines: [], mode: 'table', table: '', note: '', name: '', phone: '' };

function load(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as CartState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function reducer(s: CartState, a: Action): CartState {
  switch (a.type) {
    case 'add': {
      const key = `${a.item.id}|${a.option.label}`;
      const found = s.lines.find(l => l.key === key);
      const lines = found
        ? s.lines.map(l => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
        : [
            ...s.lines,
            {
              key,
              itemId: a.item.id,
              name: a.item.name,
              option: a.option.label,
              price: a.option.price,
              qty: 1,
              dbItemId: a.item.dbId,
              dbOptionId: a.option.dbId,
            },
          ];
      return { ...s, lines };
    }
    case 'qty':
      return { ...s, lines: s.lines.map(l => (l.key === a.key ? { ...l, qty: l.qty + a.delta } : l)).filter(l => l.qty > 0) };
    case 'clear':
      return { ...s, lines: [], note: '' };
    case 'mode':
      return { ...s, mode: a.mode };
    case 'table':
      return { ...s, table: a.table.replace(/[^0-9a-zA-Z-]/g, '').slice(0, 6) };
    case 'note':
      return { ...s, note: a.note.slice(0, 280) };
    case 'contact':
      return { ...s, name: a.name ?? s.name, phone: a.phone ?? s.phone };
    case 'sync': {
      // Match saved lines to the current menu: refresh prices and ids, drop what's gone.
      const lookup = new Map<string, { item: MenuItem; option: MenuOption }>();
      for (const c of a.menu) for (const i of c.items) for (const o of i.options) lookup.set(`${i.id}|${o.label}`, { item: i, option: o });
      const lines = s.lines.flatMap(l => {
        const hit = lookup.get(l.key);
        return hit ? [{ ...l, price: hit.option.price, name: hit.item.name, dbItemId: hit.item.dbId, dbOptionId: hit.option.dbId }] : [];
      });
      return { ...s, lines };
    }
  }
}

interface CartApi extends CartState {
  count: number;
  subtotal: number;
  cgst: number;
  sgst: number;
  total: number;
  gstRate: number;
  qtyOf: (key: string) => number;
  dispatch: React.Dispatch<Action>;
}

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const { menu, settings } = useLive();

  useEffect(() => {
    dispatch({ type: 'sync', menu });
  }, [menu]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: cart still works for this visit */
    }
  }, [state]);

  const api = useMemo<CartApi>(() => {
    // Mirrors the API: GST in paise split equally, bill rounded to the nearest rupee.
    const subtotal = state.lines.reduce((a, l) => a + l.price * l.qty, 0);
    const halfPaise = Math.round((subtotal * 100 * settings.gstRate) / 2);
    const total = Math.round((subtotal * 100 + halfPaise * 2) / 100);
    return {
      ...state,
      count: state.lines.reduce((a, l) => a + l.qty, 0),
      subtotal,
      cgst: halfPaise / 100,
      sgst: halfPaise / 100,
      total,
      gstRate: settings.gstRate,
      qtyOf: key => state.lines.find(l => l.key === key)?.qty ?? 0,
      dispatch,
    };
  }, [state, settings.gstRate]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}

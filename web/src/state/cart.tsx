import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { MENU, type MenuItem, type MenuOption } from '../data/menu';
import { SITE } from '../data/site';

export interface CartLine {
  key: string; // itemId|optionLabel
  itemId: string;
  name: string;
  option: string;
  price: number;
  qty: number;
}

export type OrderMode = 'table' | 'takeaway';

interface CartState {
  lines: CartLine[];
  mode: OrderMode;
  table: string;
  note: string;
}

type Action =
  | { type: 'add'; item: MenuItem; option: MenuOption }
  | { type: 'qty'; key: string; delta: number }
  | { type: 'clear' }
  | { type: 'mode'; mode: OrderMode }
  | { type: 'table'; table: string }
  | { type: 'note'; note: string };

const STORAGE_KEY = 'lbs.cart.v1';

function load(): CartState {
  const empty: CartState = { lines: [], mode: 'table', table: '', note: '' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as CartState;
    // Drop anything no longer on the menu.
    const valid = new Set(MENU.flatMap(c => c.items.map(i => i.id)));
    return { ...empty, ...parsed, lines: (parsed.lines ?? []).filter(l => valid.has(l.itemId)) };
  } catch {
    return empty;
  }
}

function reducer(s: CartState, a: Action): CartState {
  switch (a.type) {
    case 'add': {
      const key = `${a.item.id}|${a.option.label}`;
      const found = s.lines.find(l => l.key === key);
      const lines = found
        ? s.lines.map(l => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
        : [...s.lines, { key, itemId: a.item.id, name: a.item.name, option: a.option.label, price: a.option.price, qty: 1 }];
      return { ...s, lines };
    }
    case 'qty':
      return {
        ...s,
        lines: s.lines.map(l => (l.key === a.key ? { ...l, qty: l.qty + a.delta } : l)).filter(l => l.qty > 0),
      };
    case 'clear':
      return { ...s, lines: [], note: '' };
    case 'mode':
      return { ...s, mode: a.mode };
    case 'table':
      return { ...s, table: a.table.replace(/[^0-9a-zA-Z-]/g, '').slice(0, 6) };
    case 'note':
      return { ...s, note: a.note.slice(0, 280) };
  }
}

interface CartApi extends CartState {
  count: number;
  subtotal: number;
  gst: number;
  total: number;
  qtyOf: (key: string) => number;
  dispatch: React.Dispatch<Action>;
}

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: cart still works for this visit */
    }
  }, [state]);

  const api = useMemo<CartApi>(() => {
    const subtotal = state.lines.reduce((a, l) => a + l.price * l.qty, 0);
    // Bills show GST split equally into CGST and SGST.
    const half = Math.round(((subtotal * SITE.gstRate) / 2) * 100) / 100;
    const gst = Math.round(half * 2);
    return {
      ...state,
      count: state.lines.reduce((a, l) => a + l.qty, 0),
      subtotal,
      gst,
      total: subtotal + gst,
      qtyOf: key => state.lines.find(l => l.key === key)?.qty ?? 0,
      dispatch,
    };
  }, [state]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}

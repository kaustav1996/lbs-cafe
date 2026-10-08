import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, HAS_API } from '../lib/api';
import { useCart } from './cart';

/**
 * Whether games are open for this phone's table. They open when the table orders (or staff open them) and stay
 * open until a server closes them, so this checks on load, every minute, when the guest comes back to the tab,
 * and whenever something calls refresh() (e.g. right after an order).
 */
interface GamesApi {
  on: boolean;
  table: string;
  refresh: () => void;
}
const Ctx = createContext<GamesApi>({ on: false, table: '', refresh: () => {} });

export function GamesProvider({ children }: { children: ReactNode }) {
  const { mode, table: raw } = useCart();
  const table = mode === 'table' ? raw.trim() : '';
  const [on, setOn] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!table || !HAS_API) return setOn(false);
    let stop = false;
    const check = () =>
      api<{ on: boolean }>(`/api/public/tables/${encodeURIComponent(table)}/games`)
        .then(r => !stop && setOn(r.on))
        .catch(() => !stop && setOn(false));
    void check();
    const t = setInterval(check, 60_000);
    const back = () => !document.hidden && void check();
    document.addEventListener('visibilitychange', back);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', back);
    };
  }, [table, tick]);

  return <Ctx.Provider value={{ on, table, refresh }}>{children}</Ctx.Provider>;
}

export const useGames = () => useContext(Ctx);

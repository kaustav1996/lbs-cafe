import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MENU } from '../data/menu';
import type { MenuCategory, Diet } from '../data/types';
import { SITE, type DayHours } from '../data/site';
import { api, HAS_API } from '../lib/api';

/** The menu and cafe settings, live from the API when it's reachable, otherwise the built-in copy. */
export interface LiveSettings {
  gstRate: number;
  hours: DayHours[];
  orderingEnabled: boolean;
  takeawayEnabled: boolean;
  bookingEnabled: boolean;
  phone: string;
  /** The background music (Admin, Settings, Music): where it is and which part of it plays. */
  music: { url: string; start: number; end: number | null } | null;
}

interface LiveApi {
  menu: MenuCategory[];
  settings: LiveSettings;
  live: boolean; // true once the API answered
  loading: boolean;
  /** Re-fetch now, e.g. after an order is refused because the menu changed. */
  refresh: () => void;
}

const FALLBACK_SETTINGS: LiveSettings = {
  gstRate: SITE.gstRate,
  hours: SITE.hours,
  orderingEnabled: true,
  takeawayEnabled: true,
  bookingEnabled: true,
  phone: SITE.phone,
  music: null,
};

interface ApiOption { id: number; label: string; diet: Diet; price_paise: number }
interface ApiItem { id: number; slug: string; name: string; description: string | null; available: boolean; options: ApiOption[] }
interface ApiCategory { id: number; slug: string; name: string; color: string; kind: 'food' | 'drink'; items: ApiItem[] }

function fromApi(cats: ApiCategory[]): MenuCategory[] {
  return cats.map(c => {
    const items = c.items.map(i => ({
      id: i.slug,
      dbId: i.id,
      name: i.name,
      description: i.description ?? undefined,
      available: i.available,
      options: i.options.map(o => ({ dbId: o.id, label: o.label, diet: o.diet, price: o.price_paise / 100 })),
    }));
    const prices = items.flatMap(i => i.options.map(o => o.price));
    return { id: c.slug, name: c.name, color: c.color, kind: c.kind, min: Math.min(...prices), max: Math.max(...prices), items };
  });
}

const Ctx = createContext<LiveApi | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuCategory[]>(MENU);
  const [settings, setSettings] = useState<LiveSettings>(FALLBACK_SETTINGS);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(HAS_API);

  const [tick, setTick] = useState(0);
  const refresh = useMemo(() => () => setTick(t => t + 1), []);

  useEffect(() => {
    if (!HAS_API) return;
    let stop = false;
    const load = async () => {
      try {
        const [m, s] = await Promise.all([
          api<{ categories: ApiCategory[] }>('/api/public/menu'),
          api<{ gstRate: number; hours: DayHours[]; orderingEnabled: boolean; takeawayEnabled: boolean; bookingEnabled: boolean; cafe?: { phone?: string }; music?: LiveSettings['music'] }>(
            '/api/public/settings',
          ),
        ]);
        if (stop) return;
        setMenu(fromApi(m.categories));
        setSettings({
          gstRate: s.gstRate,
          hours: s.hours,
          orderingEnabled: s.orderingEnabled,
          takeawayEnabled: s.takeawayEnabled,
          bookingEnabled: s.bookingEnabled,
          phone: s.cafe?.phone || SITE.phone,
          music: s.music ?? null,
        });
        setLive(true);
      } catch {
        /* keep the built-in menu */
      } finally {
        if (!stop) setLoading(false);
      }
    };
    load();
    // Sold-out flags and the live menu change during service: refresh every 2 minutes while the page
    // is open, and as soon as the guest comes back to the tab.
    const t = setInterval(load, 2 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tick]);

  const value = useMemo(() => ({ menu, settings, live, loading, refresh }), [menu, settings, live, loading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLive outside LiveProvider');
  return c;
}

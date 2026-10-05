import { useEffect, useMemo, useState } from 'react';
import { useAuth, rs, errText } from './core';
import { DietDot } from './ui';

export interface AOption { id: number; label: string; diet: string; price_paise: number; active: boolean }
export interface AItem { id: number; category_id: number; name: string; description: string | null; active: boolean; available: boolean; featured: boolean; image_url: string | null; sort: number; options: AOption[] }
export interface ACategory { id: number; slug: string; name: string; color: string; kind: string; sort: number; active: boolean; items: AItem[] }

export function useAdminMenu() {
  const { call } = useAuth();
  const [menu, setMenu] = useState<ACategory[] | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const r = await call<{ categories: ACategory[] }>('/api/admin/menu');
      setMenu(r.categories);
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { menu, error, reload: load, setMenu };
}

export interface PickedLine {
  itemId: number;
  optionId: number;
  name: string;
  option: string;
  diet: string;
  price: number; // paise
  qty: number;
}

/** Search + section chips + tap-to-add grid, used by New order and Add items. */
export function ItemPicker({ menu, onPick }: { menu: ACategory[]; onPick: (l: Omit<PickedLine, 'qty'>) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | 'all'>('all');
  const cats = menu.filter(c => c.active);
  const items = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return cats
      .filter(c => cat === 'all' || c.id === cat)
      .flatMap(c => c.items.filter(i => i.active).map(i => ({ ...i, color: c.color })))
      .filter(i => !words.length || words.every(w => i.name.toLowerCase().includes(w)));
  }, [cats, cat, q]);

  return (
    <div className="a-picker">
      <input className="a-input" type="search" placeholder="Search dishes and drinks" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the menu" />
      <div className="a-chips" role="tablist" aria-label="Menu sections">
        <button type="button" className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>
          All
        </button>
        {cats.map(c => (
          <button key={c.id} type="button" className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>
            <i style={{ background: c.color }} aria-hidden="true" />
            {c.name}
          </button>
        ))}
      </div>
      <div className="a-pick-grid">
        {items.map(i =>
          i.options
            .filter(o => o.active)
            .map(o => (
              <button
                key={o.id}
                type="button"
                className={`a-pick ${i.available ? '' : 'out'}`}
                style={{ borderLeftColor: i.color }}
                onClick={() => onPick({ itemId: i.id, optionId: o.id, name: i.name, option: o.label, diet: o.diet, price: o.price_paise })}
              >
                <span className="a-pick-name">
                  <DietDot diet={o.diet} />
                  {i.name}
                  {o.label && <small>{o.label}</small>}
                </span>
                <span className="a-pick-price">{i.available ? rs(o.price_paise) : 'Sold out'}</span>
              </button>
            )),
        )}
        {!items.length && <p className="a-muted">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}

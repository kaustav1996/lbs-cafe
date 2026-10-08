import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { MenuCategory, MenuItem } from '../data/types';
import { Footer, Nav } from '../components/Chrome';
import { DietMark } from '../components/DietMark';
import { Stepper } from '../components/Panels';
import { Vinyl } from '../components/Vinyl';
import { useCart } from '../state/cart';
import { useUi } from '../state/ui';
import { useLive } from '../state/live';
import { inr } from '../lib/format';
import { Turntable } from '../components/Gear';

// Sections a guest closed on this phone (per-viewer convenience; the menu works without it).
const CLOSED_KEY = 'lbs.menu.closed';
function readClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '');

function filterMenu(MENU: MenuCategory[], q: string, vegOnly: boolean): MenuCategory[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return MENU.map(c => {
    const catHit = words.length > 0 && words.every(w => norm(c.name).includes(w));
    const items = c.items
      .map(i => (vegOnly ? { ...i, options: i.options.filter(o => o.diet === 'veg') } : i))
      .filter(i => i.options.length > 0)
      .filter(i => !words.length || catHit || words.every(w => norm(i.name + ' ' + (i.description ?? '')).includes(w)));
    return { ...c, items };
  }).filter(c => c.items.length > 0);
}

export default function Menu() {
  const [q, setQ] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const cart = useCart();
  const { say } = useUi();
  const [params] = useSearchParams();
  const loc = useLocation();
  const { menu: MENU, settings } = useLive();
  const cats = useMemo(() => filterMenu(MENU, q, vegOnly), [MENU, q, vegOnly]);
  const [active, setActive] = useState(MENU[0]?.id ?? '');
  const barRef = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set(readClosed()));
  const searching = !!q.trim(); // a search shows every match, closed or not; Veg only keeps sections foldable
  const isOpen = (id: string) => searching || !closed.has(id);
  const saveClosed = (next: Set<string>) => {
    setClosed(next);
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
    } catch {
      /* fine: it just won't be remembered */
    }
  };
  const toggle = (id: string) => {
    const next = new Set(closed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveClosed(next);
  };
  const open1 = (id: string) => {
    if (!closed.has(id)) return;
    const next = new Set(closed);
    next.delete(id);
    saveClosed(next);
  };
  const allClosed = cats.length > 0 && cats.every(c => closed.has(c.id));

  // QR codes on tables point at /menu?table=7
  useEffect(() => {
    const t = params.get('table');
    if (t) {
      cart.dispatch({ type: 'table', table: t });
      cart.dispatch({ type: 'mode', mode: 'table' });
      say(`Ordering for table ${t}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    const id = loc.hash.replace('#', '');
    if (id) open1(id);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    else window.scrollTo(0, 0);
  }, [loc.hash]);

  // Highlight the section being read.
  useEffect(() => {
    const els = cats.map(c => document.getElementById(c.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      entries => {
        const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-90px 0px -60% 0px' },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [cats]);

  useEffect(() => {
    const bar = barRef.current;
    const chip = bar?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (!chip || !bar) return;
    const pad = parseFloat(getComputedStyle(bar).paddingLeft) || 16;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < bar.scrollLeft + pad || right > bar.scrollLeft + bar.clientWidth - pad) {
      bar.scrollTo({ left: Math.max(0, left - pad), behavior: 'smooth' });
    }
  }, [active]);

  const jump = (id: string) => {
    open1(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const shown = cats.reduce((a, c) => a + c.items.length, 0);

  return (
    <div className="page menu-page">
      <Nav />
      <header className="wrap narrow menu-head">
        <div className="head-mark">
          <Turntable />
          <h1 className="display">The menu</h1>
          <p className="menu-sub">
            Prices in rupees. {Math.round(settings.gstRate * 100)}% GST is added to the bill. Tell us about allergies before you order.
          </p>
        </div>
        <Link to="/card" className="card-banner">
          <b>Collect stamps</b> with LB’s card. Your 5th visit is half price.
        </Link>
        <div className="menu-tools">
          <label className="search" htmlFor="menu-search">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="menu-search"
              type="search"
              placeholder="Search: latte, paneer, pasta…"
              value={q}
              onChange={e => setQ(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="switch" htmlFor="veg-only">
            <input id="veg-only" type="checkbox" checked={vegOnly} onChange={e => setVegOnly(e.target.checked)} />
            <span className="switch-ui" aria-hidden="true" />
            Veg only
          </label>
        </div>
        {(q || vegOnly) && shown > 0 && (
          <p className="menu-count" aria-live="polite">
            Showing {shown} of {MENU.reduce((a, c) => a + c.items.length, 0)}
          </p>
        )}
      </header>

      {cats.length > 0 && (
        <nav className="catbar" aria-label="Menu sections">
          <div className="catbar-row" ref={barRef}>
            {cats.map(c => (
              <button
                key={c.id}
                type="button"
                data-cat={c.id}
                className={`chip ${active === c.id ? 'on' : ''}`}
                style={{ '--label': c.color } as CSSProperties}
                onClick={() => jump(c.id)}
                aria-current={active === c.id ? 'true' : undefined}
              >
                <i aria-hidden="true" />
                {c.name}
              </button>
            ))}
          </div>
        </nav>
      )}

      <div className="wrap narrow menu-body">
        {cats.length > 1 && !searching && (
          <p className="cat-all">
            <button type="button" className="linkish" onClick={() => saveClosed(allClosed ? new Set() : new Set(cats.map(c => c.id)))}>
              {allClosed ? 'Open all sections' : 'Close all sections'}
            </button>
          </p>
        )}
        {cats.map(c => (
          <section key={c.id} id={c.id} className={`cat ${isOpen(c.id) ? '' : 'is-closed'}`} style={{ '--label': c.color } as CSSProperties} aria-labelledby={`${c.id}-h`}>
            <h2 id={`${c.id}-h`} className="cat-h">
              <button type="button" className="cat-head" aria-expanded={isOpen(c.id)} aria-controls={`${c.id}-list`} onClick={() => !searching && toggle(c.id)}>
                <Vinyl color={c.color} className="cat-disc" />
                <span className="cat-text">
                  <span className="cat-name">{c.name}</span>
                  <span className="cat-meta muted num">
                    {c.items.length} {c.items.length === 1 ? 'item' : 'items'}, {inr(c.min)} to {inr(c.max)}
                  </span>
                </span>
                {!searching && (
                  <svg className="cat-chev" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </h2>
            <ul className="tracks" id={`${c.id}-list`} hidden={!isOpen(c.id)}>
              {c.items.map(i => (
                <Track key={i.id} item={i} />
              ))}
            </ul>
          </section>
        ))}

        {cats.length === 0 && (
          <div className="empty empty-menu">
            <Turntable />
            <p>
              Nothing on the menu matches “{q}”{vegOnly ? ' in veg' : ''}. Try a shorter word, or clear the search.
            </p>
            <button
              type="button"
              className="btn btn-ink"
              onClick={() => {
                setQ('');
                setVegOnly(false);
              }}
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}

function Track({ item }: { item: MenuItem }) {
  const cart = useCart();
  const paired = item.options.length > 1;
  const soldOut = item.available === false;
  return (
    <li className={`track ${paired ? 'track-pair' : ''} ${soldOut ? 'track-out' : ''}`}>
      <div className="track-main">
        <span className="track-name">{item.name}</span>
        {item.description && <span className="track-desc">{item.description}</span>}
      </div>
      <span className="leader" aria-hidden="true" />
      {soldOut ? (
        <span className="sold-out">Sold out today</span>
      ) : (
      <div className="track-buy">
        {item.options.map(o => {
          const key = `${item.id}|${o.label}`;
          const qty = cart.qtyOf(key);
          const what = `${item.name}${o.label ? `, ${o.label.toLowerCase()}` : ''}`;
          return qty > 0 ? (
            <span key={key} className="buy buy-on">
              <DietMark diet={o.diet} />
              {o.label && <span className="buy-opt">{o.label}</span>}
              <Stepper
                qty={qty}
                name={what}
                onMinus={() => cart.dispatch({ type: 'qty', key, delta: -1 })}
                onPlus={() => cart.dispatch({ type: 'add', item, option: o })}
              />
            </span>
          ) : (
            <button
              key={key}
              type="button"
              className="buy"
              onClick={() => cart.dispatch({ type: 'add', item, option: o })}
              aria-label={`Add ${what}, ${inr(o.price)}`}
            >
              <DietMark diet={o.diet} />
              {o.label && <span className="buy-opt">{o.label}</span>}
              <span className="num buy-price">{inr(o.price)}</span>
              <span className="buy-plus" aria-hidden="true">
                +
              </span>
            </button>
          );
        })}
      </div>
      )}
    </li>
  );
}

import { useMemo } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { SITE } from '../data/site';
import { useCart } from '../state/cart';
import { useLive } from '../state/live';
import { asset, useUi } from '../state/ui';
import { openState } from '../lib/format';

export function Checker({ className = '' }: { className?: string }) {
  return <div className={`checker ${className}`} aria-hidden="true" />;
}

/** Links to a section on the home page, from any route. */
export function useSectionLink() {
  const nav = useNavigate();
  const loc = useLocation();
  return (id: string) => {
    if (loc.pathname === '/') document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else nav('/', { state: { scrollTo: id } });
  };
}

/** Open or closed right now, as a small stamp. */
export function OpenStamp() {
  const { settings } = useLive();
  const status = useMemo(() => openState(settings.hours), [settings.hours]);
  return <span className={`stamp ${status.open ? 'stamp-open' : ''}`}>{status.open ? status.label : 'Closed now'}</span>;
}

/** The slim top bar. On phones the bottom bar carries the actions; wider screens get links here too. */
export function Nav(_props: { tone?: string } = {}) {
  const { count } = useCart();
  const { open } = useUi();
  const go = useSectionLink();
  return (
    <>
      <Checker />
      <header className="topbar">
        <div className="wrap topbar-row">
          <Link to="/" className="brand" aria-label={`${SITE.short} home`}>
            <img src={asset('img/bandit-256.webp')} alt="" width="40" height="31" />
            <span>LB’s</span>
          </Link>
          <nav className="topbar-links" aria-label="Main">
            <NavLink to="/menu">Menu</NavLink>
            <button type="button" className="linkish" onClick={() => go('space')}>
              The space
            </button>
            <button type="button" className="linkish" onClick={() => go('visit')}>
              Visit
            </button>
            <NavLink to="/card">LB’s card</NavLink>
          </nav>
          <div className="topbar-end">
            <OpenStamp />
            <button type="button" className="btn btn-ink btn-sm wide-only" onClick={() => open('booking')}>
              Book a table
            </button>
            <button
              type="button"
              className="bag wide-only"
              onClick={() => open('cart')}
              aria-label={count ? `Your order, ${count} items` : 'Your order is empty'}
            >
              <Icon name="bag" />
              {count > 0 && <span className="badge">{count}</span>}
            </button>
          </div>
        </div>
      </header>
    </>
  );
}

const ICONS = {
  menu: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h3',
  bag: 'M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4h4',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14v15H5z',
  card: 'M4 6h16v12H4zM8 10h.01M12 10h.01M16 10h.01M8 14h8',
} as const;

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Phone navigation, in thumb reach: the menu, the order, the table (call a server, get the bill) or a booking
 * when no table is set, and LB's card. Hidden on wide screens, where the top bar has these.
 */
export function BottomBar() {
  const { count, mode, table } = useCart();
  const { open, panel } = useUi();
  const atTable = mode === 'table' && !!table.trim();
  return (
    <nav className="bottombar" aria-label="Quick actions">
      <NavLink to="/menu" className="tab">
        <Icon name="menu" />
        Menu
      </NavLink>
      <button type="button" className={`tab ${panel === 'cart' ? 'active' : ''}`} onClick={() => open('cart')} aria-label={count ? `Your order, ${count} items` : 'Your order'}>
        <span className="tab-icon">
          <Icon name="bag" />
          {count > 0 && <span className="badge">{count}</span>}
        </span>
        Order
      </button>
      {atTable ? (
        <button type="button" className={`tab ${panel === 'waiter' ? 'active' : ''}`} onClick={() => open('waiter')}>
          <Icon name="bell" />
          Table {table.trim()}
        </button>
      ) : (
        <button type="button" className={`tab ${panel === 'booking' ? 'active' : ''}`} onClick={() => open('booking')}>
          <Icon name="calendar" />
          Book
        </button>
      )}
      <NavLink to="/card" className="tab">
        <Icon name="card" />
        Card
      </NavLink>
    </nav>
  );
}

export function Toast() {
  const { toast } = useUi();
  return (
    <div className="toast-slot" aria-live="polite">
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function Footer() {
  const go = useSectionLink();
  const { open } = useUi();
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <p className="footer-line">
          <span>Eat loud. Stay late.</span> <span>Be a Bandit.</span>
        </p>
        <div className="footer-cols">
          <div>
            <h2>Find us</h2>
            <p>
              {SITE.address.line1}
              <br />
              {SITE.address.city}
            </p>
            <a href={SITE.mapsUrl} target="_blank" rel="noreferrer">
              Get directions
            </a>
          </div>
          <div>
            <h2>Get in touch</h2>
            <p>
              <a href={SITE.phoneHref}>{SITE.phone}</a>
              <br />
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
            </p>
          </div>
          <div>
            <h2>On this site</h2>
            <p className="footer-links">
              <Link to="/menu">Menu</Link>
              <button type="button" className="linkish" onClick={() => open('booking')}>
                Book a table
              </button>
              <button type="button" className="linkish" onClick={() => go('visit')}>
                Opening hours
              </button>
              <Link to="/card">LB’s card</Link>
              {SITE.instagram && (
                <a href={SITE.instagram} target="_blank" rel="noreferrer">
                  Instagram
                </a>
              )}
              <Link to="/licences">Licences</Link>
            </p>
          </div>
        </div>
        <p className="footer-fine">
          © {new Date().getFullYear()} {SITE.name}, Salt Lake, Kolkata.
        </p>
      </div>
    </footer>
  );
}

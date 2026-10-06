import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { SITE } from '../data/site';
import { useCart } from '../state/cart';
import { asset, useUi } from '../state/ui';
import { inr } from '../lib/format';

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

export function Nav({ tone }: { tone: 'lemon' | 'night' }) {
  const { count } = useCart();
  const { open } = useUi();
  const go = useSectionLink();
  return (
    <header className={`nav nav-${tone}`}>
      <div className="wrap nav-row">
        <Link to="/" className="brand" aria-label={`${SITE.short} home`}>
          <img src={asset('img/bandit-256.webp')} alt="" width="44" height="34" />
          <span>LB's</span>
        </Link>
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/menu">Menu</NavLink>
          <button type="button" className="linkish hide-sm" onClick={() => go('space')}>
            The space
          </button>
          <button type="button" className="linkish hide-sm" onClick={() => go('visit')}>
            Visit
          </button>
        </nav>
        <div className="nav-actions">
          <button type="button" className="btn btn-ink btn-sm" onClick={() => open('booking')}>
            <span className="hide-sm">Book a table</span>
            <span className="show-sm">Book</span>
          </button>
          <button
            type="button"
            className="bag"
            onClick={() => open('cart')}
            aria-label={count ? `Your order, ${count} items` : 'Your order is empty'}
          >
            <BagIcon />
            {count > 0 && <span className="bag-count">{count}</span>}
          </button>
        </div>
      </div>
    </header>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CartBar() {
  const { count, subtotal } = useCart();
  const { open, panel } = useUi();
  if (!count || panel) return null;
  return (
    <div className="cartbar" role="region" aria-label="Order summary">
      <div className="cartbar-inner">
        <span className="cartbar-sum">
          <b>{count} {count === 1 ? 'item' : 'items'}</b>
          <span>{inr(subtotal)} before GST</span>
        </span>
        <button type="button" className="btn btn-lemon" onClick={() => open('cart')}>
          Review order
        </button>
      </div>
    </div>
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
      <Checker />
      <div className="wrap footer-grid">
        <div className="footer-sign">
          <p className="display footer-line">
            Eat loud.
            <br />
            Stay late.
            <br />
            Be a Bandit.
          </p>
        </div>
        <img className="sticker footer-sticker" src={asset('img/bandit.webp')} alt="The Limon Bandit, LB's mascot" />
        <div className="footer-cols">
          <div>
            <h3>Find us</h3>
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
            <h3>Get in touch</h3>
            <p>
              <a href={SITE.phoneHref}>{SITE.phone}</a>
              <br />
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
            </p>
          </div>
          <div>
            <h3>On this site</h3>
            <p className="footer-links">
              <Link to="/menu">Menu</Link>
              <button type="button" className="linkish" onClick={() => open('booking')}>
                Book a table
              </button>
              <button type="button" className="linkish" onClick={() => go('visit')}>
                Opening hours
              </button>
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

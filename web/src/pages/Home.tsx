import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MENU } from '../data/menu';
import { SITE } from '../data/site';
import { Checker, Footer, Nav } from '../components/Chrome';
import { Vinyl } from '../components/Vinyl';
import { asset, useUi } from '../state/ui';
import { hourRows, inr, openState } from '../lib/format';

export default function Home() {
  const { open } = useUi();
  const loc = useLocation();
  const status = useMemo(() => openState(), []);
  const rows = useMemo(() => hourRows(), []);
  const totalItems = MENU.reduce((a, c) => a + c.items.length, 0);
  const cheapest = Math.min(...MENU.map(c => c.min));

  useEffect(() => {
    const id = (loc.state as { scrollTo?: string } | null)?.scrollTo;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    else window.scrollTo(0, 0);
  }, [loc]);

  return (
    <>
      <div className="zone-lemon">
        <Nav tone="lemon" />
        <section className="wrap hero">
          <div className="hero-copy">
            <h1 className="display hero-title">
              <span>Eat loud.</span>
              <span>Sip wild.</span>
              <span>Stay curious.</span>
            </h1>
            <p className="lede">
              A café and lounge from the Limon Bandits crew, where food, music, art and culture collide. Find us on BJ block in Salt Lake,
              Kolkata.
            </p>
            <div className="cta-row">
              <Link to="/menu" className="btn btn-ink btn-lg">
                See the menu
              </Link>
              <button type="button" className="btn btn-line btn-lg" onClick={() => open('booking')}>
                Book a table
              </button>
            </div>
            <p className={`status ${status.open ? 'is-open' : ''}`}>
              <span className="dot" aria-hidden="true" />
              {status.label}
            </p>
          </div>
          <figure className="hero-photo">
            <div className="hero-frame">
              <img
                src={asset('img/corridor-1200.webp')}
                srcSet={`${asset('img/corridor-640.webp')} 640w, ${asset('img/corridor-1200.webp')} 1200w`}
                sizes="(max-width: 760px) 92vw, 40vw"
                alt="A narrow dining aisle at LB's: a wall of records lit orange on the left, booths by the windows, a black and white checkered floor."
                width="1200"
                height="1600"
                fetchPriority="high"
              />
            </div>
            <img className="sticker hero-sticker" src={asset('img/bandit.webp')} alt="" width="497" height="382" />
          </figure>
        </section>
      </div>

      <Checker />

      <section className="zone-night wall" aria-labelledby="wall-title">
        <div className="wrap">
          <div className="wall-head">
            <h2 id="wall-title" className="display">
              Pick a record.
            </h2>
            <p>
              Eleven sections, {totalItems} dishes and drinks, starting at {inr(cheapest)}. Tap a record to open that part of the menu.
            </p>
          </div>
          <ul className="wall-grid">
            {MENU.map(c => (
              <li key={c.id}>
                <Link to={{ pathname: '/menu', hash: c.id }} className="cell">
                  <Vinyl color={c.color} label={c.name} className="cell-disc" />
                  <span className="cell-meta">
                    <b>{c.name}</b>
                    <span className="num">
                      {c.items.length} items, {inr(c.min)} to {inr(c.max)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link to="/menu" className="cell cell-all">
                <img className="sticker cell-sticker" src={asset('img/bandit-256.webp')} alt="" />
                <span className="cell-meta">
                  <b>The whole menu</b>
                  <span>Search it, or filter to veg only</span>
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section id="space" className="zone-paper space" aria-labelledby="space-title">
        <div className="wrap space-grid">
          <div className="space-copy">
            <h2 id="space-title" className="display">
              Retro nostalgia with a modern edge.
            </h2>
            <p>
              LB’s comes from Limon Bandits, a creative world built around music, culture and individuality. We wanted to bring that
              energy off the stage and into a room where everyone can hang out, eat, create, connect and be themselves.
            </p>
            <p>
              Comfort food, experimental drinks, late conversations and good music. More than a place to eat. A place to belong.
            </p>
          </div>
          <figure className="ph ph-mural">
            <img
              src={asset('img/mural-640.webp')}
              srcSet={`${asset('img/mural-640.webp')} 640w, ${asset('img/mural-1200.webp')} 1200w`}
              sizes="(max-width: 760px) 46vw, 26vw"
              alt="Graffiti mural spelling LIMON, with the lemon bandit character in a bandana and glasses."
              loading="lazy"
              width="640"
              height="853"
            />
            <figcaption>The Limon mural</figcaption>
          </figure>
          <figure className="ph ph-ceiling">
            <img
              src={asset('img/ceiling-640.webp')}
              srcSet={`${asset('img/ceiling-640.webp')} 640w, ${asset('img/ceiling-1200.webp')} 1200w`}
              sizes="(max-width: 760px) 46vw, 26vw"
              alt="Blue diner booths under a mirrored ceiling with rainbow LED strips."
              loading="lazy"
              width="640"
              height="853"
            />
            <figcaption>Diner booths under the mirror ceiling</figcaption>
          </figure>
          <figure className="ph ph-neon">
            <img
              src={asset('img/neon-1600.webp')}
              srcSet={`${asset('img/neon-800.webp')} 800w, ${asset('img/neon-1600.webp')} 1600w`}
              sizes="(max-width: 760px) 92vw, 80vw"
              alt="A glowing pink cloud-shaped light over the lounge, with hanging plants and neon strips along glass walls."
              loading="lazy"
              width="1600"
              height="714"
            />
            <figcaption>Neon, hanging plants and glass walls after dark</figcaption>
          </figure>
        </div>
      </section>

      <Checker />

      <section id="visit" className="zone-lemon visit" aria-labelledby="visit-title">
        <div className="wrap">
          <h2 id="visit-title" className="display visit-title">
            Come find us in Salt Lake.
          </h2>
          <div className="visit-grid">
            <div className="visit-block">
              <h3>Address</h3>
              <p className="visit-big">
                {SITE.address.line1}
                <br />
                {SITE.address.city}
              </p>
              <a className="btn btn-ink" href={SITE.mapsUrl} target="_blank" rel="noreferrer">
                Get directions
              </a>
            </div>
            <div className="visit-block">
              <h3>Opening hours</h3>
              <table className="hours">
                <tbody>
                  {rows.map(r => (
                    <tr key={r.label} className={r.days.includes(status.today) ? 'is-today' : ''}>
                      <th scope="row">{r.label}</th>
                      <td>{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`status ${status.open ? 'is-open' : ''}`}>
                <span className="dot" aria-hidden="true" />
                {status.label}
              </p>
              <p className="muted">We take {SITE.payments}.</p>
            </div>
            <div className="visit-block">
              <h3>Bookings and questions</h3>
              <p className="visit-big num">
                <a href={SITE.phoneHref}>{SITE.phone}</a>
              </p>
              <p>
                <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
              </p>
              <button type="button" className="btn btn-line" onClick={() => open('booking')}>
                Book a table
              </button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}

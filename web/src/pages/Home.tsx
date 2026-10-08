import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SITE } from '../data/site';
import { Footer, Nav } from '../components/Chrome';
import { TapeFlip } from '../components/TapeFlip';
import { Deck } from '../components/Gear';
import { asset, useUi } from '../state/ui';
import { useLive } from '../state/live';
import { hourRows, inr, openState } from '../lib/format';

const PHOTOS = [
  {
    src: 'corridor',
    w: 1200,
    h: 1600,
    alt: 'A narrow dining aisle at LB’s: a wall of records lit orange on the left, booths by the windows, a black and white checkered floor.',
    caption: 'The record aisle',
  },
  { src: 'mural', w: 640, h: 853, alt: 'Graffiti mural spelling LIMON, with the lemon bandit character in a bandana and glasses.', caption: 'The Limon mural' },
  { src: 'ceiling', w: 640, h: 853, alt: 'Blue diner booths under a mirrored ceiling with rainbow LED strips.', caption: 'Booths under the mirror ceiling' },
  {
    src: 'neon',
    w: 1600,
    h: 714,
    alt: 'A glowing pink cloud-shaped light over the lounge, with hanging plants and neon strips along glass walls.',
    caption: 'The lounge after dark',
  },
];
const SIZES: Record<string, [string, string]> = {
  corridor: ['640', '1200'],
  mural: ['640', '1200'],
  ceiling: ['640', '1200'],
  neon: ['800', '1600'],
};

export default function Home() {
  const { open } = useUi();
  const loc = useLocation();
  const { menu: MENU, settings } = useLive();
  const status = useMemo(() => openState(settings.hours), [settings.hours]);
  const rows = useMemo(() => hourRows(settings.hours), [settings.hours]);
  const totalItems = MENU.reduce((a, c) => a + c.items.length, 0);
  const cheapest = Math.min(...MENU.map(c => c.min));

  useEffect(() => {
    const id = (loc.state as { scrollTo?: string } | null)?.scrollTo;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    else window.scrollTo(0, 0);
  }, [loc]);

  return (
    <div className="page">
      <Nav />
      <main>
        <section className="wrap hero" aria-labelledby="hero-title">
          <h1 id="hero-title" className="display hero-title">
            Eat loud. <mark>Stay late.</mark>
          </h1>
          <div className="hero-side">
            <p className="lede">A café and lounge from the Limon Bandits crew, on BJ block in Salt Lake. Comfort food, experimental drinks and good music.</p>
            <div className="cta-row">
              <Link to="/menu" className="btn btn-ink btn-lg">
                See the menu
              </Link>
              <button type="button" className="btn btn-line btn-lg" onClick={() => open('booking')}>
                Book a table
              </button>
            </div>
            <p className="hero-status">
              <span className={`stamp ${status.open ? 'stamp-open' : ''}`}>{status.label}</span>
            </p>
          </div>
          <div className="hero-deck">
            <Deck />
          </div>
        </section>

        <section id="space" className="photos" aria-label="Photos of the space">
          <ul className="photo-strip">
            {PHOTOS.map((p, i) => {
              const [small, big] = SIZES[p.src];
              return (
                <li key={p.src} className={p.w > p.h ? 'wide' : ''}>
                  <figure>
                    <img
                      src={asset(`img/${p.src}-${small}.webp`)}
                      srcSet={`${asset(`img/${p.src}-${small}.webp`)} ${small}w, ${asset(`img/${p.src}-${big}.webp`)} ${big}w`}
                      sizes={p.w > p.h ? '(max-width: 760px) 86vw, 640px' : '(max-width: 760px) 62vw, 320px'}
                      alt={p.alt}
                      width={p.w}
                      height={p.h}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      fetchPriority={i === 0 ? 'high' : undefined}
                    />
                    <figcaption>{p.caption}</figcaption>
                  </figure>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="wrap narrow sections" aria-labelledby="sections-title">
          <div className="section-head">
            <h2 id="sections-title">Pick a tape</h2>
            <p className="muted">
              {MENU.length} sections, {totalItems} dishes and drinks, from {inr(cheapest)}.
            </p>
          </div>
          <TapeFlip cats={MENU} />
          <Link to="/menu" className="btn btn-ink btn-block">
            Open the whole menu
          </Link>
        </section>

        <section className="wrap narrow story" aria-labelledby="story-title">
          <h2 id="story-title">
            Retro nostalgia with a <mark>modern edge</mark>
          </h2>
          <p>
            LB’s comes from Limon Bandits, a creative world built around music, culture and individuality. We wanted to bring that energy off the stage and into
            a room where everyone can hang out, eat, create, connect and be themselves.
          </p>
          <p>More than a place to eat. A place to belong.</p>
        </section>

        <section id="visit" className="wrap narrow visit" aria-labelledby="visit-title">
          <h2 id="visit-title">Come find us in Salt Lake</h2>
          <div className="stubs">
            <div className="stub">
              <h3>Address</h3>
              <p className="stub-big">
                {SITE.address.line1}
                <br />
                {SITE.address.city}
              </p>
              <a className="btn btn-ink" href={SITE.mapsUrl} target="_blank" rel="noreferrer">
                Get directions
              </a>
            </div>
            <div className="stub">
              <h3>Opening hours</h3>
              <table className="hours">
                <tbody>
                  {rows.map(r => (
                    <tr key={r.label} className={r.days.includes(status.today) && r.days.length < 7 ? 'is-today' : ''}>
                      <th scope="row">{r.label}</th>
                      <td className="num">{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">We take {SITE.payments}.</p>
            </div>
            <div className="stub">
              <h3>Bookings and questions</h3>
              <p className="stub-big num">
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
        </section>
      </main>
      <Footer />
    </div>
  );
}

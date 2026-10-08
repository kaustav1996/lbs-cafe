import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, HAS_API } from '../lib/api';
import { getCardToken, setCardToken } from '../lib/card';
import { inr } from '../lib/format';
import { Spinner, Walkman } from '../components/Gear';

interface CardView {
  name: string | null;
  phone: string;
  stamps: number;
  rewardStamps: number;
  rewardReady: boolean;
  reward: { percent: number; capPaise: number };
  welcome: { percent: number } | null;
  offers: { name: string; percent: number; scope: 'bill' | 'sections'; audience: 'everyone' | 'members'; endsOn: string; sections: string[] }[];
  links: { google: string; instagram: string };
  optedIn: boolean;
}

const until = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

/**
 * LB's card: a stamp per visit, the 5th visit half price. A card starts from a paid bill (claimed there with a
 * code to the guest's number), so this page only shows a card this phone has claimed.
 */
export default function Card() {
  const [token, setToken] = useState(getCardToken());
  const [card, setCard] = useState<CardView | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setCard(await api<CardView>('/api/public/card', { token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setCardToken(null);
        setToken(null);
      } else setError(e instanceof ApiError ? e.message : 'Couldn’t load your card. Refresh to try again.');
    }
  }, [token]);
  useEffect(() => {
    document.title = "LB's card | LB's";
    void load();
  }, [load]);

  return (
    <div className="page">
      <Nav />
      <main className="wrap narrow status-page card-page">
        <header className="head-mark">
          <Walkman />
          <h1 className="display">LB’s card</h1>
          <p className="status-meta">A stamp for every visit. Your 5th visit is half price.</p>
        </header>
        {error && <p className="error">{error}</p>}
        {!token && (
          <section className="card-box">
            <p>
              <b>Your card starts with a paid bill.</b> After you pay, open your bill (Get the bill on your order page, or ask your server for the
              link) and tap Claim my LB’s card. We send a code to your number to check it’s yours, every time you claim a stamp.
            </p>
            <Link to="/menu" className="btn btn-ink">
              See the menu
            </Link>
          </section>
        )}
        {token && !card && !error && <Spinner>Loading your card…</Spinner>}
        {card && <CardFace card={card} token={token!} onChange={load} onGone={() => (setCardToken(null), setToken(null), setCard(null))} />}
      </main>
      <Footer />
    </div>
  );
}

function CardFace({ card, token, onChange, onGone }: { card: CardView; token: string; onChange: () => void; onGone: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const toward = card.rewardStamps - card.stamps;
  const optIn = async (v: boolean) => {
    setBusy(true);
    await api('/api/public/card', { method: 'PATCH', token, json: { optIn: v } }).catch(() => {});
    setBusy(false);
    onChange();
  };
  const remove = async () => {
    setBusy(true);
    await api('/api/public/card', { method: 'DELETE', token }).catch(() => {});
    onGone();
  };
  return (
    <>
      <section className="card-box" aria-label="Your stamps">
        <p className="card-hello">{card.name ? `Hi ${card.name}.` : 'Hi.'}</p>
        <ol className="stamps" aria-label={`${card.stamps} of ${card.rewardStamps} stamps`}>
          {Array.from({ length: card.rewardStamps }, (_, i) => (
            <li key={i} className={i < card.stamps ? 'on' : ''} aria-hidden="true" />
          ))}
        </ol>
        <p className="card-next">
          {card.rewardReady
            ? `Your next visit: ${card.reward.percent}% off, up to ${inr(card.reward.capPaise / 100)}.`
            : `Collect ${toward} more ${toward === 1 ? 'stamp' : 'stamps'} and your next visit is ${card.reward.percent}% off.`}
        </p>
        {card.welcome && <p className="card-welcome">Welcome offer: {card.welcome.percent}% off your first visit on the card.</p>}
        <p className="status-meta">Show your server this card, or tap Add to my LB’s card on your bill. One stamp a day.</p>
      </section>

      {card.offers.length > 0 && (
        <section className="card-box" aria-label="Offers">
          <h2>On now</h2>
          <ul className="card-offers">
            {card.offers.map((o, i) => (
              <li key={i}>
                <b>{o.name}</b>: {o.percent}% off {o.scope === 'bill' ? 'the whole bill' : o.sections.join(', ')}
                {o.audience === 'members' ? ' for card members' : ''}, until {until(o.endsOn)}.
              </li>
            ))}
          </ul>
          <p className="status-meta">One discount per bill: you get whichever saves you most.</p>
        </section>
      )}

      <div className="status-actions">
        <Link to="/menu" className="btn btn-ink">
          See the menu
        </Link>
        {card.links.google && (
          <a className="btn btn-line" href={card.links.google} target="_blank" rel="noreferrer">
            Review us on Google
          </a>
        )}
        {card.links.instagram && (
          <a className="btn btn-line" href={card.links.instagram} target="_blank" rel="noreferrer">
            Follow us on Instagram
          </a>
        )}
      </div>

      <section className="card-box card-settings">
        <label className="check">
          <input type="checkbox" checked={card.optedIn} disabled={busy} onChange={e => optIn(e.target.checked)} />
          Send me offers and reminders on WhatsApp
        </label>
        {confirmDelete ? (
          <p>
            This deletes your card, your stamps and your details. Your bills stay as they are.{' '}
            <button type="button" className="btn btn-line" disabled={busy} onClick={remove}>
              Yes, delete my details
            </button>{' '}
            <button type="button" className="linkish" onClick={() => setConfirmDelete(false)}>
              Keep my card
            </button>
          </p>
        ) : (
          <button type="button" className="linkish" onClick={() => setConfirmDelete(true)}>
            Delete my details
          </button>
        )}
      </section>
    </>
  );
}

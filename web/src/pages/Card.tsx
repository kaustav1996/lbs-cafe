import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, HAS_API } from '../lib/api';
import { getCardToken, setCardToken } from '../lib/card';
import { inr } from '../lib/format';

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

/** LB's card: sign in with a WhatsApp code, collect a stamp per visit, the 5th visit is half price. */
export default function Card() {
  const [params] = useSearchParams();
  const billToken = params.get('bill');
  const nav = useNavigate();
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

  const signedIn = async (t: string) => {
    setCardToken(t);
    setToken(t);
    // Came here from a bill: put that bill on the card and go back to it.
    if (billToken) {
      try {
        await api(`/api/public/card/invoices/${encodeURIComponent(billToken)}`, { method: 'POST', token: t });
      } catch {
        /* the bill page shows why */
      }
      nav(`/bill/${billToken}`);
    }
  };

  return (
    <div className="page">
      <Nav />
      <main className="wrap narrow status-page card-page">
        <header>
          <h1 className="display">LB’s card</h1>
          <p className="status-meta">A stamp for every visit. Your 5th visit is half price.</p>
        </header>
        {error && <p className="error">{error}</p>}
        {!token && <SignIn onSignedIn={signedIn} />}
        {token && !card && !error && <p className="status-meta">Loading your card…</p>}
        {card && <CardFace card={card} token={token!} onChange={load} onGone={() => (setCardToken(null), setToken(null), setCard(null))} />}
      </main>
      <Footer />
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [off, setOff] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (phone.replace(/\D/g, '').length < 10) return setError('Add your 10-digit mobile number.');
    if (!HAS_API) return setOff('Card sign-in is coming soon. Ask your server to add today’s bill to your LB’s card.');
    setBusy(true);
    try {
      await api('/api/public/card/code', { method: 'POST', json: { phone, name: name || undefined, optIn } });
      setSent(true);
      setTimeout(() => document.getElementById('card-code')?.focus(), 0);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'card_off') setOff(err.message);
      else setError(err instanceof ApiError ? err.message : 'Couldn’t send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/api/public/card/verify', { method: 'POST', json: { phone, code: code.trim() } });
      onSignedIn(r.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t check the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (off)
    return (
      <section className="card-box">
        <p>{off}</p>
        <Link to="/menu" className="btn btn-ink">
          See the menu
        </Link>
      </section>
    );
  return (
    <section className="card-box">
      {!sent ? (
        <form className="card-form" onSubmit={send}>
          <div className="field">
            <label htmlFor="card-phone">Mobile</label>
            <input id="card-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="card-name">Name (optional)</label>
            <input id="card-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} />
            Send me offers and reminders on WhatsApp
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-ink" disabled={busy}>
            {busy ? 'Sending…' : 'Send me a code on WhatsApp'}
          </button>
        </form>
      ) : (
        <form className="card-form" onSubmit={verify}>
          <p>We sent a 6-digit code to {phone} on WhatsApp.</p>
          <div className="field">
            <label htmlFor="card-code">Code</label>
            <input id="card-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-ink" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Open my card'}
          </button>
          <button type="button" className="linkish" onClick={() => (setSent(false), setCode(''))}>
            Use a different number
          </button>
        </form>
      )}
    </section>
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

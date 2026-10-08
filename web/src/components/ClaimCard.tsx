import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { setCardToken } from '../lib/card';

type State = 'open' | 'unpaid' | 'claimed' | 'too_old' | 'soon';
const local = (p: string | null) => (p ?? '').replace(/^\+91/, '');

/**
 * Claim LB's card from a paid bill: the number given at the table (or another one), a code sent to it, and the
 * stamp lands on that number's card. Every claim needs a fresh code, even for a number checked on an earlier
 * visit. `paid` comes from the bill so the box switches on as soon as the bill is paid.
 */
export function ClaimCard({ token, paid, onClaimed }: { token: string; paid: boolean; onClaimed: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'number' | 'code' | 'done'>('number');
  const [code, setCode] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ state: State; phone: string | null; name: string | null }>(`/api/public/card/claim/${encodeURIComponent(token)}`)
      .then(r => {
        setState(r.state);
        setPhone(p => p || local(r.phone));
        setName(n => n || (r.name ?? ''));
      })
      .catch(() => setState(null));
  }, [token, paid]);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    if (phone.replace(/\D/g, '').length < 10) return setError('Add a 10-digit mobile number.');
    setBusy(true);
    try {
      await api(`/api/public/card/claim/${encodeURIComponent(token)}/code`, { method: 'POST', json: { phone } });
      setStep('code');
      setTimeout(() => document.getElementById('claim-code')?.focus(), 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code we sent.');
    setBusy(true);
    try {
      const r = await api<{ token: string }>(`/api/public/card/claim/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        json: { phone, code: code.trim(), name: name.trim() || undefined, optIn },
      });
      setCardToken(r.token);
      setStep('done');
      onClaimed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t check the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  if (step === 'done' || state === 'claimed')
    return (
      <section className="card-box no-print" aria-label="LB’s card">
        <p>
          <b>This visit is on LB’s card.</b> {step === 'done' ? 'Your stamp is in.' : ''}
        </p>
        <Link to="/card" className="btn btn-line">
          See my card
        </Link>
      </section>
    );
  if (state === 'unpaid')
    return (
      <section className="card-box no-print" aria-label="LB’s card">
        <p>Once this bill is paid, you can claim a stamp on LB’s card right here. Your 5th visit is half price.</p>
      </section>
    );
  if (state === 'too_old')
    return (
      <section className="card-box no-print" aria-label="LB’s card">
        <p>This bill was paid more than a day ago, so it can’t go on a card now.</p>
      </section>
    );
  if (state === 'soon')
    return (
      <section className="card-box no-print" aria-label="LB’s card">
        <p>Claiming LB’s card here opens soon. Ask your server to add this bill to your card.</p>
      </section>
    );

  return (
    <section className="card-box claim no-print" aria-labelledby="claim-title">
      <h2 id="claim-title">Claim my LB’s card</h2>
      <p className="status-meta">A stamp for this visit. Your 5th visit is half price. We send a code to your number to check it’s yours.</p>
      {step === 'number' ? (
        <form className="form" onSubmit={sendCode} noValidate>
          <div className="field-row">
            <div className="field">
              <label htmlFor="claim-phone">Mobile</label>
              <input id="claim-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="claim-name">Name on the card</label>
              <input id="claim-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
            </div>
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
          <button type="submit" className="btn btn-ink btn-block" disabled={busy}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form className="form" onSubmit={verify} noValidate>
          <p>
            We sent a 6-digit code to <b>{phone}</b>.{' '}
            <button type="button" className="linkish" onClick={() => (setStep('number'), setCode(''), setError(''))}>
              Change number
            </button>
          </p>
          <div className="field">
            <label htmlFor="claim-code">Code</label>
            <input
              id="claim-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-ink btn-block" disabled={busy}>
            {busy ? 'Checking…' : 'Claim my card'}
          </button>
          <button type="button" className="linkish claim-resend" onClick={() => sendCode()} disabled={busy}>
            Send the code again
          </button>
        </form>
      )}
    </section>
  );
}

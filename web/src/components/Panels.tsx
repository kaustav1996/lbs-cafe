import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SITE } from '../data/site';
import { useCart } from '../state/cart';
import { useLive } from '../state/live';
import { useUi } from '../state/ui';
import { api, ApiError, HAS_API } from '../lib/api';
import { clock, inr } from '../lib/format';
import { rememberOrder, recentOrders } from '../lib/orders';

function Drawer({ title, children, footer, label }: { title: string; label: string; children: ReactNode; footer?: ReactNode }) {
  const { close } = useUi();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input')?.focus();
  }, []);
  return (
    <div className="scrim" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        <div className="drawer-head">
          <h2 className="display">{title}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Stepper({ qty, onMinus, onPlus, name }: { qty: number; onMinus: () => void; onPlus: () => void; name: string }) {
  return (
    <span className="stepper">
      <button type="button" onClick={onMinus} aria-label={`Remove one ${name}`}>
        −
      </button>
      <output aria-live="polite">{qty}</output>
      <button type="button" onClick={onPlus} aria-label={`Add one more ${name}`}>
        +
      </button>
    </span>
  );
}

const pct = (r: number) => `${(r * 50).toFixed(1).replace(/\.0$/, '')}%`;

export function CartDrawer() {
  const cart = useCart();
  const { live, settings } = useLive();
  const { close } = useUi();
  const nav = useNavigate();
  const [previewSent, setPreviewSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canOrderOnline = HAS_API && live && settings.orderingEnabled;
  const last = recentOrders()[0];

  const send = async () => {
    setError('');
    if (cart.mode === 'table' && !cart.table) {
      setError('Add your table number. It’s on the QR stand.');
      document.getElementById('table-no')?.focus();
      return;
    }
    if (cart.mode === 'takeaway' && cart.phone.replace(/\D/g, '').length < 10) {
      setError('Add a 10-digit mobile number so we can call when it’s ready.');
      document.getElementById('order-phone')?.focus();
      return;
    }
    if (!HAS_API) return setPreviewSent(true);
    if (!canOrderOnline) {
      setError(settings.orderingEnabled ? 'Ordering is offline right now. Please order with your server.' : 'Online ordering is paused. Please order with your server.');
      return;
    }
    const missing = cart.lines.find(l => !l.dbOptionId || !l.dbItemId);
    if (missing) return setError(`${missing.name} isn’t on today’s menu any more. Remove it and try again.`);
    setBusy(true);
    try {
      const r = await api<{ token: string; order: { number: number } }>('/api/public/orders', {
        method: 'POST',
        json: {
          mode: cart.mode,
          table: cart.mode === 'table' ? cart.table : undefined,
          name: cart.name || undefined,
          phone: cart.phone || undefined,
          note: cart.note || undefined,
          lines: cart.lines.map(l => ({ itemId: l.dbItemId, optionId: l.dbOptionId, qty: l.qty })),
        },
      });
      rememberOrder(r.token, r.order.number);
      cart.dispatch({ type: 'clear' });
      close();
      nav(`/order/${r.token}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t send the order. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (previewSent) {
    return (
      <Drawer title="Order ready" label="Order ready">
        <div className="notice">
          <p>
            <b>This is the design preview.</b> Orders go straight to the kitchen screen once the site is live on {SITE.domain}.
          </p>
          <p>For now, show this list to your server.</p>
        </div>
        <ul className="lines">
          {cart.lines.map(l => (
            <li key={l.key} className="line">
              <span className="line-name">
                {l.qty} × {l.name}
                {l.option && <small>{l.option}</small>}
              </span>
              <span className="num">{inr(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-ink btn-block"
          onClick={() => {
            cart.dispatch({ type: 'clear' });
            setPreviewSent(false);
            close();
          }}
        >
          Start a new order
        </button>
      </Drawer>
    );
  }

  if (!cart.count) {
    return (
      <Drawer title="Your order" label="Your order">
        <div className="empty">
          <p>Nothing here yet. Add drinks and plates from the menu and they’ll show up here.</p>
          <Link to="/menu" className="btn btn-ink" onClick={close}>
            Open the menu
          </Link>
          {last && (
            <Link to={`/order/${last.token}`} className="btn btn-line" onClick={close}>
              Check order #{last.number}
            </Link>
          )}
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title="Your order"
      label="Your order"
      footer={
        <>
          <dl className="totals">
            <div>
              <dt>Subtotal</dt>
              <dd className="num">{inr(cart.subtotal)}</dd>
            </div>
            <div>
              <dt>CGST ({pct(cart.gstRate)})</dt>
              <dd className="num">{inr(cart.cgst)}</dd>
            </div>
            <div>
              <dt>SGST ({pct(cart.gstRate)})</dt>
              <dd className="num">{inr(cart.sgst)}</dd>
            </div>
            <div className="totals-grand">
              <dt>Total</dt>
              <dd className="num">{inr(cart.total)}</dd>
            </div>
          </dl>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-ink btn-lg btn-block" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : cart.mode === 'table' ? 'Send to the kitchen' : 'Place takeaway order'}
          </button>
        </>
      }
    >
      <ul className="lines">
        {cart.lines.map(l => (
          <li key={l.key} className="line">
            <span className="line-name">
              {l.name}
              {l.option && <small>{l.option}</small>}
              <small className="num">{inr(l.price)} each</small>
            </span>
            <Stepper
              qty={l.qty}
              name={l.name}
              onMinus={() => cart.dispatch({ type: 'qty', key: l.key, delta: -1 })}
              onPlus={() => cart.dispatch({ type: 'qty', key: l.key, delta: 1 })}
            />
          </li>
        ))}
      </ul>

      <fieldset className="field">
        <legend>Where are you eating?</legend>
        <div className="seg" role="radiogroup">
          {(['table', 'takeaway'] as const).map(m => (
            <label key={m} className={cart.mode === m ? 'on' : ''}>
              <input type="radio" name="order-mode" value={m} checked={cart.mode === m} onChange={() => cart.dispatch({ type: 'mode', mode: m })} />
              {m === 'table' ? 'At my table' : 'Takeaway'}
            </label>
          ))}
        </div>
      </fieldset>

      {cart.mode === 'table' ? (
        <div className="field">
          <label htmlFor="table-no">Table number</label>
          <input
            id="table-no"
            inputMode="numeric"
            placeholder="It’s on the QR stand"
            value={cart.table}
            onChange={e => cart.dispatch({ type: 'table', table: e.target.value })}
          />
        </div>
      ) : (
        <div className="field-row">
          <div className="field">
            <label htmlFor="order-name">Name</label>
            <input id="order-name" autoComplete="name" value={cart.name} onChange={e => cart.dispatch({ type: 'contact', name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="order-phone">Mobile</label>
            <input
              id="order-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={cart.phone}
              onChange={e => cart.dispatch({ type: 'contact', phone: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="order-note">Anything the kitchen should know?</label>
        <textarea
          id="order-note"
          rows={2}
          placeholder="Less spicy, no onion, extra shot…"
          value={cart.note}
          onChange={e => cart.dispatch({ type: 'note', note: e.target.value })}
        />
      </div>
      {cart.mode === 'table' && <p className="hint">You pay at the end, at the counter or with your server.</p>}
    </Drawer>
  );
}

function kolkataMinutesNow() {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  return h * 60 + m;
}

function todayKolkata(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

/** Half-hour slots from opening until an hour before closing; today only offers times at least 30 minutes out. */
function slotsFor(dateStr: string, hours: { open: string; close: string }[]) {
  if (!dateStr) return [];
  const d = new Date(dateStr + 'T00:00:00');
  const h = hours[d.getDay()];
  const [oh, om] = h.open.split(':').map(Number);
  const [ch, cm] = h.close.split(':').map(Number);
  const earliest = dateStr === todayKolkata() ? kolkataMinutesNow() + 30 : 0;
  const out: string[] = [];
  for (let t = oh * 60 + om; t <= ch * 60 + cm - 60; t += 30) {
    if (t < earliest) continue;
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
}

export function BookingDrawer() {
  const { close } = useUi();
  const { settings } = useLive();
  const [done, setDone] = useState<{ ref?: string } | null>(null);
  const [date, setDate] = useState(() => (slotsFor(todayKolkata(), settings.hours).length ? todayKolkata() : todayKolkata(1)));
  const [guests, setGuests] = useState(2);
  const slots = useMemo(() => slotsFor(date, settings.hours), [date, settings.hours]);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!slots.includes(time)) setTime(slots.find(s => s >= '19:00') ?? slots[0] ?? '');
  }, [slots, time]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!time) return setError('Pick another date. There are no slots left on this one.');
    if (!name.trim()) return setError('Add a name for the booking.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Add a 10-digit mobile number so we can confirm.');
    setError('');
    if (!HAS_API) return setDone({});
    setBusy(true);
    try {
      const r = await api<{ ref: string }>('/api/public/reservations', {
        method: 'POST',
        json: { name: name.trim(), phone, partySize: guests, date, time, note: note.trim() || undefined },
      });
      setDone({ ref: r.ref });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t send the request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const when = `${new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} at ${time ? clock(time) : ''}`;

  if (done) {
    return (
      <Drawer title={done.ref ? 'Request sent' : 'Table request'} label="Table request">
        <div className="notice">
          <p>
            <b>
              {guests} {guests === 1 ? 'guest' : 'guests'}, {when}
            </b>
          </p>
          {done.ref ? (
            <p>
              Your booking reference is <b>{done.ref}</b>. We’ll call {phone} to confirm. To change it, call{' '}
              <a href={`tel:${settings.phone.replace(/\s/g, '')}`}>{settings.phone}</a>.
            </p>
          ) : (
            <p>
              This is the design preview, so the request wasn’t sent. Until the site is live, call <a href={SITE.phoneHref}>{SITE.phone}</a>.
            </p>
          )}
        </div>
        <button type="button" className="btn btn-ink btn-block" onClick={close}>
          Done
        </button>
      </Drawer>
    );
  }

  if (HAS_API && !settings.bookingEnabled) {
    return (
      <Drawer title="Book a table" label="Book a table">
        <div className="notice">
          <p>Online bookings are paused right now.</p>
          <p>
            Call <a href={`tel:${settings.phone.replace(/\s/g, '')}`}>{settings.phone}</a> and we’ll hold a table for you.
          </p>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer title="Book a table" label="Book a table">
      <form className="form" onSubmit={submit} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="bk-date">Date</label>
            <input id="bk-date" type="date" min={todayKolkata()} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bk-time">Time</label>
            <select id="bk-time" value={time} onChange={e => setTime(e.target.value)} disabled={!slots.length}>
              {!slots.length && <option value="">No tables left today</option>}
              {slots.map(s => (
                <option key={s} value={s}>
                  {clock(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <span className="label">Guests</span>
          <Stepper qty={guests} name="guest" onMinus={() => setGuests(g => Math.max(1, g - 1))} onPlus={() => setGuests(g => Math.min(20, g + 1))} />
          {guests >= 10 && <p className="hint">For 10 or more, we’ll call to sort out seating.</p>}
        </div>
        <div className="field">
          <label htmlFor="bk-name">Name</label>
          <input id="bk-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bk-phone">Mobile number</label>
          <input id="bk-phone" type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bk-note">Anything we should know? (optional)</label>
          <input id="bk-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Birthday, high chair, window seat…" />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-ink btn-lg btn-block" disabled={busy}>
          {busy ? 'Sending…' : 'Request this table'}
        </button>
      </form>
    </Drawer>
  );
}

export function WaiterSheet() {
  const { close, say } = useUi();
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const ask = async (kind: 'water' | 'bill' | 'server', what: string) => {
    if (!HAS_API) {
      close();
      return say(`Preview: table ${cart.table} would ask for ${what}`);
    }
    setBusy(true);
    try {
      await api('/api/public/service-requests', { method: 'POST', json: { table: cart.table, kind } });
      close();
      say(`Done. Someone’s bringing ${what}.`);
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Couldn’t reach the counter. Wave at us instead.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer title={`Table ${cart.table}`} label="Call a server">
      <p className="lede-sm">What do you need? Staff get a ping on the counter screen.</p>
      <div className="waiter-grid">
        <button type="button" className="btn btn-ink" onClick={() => ask('water', 'water')} disabled={busy} data-autofocus>
          Water
        </button>
        <button type="button" className="btn btn-ink" onClick={() => ask('bill', 'the bill')} disabled={busy}>
          The bill
        </button>
        <button type="button" className="btn btn-ink" onClick={() => ask('server', 'a server')} disabled={busy}>
          Someone to come over
        </button>
      </div>
    </Drawer>
  );
}

export function Panels() {
  const { panel } = useUi();
  if (panel === 'cart') return <CartDrawer />;
  if (panel === 'booking') return <BookingDrawer />;
  if (panel === 'waiter') return <WaiterSheet />;
  return null;
}

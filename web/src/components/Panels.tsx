import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../data/site';
import { useCart } from '../state/cart';
import { IS_PREVIEW, useUi } from '../state/ui';
import { clock, inr } from '../lib/format';

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

export function CartDrawer() {
  const cart = useCart();
  const { close, say } = useUi();
  const [sent, setSent] = useState(false);
  const needsTable = cart.mode === 'table' && !cart.table;

  if (sent) {
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
            setSent(false);
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
              <dt>CGST ({(SITE.gstRate * 50).toFixed(1).replace(/\.0$/, '')}%)</dt>
              <dd className="num">{inr(cart.gst / 2)}</dd>
            </div>
            <div>
              <dt>SGST ({(SITE.gstRate * 50).toFixed(1).replace(/\.0$/, '')}%)</dt>
              <dd className="num">{inr(cart.gst / 2)}</dd>
            </div>
            <div className="totals-grand">
              <dt>Total</dt>
              <dd className="num">{inr(cart.total)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn btn-ink btn-lg btn-block"
            onClick={() => {
              if (needsTable) {
                say('Add your table number first');
                document.getElementById('table-no')?.focus();
                return;
              }
              if (IS_PREVIEW) setSent(true);
            }}
          >
            {cart.mode === 'table' ? 'Send to the kitchen' : 'Place takeaway order'}
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
              <input
                type="radio"
                name="order-mode"
                value={m}
                checked={cart.mode === m}
                onChange={() => cart.dispatch({ type: 'mode', mode: m })}
              />
              {m === 'table' ? 'At my table' : 'Takeaway'}
            </label>
          ))}
        </div>
      </fieldset>

      {cart.mode === 'table' && (
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
function slotsFor(dateStr: string) {
  if (!dateStr) return [];
  const d = new Date(dateStr + 'T00:00:00');
  const h = SITE.hours[d.getDay()];
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

function firstBookableDate() {
  return slotsFor(todayKolkata()).length ? todayKolkata() : todayKolkata(1);
}

export function BookingDrawer() {
  const { close } = useUi();
  const [done, setDone] = useState(false);
  const [date, setDate] = useState(firstBookableDate);
  const [guests, setGuests] = useState(2);
  const slots = useMemo(() => slotsFor(date), [date]);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slots.includes(time)) setTime(slots.find(s => s >= '19:00') ?? slots[0] ?? '');
  }, [slots, time]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!time) return setError('Pick another date. There are no slots left on this one.');
    if (!name.trim()) return setError('Add a name for the booking.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Add a 10-digit mobile number so we can confirm.');
    setError('');
    setDone(true);
  };

  if (done) {
    return (
      <Drawer title="Table request" label="Table request">
        <div className="notice">
          <p>
            <b>
              {guests} {guests === 1 ? 'guest' : 'guests'},{' '}
              {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} at {clock(time)}
            </b>
          </p>
          <p>
            This is the design preview, so the request wasn’t sent. Once the site is live, bookings land in the admin and you’ll get a
            confirmation on {phone}. Until then, call <a href={SITE.phoneHref}>{SITE.phone}</a>.
          </p>
        </div>
        <button type="button" className="btn btn-ink btn-block" onClick={close}>
          Done
        </button>
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
          <span className="label" id="bk-guests-l">
            Guests
          </span>
          <Stepper
            qty={guests}
            name="guest"
            onMinus={() => setGuests(g => Math.max(1, g - 1))}
            onPlus={() => setGuests(g => Math.min(20, g + 1))}
          />
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-ink btn-lg btn-block">
          Request this table
        </button>
      </form>
    </Drawer>
  );
}

export function WaiterSheet() {
  const { close, say } = useUi();
  const cart = useCart();
  const ask = (what: string) => {
    close();
    say(IS_PREVIEW ? `Preview: table ${cart.table} would ask for ${what}` : `On the way: ${what}`);
  };
  return (
    <Drawer title={`Table ${cart.table}`} label="Call a server">
      <p className="lede-sm">What do you need? Staff get a ping on the counter screen.</p>
      <div className="waiter-grid">
        <button type="button" className="btn btn-ink" onClick={() => ask('water')} data-autofocus>
          Water
        </button>
        <button type="button" className="btn btn-ink" onClick={() => ask('the bill')}>
          The bill
        </button>
        <button type="button" className="btn btn-ink" onClick={() => ask('a server')}>
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

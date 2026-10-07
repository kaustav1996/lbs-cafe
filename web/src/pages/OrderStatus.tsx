import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, paiseToRupees } from '../lib/api';
import { inr } from '../lib/format';
import { useCart } from '../state/cart';
import { useUi } from '../state/ui';
import { useLive } from '../state/live';
import { forgetOrder } from '../lib/orders';

interface PublicOrder {
  number: number | null;
  status: 'held' | 'new' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  holdSecondsLeft: number | null;
  source: 'table' | 'takeaway' | 'counter';
  table: string | null;
  createdAt: string;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  totals: {
    subtotal: number;
    discount: number;
    cgst: number;
    sgst: number;
    roundOff: number;
    total: number;
  };
  lines: {
    name: string;
    option: string;
    qty: number;
    unit: number;
    total: number;
  }[];
}

const STEPS = [
  { key: 'new', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'served', label: 'Served' },
] as const;

function headline(o: PublicOrder) {
  switch (o.status) {
    case 'held':
      return 'Sending it to the kitchen.';
    case 'new':
      return 'The kitchen has your order.';
    case 'preparing':
      return 'It’s being made now.';
    case 'ready':
      return o.source === 'takeaway' ? 'Ready. Pick it up at the counter.' : 'Ready. It’s on its way to your table.';
    case 'served':
      return 'Served. Enjoy.';
    case 'completed':
      return o.paymentStatus === 'paid' ? 'All done and paid. Thanks for coming.' : 'All done.';
    case 'cancelled':
      return 'This order was cancelled. Ask your server if that’s a surprise.';
  }
}

export default function OrderStatus() {
  const { token = '' } = useParams();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState('');
  const cart = useCart();
  const { open, say } = useUi();
  const { menu } = useLive();
  const nav = useNavigate();
  // While held: when the kitchen gets it, by this phone's clock (set from the server's seconds-left).
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [billing, setBilling] = useState(false);
  const getBill = async () => {
    setBilling(true);
    try {
      const r = await api<{ token: string }>(`/api/public/orders/${encodeURIComponent(token)}/bill`, { method: 'POST' });
      nav(`/bill/${r.token}`);
    } catch (e) {
      say(e instanceof ApiError ? e.message : 'Couldn’t get the bill. Ask your server.');
    } finally {
      setBilling(false);
    }
  };

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await api<{ order: PublicOrder }>(`/api/public/orders/${encodeURIComponent(token)}`);
        if (!stop) {
          setOrder(r.order);
          setDeadline(r.order.status === 'held' && r.order.holdSecondsLeft !== null ? Date.now() + r.order.holdSecondsLeft * 1000 : null);
          setError('');
        }
      } catch (e) {
        if (!stop) setError(e instanceof ApiError ? e.message : 'Couldn’t load the order.');
      }
    };
    load();
    const t = setInterval(load, order?.status === 'held' ? 5000 : 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reloadKey, order?.status === 'held']);

  // Tick the countdown; when it runs out, fetch again so the page flips to the kitchen view.
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= deadline + 500) {
        clearInterval(t);
        setReloadKey(k => k + 1);
      }
    }, 250);
    return () => clearInterval(t);
  }, [deadline]);

  const secondsLeft = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));

  /** Change order: withdraw it and put everything back in the cart. */
  const changeOrder = async () => {
    setChanging(true);
    setChangeError('');
    try {
      const r = await api<{
        lines: { itemId: number; optionId: number; qty: number }[];
      }>(`/api/public/orders/${encodeURIComponent(token)}/withdraw`, {
        method: 'POST',
      });
      let dropped = 0;
      for (const l of r.lines) {
        const item = menu.flatMap(c => c.items).find(i => i.dbId === l.itemId);
        const option = item?.options.find(o => o.dbId === l.optionId);
        if (!item || !option) {
          dropped += 1;
          continue;
        }
        for (let i = 0; i < l.qty; i++) cart.dispatch({ type: 'add', item, option });
      }
      forgetOrder(token);
      nav('/menu');
      open('cart');
      if (dropped)
        say(
          `${dropped === 1 ? 'One dish' : `${dropped} dishes`} from your order ${dropped === 1 ? 'isn’t' : 'aren’t'} on the menu any more, so ${dropped === 1 ? 'it wasn’t' : 'they weren’t'} put back.`,
        );
    } catch (e) {
      setChangeError(e instanceof ApiError ? e.message : 'Couldn’t change the order. Try again.');
      setReloadKey(k => k + 1);
    } finally {
      setChanging(false);
    }
  };

  useEffect(() => {
    if (order?.table && order.source === 'table') {
      cart.dispatch({ type: 'table', table: order.table });
      cart.dispatch({ type: 'mode', mode: 'table' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.table]);

  const stepIndex = order ? STEPS.findIndex(s => s.key === order.status) : -1;
  const finished = order?.status === 'completed';

  return (
    <div className="zone-night">
      <Nav tone="night" />
      <main className="wrap status-page">
        {!order && !error && <p className="status-meta">Loading your order…</p>}
        {error && !order && (
          <div className="empty">
            <p>{error}</p>
            <Link to="/menu" className="btn btn-lemon">
              Back to the menu
            </Link>
          </div>
        )}
        {order && (
          <>
            <header>
              <h1 className="display">{order.number ? `Order #${order.number}` : 'Your order'}</h1>
              <p className="status-meta">
                {order.source === 'table' ? `Table ${order.table}` : order.source === 'takeaway' ? 'Takeaway' : 'Counter'}, placed{' '}
                {new Date(order.createdAt).toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })}
              </p>
            </header>

            <p className="status-now" aria-live="polite">
              {headline(order)}
            </p>

            {order.status === 'held' && (
              <section className="hold" aria-label="Change your order">
                <p className="hold-count" aria-live="off">
                  Sending to the kitchen in <span className="num">{`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}</span>
                </p>
                <p className="status-meta">Want to add, remove or change something? Do it now and it goes to the kitchen when you place it again.</p>
                {changeError && (
                  <p className="error" role="alert">
                    {changeError}
                  </p>
                )}
                <button type="button" className="btn btn-lemon" onClick={changeOrder} disabled={changing || secondsLeft === 0}>
                  {changing ? 'Opening your cart…' : 'Change order'}
                </button>
              </section>
            )}

            {order.status !== 'cancelled' && order.status !== 'held' && (
              <ol className="steps" aria-label="Order progress">
                {STEPS.map((s, i) => (
                  <li
                    key={s.key}
                    className={finished || i < stepIndex ? 'done' : i === stepIndex ? 'done now' : ''}
                    aria-current={i === stepIndex ? 'step' : undefined}
                  >
                    {s.label}
                  </li>
                ))}
              </ol>
            )}

            <section className="bill" aria-label="Bill">
              <ul className="lines">
                {order.lines.map((l, i) => (
                  <li key={i} className="line">
                    <span className="line-name">
                      {l.qty} × {l.name}
                      {l.option && <small>{l.option}</small>}
                    </span>
                    <span className="num">{inr(paiseToRupees(l.total))}</span>
                  </li>
                ))}
              </ul>
              <dl className="totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd className="num">{inr(paiseToRupees(order.totals.subtotal))}</dd>
                </div>
                {order.totals.discount > 0 && (
                  <div>
                    <dt>Discount</dt>
                    <dd className="num">−{inr(paiseToRupees(order.totals.discount))}</dd>
                  </div>
                )}
                <div>
                  <dt>CGST</dt>
                  <dd className="num">{inr(paiseToRupees(order.totals.cgst))}</dd>
                </div>
                <div>
                  <dt>SGST</dt>
                  <dd className="num">{inr(paiseToRupees(order.totals.sgst))}</dd>
                </div>
                {order.totals.roundOff !== 0 && (
                  <div>
                    <dt>Round off</dt>
                    <dd className="num">{inr(paiseToRupees(order.totals.roundOff))}</dd>
                  </div>
                )}
                <div className="totals-grand">
                  <dt>Total</dt>
                  <dd className="num">{inr(paiseToRupees(order.totals.total))}</dd>
                </div>
              </dl>
              <p className="status-meta">{order.paymentStatus === 'paid' ? 'Paid. Thank you.' : 'Pay at the counter or with your server.'}</p>
            </section>

            {order.status !== 'held' && (
              <div className="status-actions">
                <Link to="/menu" className="btn btn-lemon">
                  Add more
                </Link>
                {order.status !== 'cancelled' && (
                  <button type="button" className="btn btn-line btn-outline-night" onClick={getBill} disabled={billing}>
                    Get the bill
                  </button>
                )}
                {order.source === 'table' && !finished && (
                  <button type="button" className="btn btn-line btn-outline-night" onClick={() => open('waiter')}>
                    Call a server
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

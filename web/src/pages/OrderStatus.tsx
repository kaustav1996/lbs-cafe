import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, paiseToRupees } from '../lib/api';
import { inr } from '../lib/format';
import { useCart } from '../state/cart';
import { useUi } from '../state/ui';
import { useLive } from '../state/live';
import { forgetOrder, rememberOrder } from '../lib/orders';
import { Cassette, Spinner } from '../components/Gear';
import { YourOrders } from '../components/OrderAlerts';
import { useGames } from '../state/games';
import { headline, noteStatus, onOrderUpdate, STEPS, watchOrder, type PublicOrder } from '../lib/orderWatch';

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
  // Ordering at a table opens its games: check as soon as the order is in.
  const games = useGames();
  const gamesRefresh = games.refresh;
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
          noteStatus(token, r.order.status);
          setOrder(r.order);
          setDeadline(r.order.status === 'held' && r.order.holdSecondsLeft !== null ? Date.now() + r.order.holdSecondsLeft * 1000 : null);
          setError('');
        }
      } catch (e) {
        if (!stop) setError(e instanceof ApiError ? e.message : 'Couldn’t load the order.');
      }
    };
    load();
    return () => {
      stop = true;
    };
  }, [token, reloadKey]);

  useEffect(() => {
    if (order?.number) gamesRefresh();
  }, [order?.number, gamesRefresh]);

  // Live updates: the order watcher checks every few seconds and pops up a notice when the status moves.
  useEffect(() => {
    const unwatch = watchOrder(token);
    const off = onOrderUpdate(u => {
      if (u.token !== token) return;
      setOrder(u.order);
      setDeadline(u.order.status === 'held' && u.order.holdSecondsLeft !== null ? Date.now() + u.order.holdSecondsLeft * 1000 : null);
      setError('');
    });
    return () => {
      off();
      unwatch();
    };
  }, [token]);

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
  /** Confirm order: happy with it, so send it to the kitchen now instead of waiting out the minute. */
  const [confirming, setConfirming] = useState(false);
  const confirmOrder = async () => {
    setConfirming(true);
    setChangeError('');
    try {
      const r = await api<{ order: PublicOrder }>(`/api/public/orders/${encodeURIComponent(token)}/confirm`, { method: 'POST' });
      noteStatus(token, r.order.status);
      setOrder(r.order);
      setDeadline(null);
      if (r.order.number) rememberOrder(token, r.order.number);
    } catch (e) {
      setChangeError(e instanceof ApiError ? e.message : 'Couldn’t send it yet. It goes to the kitchen on its own in a moment.');
      setReloadKey(k => k + 1);
    } finally {
      setConfirming(false);
    }
  };

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
    <div className="page">
      <Nav />
      <main className="wrap narrow status-page">
        {!order && !error && <Spinner>Loading your order…</Spinner>}
        {error && !order && (
          <div className="empty">
            <Cassette />
            <p>{error}</p>
            <Link to="/menu" className="btn btn-ink">
              Back to the menu
            </Link>
          </div>
        )}
        {order && (
          <>
            <header className="head-mark">
              <Cassette />
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
                <p className="status-meta">Happy with it? Confirm and it goes to the kitchen now. Want to add, remove or change something? Change it first.</p>
                {changeError && (
                  <p className="error" role="alert">
                    {changeError}
                  </p>
                )}
                <div className="hold-actions">
                  <button type="button" className="btn btn-ink" onClick={confirmOrder} disabled={confirming || changing}>
                    {confirming ? 'Sending…' : 'Confirm order'}
                  </button>
                  <button type="button" className="btn btn-line" onClick={changeOrder} disabled={changing || confirming || secondsLeft === 0}>
                    {changing ? 'Opening your cart…' : 'Change order'}
                  </button>
                </div>
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
            {games.on && order.source === 'table' && (
              <div className="games-banner">
                <span>Games are open for table {order.table}.</span>
                <Link to="/games" className="btn btn-ink btn-sm">
                  Play games
                </Link>
              </div>
            )}
            {order.status !== 'cancelled' && !finished && <p className="status-live">This page updates by itself as your order moves along.</p>}

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
              <p className="status-meta">{order.paymentStatus === 'paid' ? 'Paid. Thank you. Get the bill to claim a stamp on LB’s card.' : 'Pay at the counter or with your server.'}</p>
            </section>

            {order.status !== 'held' && (
              <div className="status-actions">
                <Link to="/menu" className="btn btn-ink">
                  Add more
                </Link>
                {order.status !== 'cancelled' && (
                  <button type="button" className="btn btn-line" onClick={getBill} disabled={billing}>
                    Get the bill
                  </button>
                )}
                {order.source === 'table' && !finished && (
                  <button type="button" className="btn btn-line" onClick={() => open('waiter')}>
                    Call a server
                  </button>
                )}
              </div>
            )}
          </>
        )}
        <YourOrders current={token} />
      </main>
      <Footer />
    </div>
  );
}

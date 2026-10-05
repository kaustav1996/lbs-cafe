import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, paiseToRupees } from '../lib/api';
import { inr } from '../lib/format';
import { useCart } from '../state/cart';
import { useUi } from '../state/ui';

interface PublicOrder {
  number: number;
  status: 'new' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  source: 'table' | 'takeaway' | 'counter';
  table: string | null;
  createdAt: string;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  totals: { subtotal: number; discount: number; cgst: number; sgst: number; roundOff: number; total: number };
  lines: { name: string; option: string; qty: number; unit: number; total: number }[];
}

const STEPS = [
  { key: 'new', label: 'Received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'served', label: 'Served' },
] as const;

function headline(o: PublicOrder) {
  switch (o.status) {
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
  const { open } = useUi();

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await api<{ order: PublicOrder }>(`/api/public/orders/${encodeURIComponent(token)}`);
        if (!stop) {
          setOrder(r.order);
          setError('');
        }
      } catch (e) {
        if (!stop) setError(e instanceof ApiError ? e.message : 'Couldn’t load the order.');
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token]);

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
              <h1 className="display">Order #{order.number}</h1>
              <p className="status-meta">
                {order.source === 'table' ? `Table ${order.table}` : order.source === 'takeaway' ? 'Takeaway' : 'Counter'}, placed{' '}
                {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
              </p>
            </header>

            <p className="status-now" aria-live="polite">
              {headline(order)}
            </p>

            {order.status !== 'cancelled' && (
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

            <div className="status-actions">
              <Link to="/menu" className="btn btn-lemon">
                Add more
              </Link>
              {order.source === 'table' && !finished && (
                <button type="button" className="btn btn-line btn-outline-night" onClick={() => open('waiter')}>
                  Call a server
                </button>
              )}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

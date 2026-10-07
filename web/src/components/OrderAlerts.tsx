import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { headline, onOrderUpdate, statusName, type OrderUpdate, type PublicOrder } from '../lib/orderWatch';
import { recentOrders } from '../lib/orders';

/**
 * Pops up on any page of the site when one of this phone's orders moves on (received, preparing, ready, served),
 * with a short buzz on phones that allow it. Stays 10 seconds, or until closed.
 */
export function OrderAlerts() {
  const [alert, setAlert] = useState<OrderUpdate | null>(null);
  const loc = useLocation();

  useEffect(
    () =>
      onOrderUpdate(u => {
        if (!u.prev || u.prev === u.order.status || u.order.status === 'held') return;
        setAlert(u);
        try {
          navigator.vibrate?.(u.order.status === 'ready' ? [160, 80, 160, 80, 160] : [120]);
        } catch {
          /* not allowed until the guest has tapped something; the pop-up is enough */
        }
      }),
    [],
  );

  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setAlert(null), 10_000);
    return () => clearTimeout(t);
  }, [alert]);

  const here = alert && loc.pathname === `/order/${alert.token}`;
  return (
    <div className="order-alert-slot" aria-live="assertive">
      {alert && (
        <div key={`${alert.token}-${alert.order.status}`} className={`order-alert is-${alert.order.status}`} role="status">
          <p className="order-alert-title">
            {alert.order.number ? `Order #${alert.order.number}` : 'Your order'}: <mark>{statusName(alert.order.status)}</mark>
          </p>
          <p>{headline(alert.order)}</p>
          <div className="order-alert-actions">
            {!here && (
              <Link to={`/order/${alert.token}`} className="btn btn-ink btn-sm" onClick={() => setAlert(null)}>
                See the order
              </Link>
            )}
            <button type="button" className="btn btn-line btn-sm" onClick={() => setAlert(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** This phone's other orders from today, with their live status. */
export function YourOrders({ current }: { current: string }) {
  const [list, setList] = useState<{ token: string; number: number | null; status?: PublicOrder['status'] }[]>(() =>
    recentOrders().filter(o => o.token !== current),
  );
  useEffect(() => {
    setList(recentOrders().filter(o => o.token !== current));
    return onOrderUpdate(u => {
      if (u.token === current) return;
      setList(xs => xs.map(x => (x.token === u.token ? { ...x, number: u.order.number, status: u.order.status } : x)));
    });
  }, [current]);
  if (!list.length) return null;
  return (
    <section className="your-orders" aria-labelledby="your-orders-title">
      <h2 id="your-orders-title">Your other orders</h2>
      <ul>
        {list.map(o => (
          <li key={o.token}>
            <Link to={`/order/${o.token}`}>
              <span>{o.number ? `Order #${o.number}` : 'Order'}</span>
              {o.status && <span className={`stamp ${o.status === 'ready' ? 'stamp-open' : ''}`}>{statusName(o.status)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

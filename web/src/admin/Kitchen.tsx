import { useCallback, useEffect, useState } from 'react';
import { ago, errText, useAuth, useOnEvent, useTick } from './core';
import { DietDot, Empty, PageHead, toast } from './ui';
import { where, type AOrder } from './Orders';

const COLUMNS: { key: AOrder['status']; title: string; next?: { to: AOrder['status']; label: string }; back?: { to: AOrder['status']; label: string } }[] = [
  { key: 'new', title: 'To make', next: { to: 'preparing', label: 'Start preparing' } },
  { key: 'preparing', title: 'Preparing', next: { to: 'ready', label: 'Mark ready' }, back: { to: 'new', label: 'Not started' } },
  { key: 'ready', title: 'Ready, waiting for a server', back: { to: 'preparing', label: 'Not ready yet' } },
];

/**
 * The kitchen screen, and the only screen a chef's account gets: what to make, oldest first, with no prices or
 * bills. Moving an order to ready tells the servers.
 */
export default function Kitchen() {
  const { call } = useAuth();
  const [orders, setOrders] = useState<AOrder[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  useTick(30000);

  const load = useCallback(async () => {
    try {
      const r = await call<{ orders: AOrder[] }>('/api/admin/orders?view=open');
      setOrders(r.orders.filter(o => o.status === 'new' || o.status === 'preparing' || o.status === 'ready'));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [call]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60000); // safety net if the live stream drops
    return () => clearInterval(t);
  }, [load]);
  useOnEvent(['order.created', 'order.updated'], () => void load());

  const move = async (o: AOrder, to: AOrder['status']) => {
    setBusy(o.id);
    setOrders(xs => xs && xs.map(x => (x.id === o.id ? { ...x, status: to } : x)));
    try {
      await call(`/api/admin/orders/${o.id}`, { method: 'PATCH', json: { status: to } });
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(null);
      void load();
    }
  };

  return (
    <div className="a-page">
      <PageHead title="Kitchen" />
      {error && <p className="a-error">{error}</p>}
      {!orders && !error && <p className="a-muted">Loading orders…</p>}
      {orders && orders.length === 0 && <Empty>Nothing to make. New orders appear here with a chime.</Empty>}
      {orders && orders.length > 0 && (
        <div className="a-board a-kitchen">
          {COLUMNS.map(col => {
            const list = orders.filter(o => o.status === col.key);
            return (
              <section key={col.key} className={`a-col a-col-${col.key}`} aria-label={col.title}>
                <h2>
                  {col.title} <span>{list.length}</span>
                </h2>
                {list.length === 0 && <p className="a-col-empty">Nothing here.</p>}
                {list.map(o => {
                  const late = o.status !== 'ready' && Date.now() - new Date(o.created_at).getTime() > 15 * 60000;
                  return (
                    <article key={o.id} className={`a-card a-ticket ${late ? 'late' : ''}`}>
                      <div className="a-card-main">
                        <header>
                          <b>#{o.number}</b>
                          <span>{where(o)}</span>
                          <small>{ago(o.created_at)}</small>
                        </header>
                        <ul>
                          {o.lines.map((l, i) => (
                            <li key={i}>
                              <DietDot diet={l.diet} />
                              <b>{l.qty}×</b> {l.name}
                              {(l.option || l.option_label) && <em>{l.option || l.option_label}</em>}
                            </li>
                          ))}
                        </ul>
                        {o.note && <p className="a-card-note">“{o.note}”</p>}
                      </div>
                      <div className="a-card-actions">
                        {col.next && (
                          <button type="button" className="a-btn a-btn-primary" disabled={busy === o.id} onClick={() => move(o, col.next!.to)}>
                            {col.next.label}
                          </button>
                        )}
                        {col.back && (
                          <button type="button" className="a-btn a-btn-sm" disabled={busy === o.id} onClick={() => move(o, col.back!.to)}>
                            {col.back.label}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

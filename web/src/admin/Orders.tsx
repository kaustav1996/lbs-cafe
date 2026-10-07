import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ago, errText, rs, timeIST, todayIST, useAuth, useOnEvent, useTick } from './core';
import { DietDot, Empty, Modal, PageHead, toast } from './ui';
import { ItemPicker, useAdminMenu, type PickedLine } from './picker';
import { InvoiceModal, METHODS, needsReference } from './Invoice';

export interface AOrder {
  id: number;
  number: number;
  invoice_id?: number | null;
  invoice_number?: string | null;
  invoice_status?: 'open' | 'paid' | null;
  source: 'table' | 'takeaway' | 'counter';
  table_label: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: 'new' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  payment_status: 'unpaid' | 'partial' | 'paid';
  note: string | null;
  subtotal_paise: number;
  discount_paise: number;
  discount_note: string | null;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  round_off_paise: number;
  total_paise: number;
  paid_paise: number;
  gst_rate: string;
  created_at: string;
  lines: { id?: number; name: string; option?: string; option_label?: string; qty: number; diet: string; unit_paise?: number; line_paise?: number }[];
  payments?: { id: number; method: string; amount_paise: number; created_at: string }[];
}

interface ServiceRequest {
  id: number;
  table_label: string;
  kind: 'water' | 'bill' | 'server';
  created_at: string;
}

const NEXT: Record<string, { to: AOrder['status']; label: string } | undefined> = {
  new: { to: 'preparing', label: 'Start preparing' },
  preparing: { to: 'ready', label: 'Mark ready' },
  ready: { to: 'served', label: 'Mark served' },
};

const COLUMNS: { key: string; title: string; match: (o: AOrder) => boolean }[] = [
  { key: 'new', title: 'New', match: o => o.status === 'new' },
  { key: 'preparing', title: 'Preparing', match: o => o.status === 'preparing' },
  { key: 'ready', title: 'Ready', match: o => o.status === 'ready' },
  { key: 'settle', title: 'Served, to settle', match: o => o.status === 'served' || o.status === 'completed' },
];

export const where = (o: Pick<AOrder, 'source' | 'table_label' | 'customer_name'>) =>
  o.source === 'table' ? `Table ${o.table_label}` : o.source === 'takeaway' ? `Takeaway${o.customer_name ? `, ${o.customer_name}` : ''}` : `Counter${o.customer_name ? `, ${o.customer_name}` : ''}`;

export default function Orders() {
  const { call } = useAuth();
  const [orders, setOrders] = useState<AOrder[] | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [view, setView] = useState<'open' | 'day'>('open');
  const [day, setDay] = useState(todayIST());
  const [openId, setOpenId] = useState<number | null>(null);
  const [billFor, setBillFor] = useState<number | null>(null);
  const [error, setError] = useState('');
  useTick(30000);

  const load = useCallback(async () => {
    try {
      const q = view === 'open' ? 'view=open' : `view=day&date=${day}`;
      const [o, s] = await Promise.all([
        call<{ orders: AOrder[] }>(`/api/admin/orders?${q}`),
        call<{ requests: ServiceRequest[] }>('/api/admin/service-requests'),
      ]);
      setOrders(o.orders);
      setRequests(s.requests);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [call, view, day]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60000); // safety net if the live stream drops
    return () => clearInterval(t);
  }, [load]);
  useOnEvent(['order.created', 'order.updated', 'service.created', 'service.updated'], () => void load());

  const move = async (o: AOrder, to: AOrder['status']) => {
    try {
      await call(`/api/admin/orders/${o.id}`, { method: 'PATCH', json: { status: to } });
      void load();
    } catch (e) {
      toast(errText(e), 'bad');
    }
  };

  const handled = async (r: ServiceRequest) => {
    setRequests(rs => rs.filter(x => x.id !== r.id));
    try {
      await call(`/api/admin/service-requests/${r.id}`, { method: 'PATCH', json: {} });
    } catch (e) {
      toast(errText(e), 'bad');
      void load();
    }
  };

  return (
    <div className="a-page">
      <PageHead title={view === 'open' ? 'Live orders' : 'Orders by day'}>
        <div className="a-seg">
          <button type="button" className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>
            Live
          </button>
          <button type="button" className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>
            By day
          </button>
        </div>
        {view === 'day' && <input className="a-input a-input-date" type="date" value={day} max={todayIST()} onChange={e => setDay(e.target.value)} aria-label="Day" />}
        <Link to="/admin/pos" className="a-btn a-btn-primary">
          New order
        </Link>
      </PageHead>

      {requests.length > 0 && (
        <section className="a-calls" aria-label="Tables asking for staff">
          {requests.map(r => (
            <div key={r.id} className="a-call">
              <b>Table {r.table_label}</b>
              <span>{r.kind === 'bill' ? 'wants the bill' : r.kind === 'water' ? 'wants water' : 'wants a server'}</span>
              <small>{ago(r.created_at)}</small>
              <button type="button" className="a-btn a-btn-sm" onClick={() => handled(r)}>
                Done
              </button>
            </div>
          ))}
        </section>
      )}

      {error && <p className="a-error">{error}</p>}
      {!orders && !error && <p className="a-muted">Loading orders…</p>}

      {orders && view === 'open' && (
        <div className="a-board">
          {COLUMNS.map(col => {
            const list = orders.filter(col.match);
            return (
              <section key={col.key} className={`a-col a-col-${col.key}`} aria-label={col.title}>
                <h2>
                  {col.title} <span>{list.length}</span>
                </h2>
                {list.length === 0 && <p className="a-col-empty">Nothing here.</p>}
                {list.map(o => (
                  <OrderCard key={o.id} o={o} onOpen={() => setOpenId(o.id)} onMove={to => move(o, to)} onInvoice={() => setBillFor(o.id)} />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {orders && view === 'day' && (
        <DayList orders={orders} onOpen={setOpenId} />
      )}
      {orders && view === 'open' && orders.length === 0 && (
        <Empty>
          No open orders. New QR and takeaway orders appear here with a chime. Use <Link to="/admin/pos">New order</Link> for walk-ins.
        </Empty>
      )}

      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {billFor && <InvoiceModal orderId={billFor} onClose={() => setBillFor(null)} onChanged={load} />}
    </div>
  );
}

function OrderCard({ o, onOpen, onMove, onInvoice }: { o: AOrder; onOpen: () => void; onMove: (to: AOrder['status']) => void; onInvoice: () => void }) {
  const next = NEXT[o.status];
  const due = o.total_paise - o.paid_paise;
  const late = o.status === 'new' && Date.now() - new Date(o.created_at).getTime() > 5 * 60000;
  return (
    <article className={`a-card ${late ? 'late' : ''}`}>
      <button type="button" className="a-card-main" onClick={onOpen}>
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
        <footer>
          <span className="num">{rs(o.total_paise)}</span>
          <span className={`a-pay ${o.payment_status}`}>{o.payment_status === 'paid' ? 'Paid' : o.payment_status === 'partial' ? `${rs(due)} due` : 'Unpaid'}</span>
        </footer>
      </button>
      <div className="a-card-actions">
        {next && (
          <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={() => onMove(next.to)}>
            {o.source === 'takeaway' && next.to === 'served' ? 'Picked up' : next.label}
          </button>
        )}
        {(o.status === 'served' || o.status === 'completed') && o.payment_status !== 'paid' && (
          <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={o.invoice_id ? onInvoice : onOpen}>
            Take payment
          </button>
        )}
        <button type="button" className="a-btn a-btn-sm" onClick={onInvoice}>
          Invoice
        </button>
        {o.status === 'served' && o.payment_status === 'paid' && (
          <button type="button" className="a-btn a-btn-sm" onClick={() => onMove('completed')}>
            Close order
          </button>
        )}
      </div>
    </article>
  );
}

function DayList({ orders, onOpen }: { orders: AOrder[]; onOpen: (id: number) => void }) {
  if (!orders.length) return <Empty>No orders on this day.</Empty>;
  const live = orders.filter(o => o.status !== 'cancelled');
  const total = live.reduce((a, o) => a + o.total_paise, 0);
  return (
    <div className="a-table-wrap">
      <p className="a-muted">
        {live.length} orders, {rs(total)} including GST.
      </p>
      <table className="a-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Time</th>
            <th>Where</th>
            <th>Items</th>
            <th>Status</th>
            <th>Payment</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id} onClick={() => onOpen(o.id)} className="a-row-link">
              <td>
                <button type="button" className="a-link">
                  #{o.number}
                </button>
              </td>
              <td>{timeIST(o.created_at)}</td>
              <td>{where(o)}</td>
              <td>{o.lines.reduce((a, l) => a + l.qty, 0)}</td>
              <td className={`a-status ${o.status}`}>{o.status}</td>
              <td>{o.payment_status}</td>
              <td className="r num">{rs(o.total_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrderDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { call, can } = useAuth();
  const [o, setO] = useState<AOrder | null>(null);
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState('upi');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async () => {
    const r = await call<{ order: AOrder }>(`/api/admin/orders/${id}`);
    setO(r.order);
    setAmount(String((r.order.total_paise - r.order.paid_paise) / 100));
    setDiscount(r.order.discount_paise ? String(r.order.discount_paise / 100) : '');
  }, [call, id]);
  useEffect(() => {
    void load().catch(e => toast(errText(e), 'bad'));
  }, [load]);
  useOnEvent(['order.updated'], e => e.orderId === id && void load());

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      if (done) toast(done);
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (!o)
    return (
      <Modal title="Order" onClose={onClose}>
        <p className="a-muted">Loading…</p>
      </Modal>
    );

  const due = o.total_paise - o.paid_paise;
  const closed = o.status === 'completed' || o.status === 'cancelled';
  const pct = `${(Number(o.gst_rate) * 50).toFixed(1).replace(/\.0$/, '')}%`;

  if (invoiceOpen) return <InvoiceModal orderId={o.id} onClose={() => (setInvoiceOpen(false), void load())} onChanged={onChanged} />;
  if (adding) return <AddItems orderId={o.id} onClose={() => setAdding(false)} onDone={() => act(async () => setAdding(false), 'Items added')} />;

  return (
    <Modal
      title={`Order #${o.number}`}
      onClose={onClose}
      wide
      footer={
        <>
          {!closed && can('manager') && (
            confirmCancel ? (
              <span className="a-confirm">
                Cancel this order?
                <button type="button" className="a-btn a-btn-danger a-btn-sm" disabled={busy} onClick={() => act(() => call(`/api/admin/orders/${o.id}`, { method: 'PATCH', json: { status: 'cancelled' } }), 'Order cancelled')}>
                  Yes, cancel it
                </button>
                <button type="button" className="a-btn a-btn-sm" onClick={() => setConfirmCancel(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button type="button" className="a-btn a-btn-ghost" onClick={() => setConfirmCancel(true)}>
                Cancel order
              </button>
            )
          )}
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={() => setInvoiceOpen(true)}>
            {o.invoice_number ? `Invoice ${o.invoice_number}` : 'Invoice'}
          </button>
          {o.status === 'served' && o.payment_status === 'paid' && (
            <button type="button" className="a-btn a-btn-primary" disabled={busy} onClick={() => act(() => call(`/api/admin/orders/${o.id}`, { method: 'PATCH', json: { status: 'completed' } }), 'Order closed')}>
              Close order
            </button>
          )}
        </>
      }
    >
      <div className="a-detail">
        <div>
          <p className="a-muted">
            {where(o)}, {timeIST(o.created_at)}
            {o.customer_phone && <> , {o.customer_phone}</>}. Status: <b className={`a-status ${o.status}`}>{o.status}</b>
          </p>
          {o.note && <p className="a-card-note">“{o.note}”</p>}
          <ul className="a-lines">
            {o.lines.map(l => (
              <li key={l.id}>
                <span>
                  <DietDot diet={l.diet} /> {l.name}
                  {l.option_label && <em> {l.option_label}</em>}
                  <small className="num"> {rs(l.unit_paise ?? 0)} each</small>
                </span>
                {closed ? (
                  <b>{l.qty}</b>
                ) : (
                  <span className="a-step">
                    <button type="button" disabled={busy} aria-label={`One less ${l.name}`} onClick={() => act(() => call(`/api/admin/orders/${o.id}/lines/${l.id}`, { method: 'PATCH', json: { qty: l.qty - 1 } }))}>
                      −
                    </button>
                    <b>{l.qty}</b>
                    <button type="button" disabled={busy} aria-label={`One more ${l.name}`} onClick={() => act(() => call(`/api/admin/orders/${o.id}/lines/${l.id}`, { method: 'PATCH', json: { qty: l.qty + 1 } }))}>
                      +
                    </button>
                  </span>
                )}
                <span className="num r">{rs(l.line_paise ?? 0)}</span>
              </li>
            ))}
          </ul>
          {!closed && (
            <button type="button" className="a-btn a-btn-sm" onClick={() => setAdding(true)}>
              Add items
            </button>
          )}
        </div>

        <div className="a-bill">
          <dl>
            <div><dt>Subtotal</dt><dd className="num">{rs(o.subtotal_paise)}</dd></div>
            {o.discount_paise > 0 && <div><dt>Discount{o.discount_note ? ` (${o.discount_note})` : ''}</dt><dd className="num">−{rs(o.discount_paise)}</dd></div>}
            <div><dt>CGST {pct}</dt><dd className="num">{rs(o.cgst_paise)}</dd></div>
            <div><dt>SGST {pct}</dt><dd className="num">{rs(o.sgst_paise)}</dd></div>
            {o.round_off_paise !== 0 && <div><dt>Round off</dt><dd className="num">{rs(o.round_off_paise)}</dd></div>}
            <div className="grand"><dt>Total</dt><dd className="num">{rs(o.total_paise)}</dd></div>
            {o.paid_paise > 0 && <div><dt>Paid</dt><dd className="num">{rs(o.paid_paise)}</dd></div>}
            {due > 0 && o.paid_paise > 0 && <div className="grand"><dt>Due</dt><dd className="num">{rs(due)}</dd></div>}
          </dl>

          {o.payments && o.payments.length > 0 && (
            <ul className="a-payments">
              {o.payments.map(p => (
                <li key={p.id}>
                  {p.method.toUpperCase()} <span className="num">{rs(p.amount_paise)}</span> <small>{timeIST(p.created_at)}</small>
                </li>
              ))}
            </ul>
          )}

          {can('manager') && !closed && o.invoice_status !== 'paid' && (
            <form
              className="a-inline-form"
              onSubmit={e => {
                e.preventDefault();
                const paise = Math.round(Number(discount || 0) * 100);
                void act(() => call(`/api/admin/orders/${o.id}`, { method: 'PATCH', json: { discountPaise: paise, discountNote: paise ? 'Owner discount' : null } }), paise ? 'Discount applied' : 'Discount removed');
              }}
            >
              <label className="a-field">
                <span>Discount (₹, before GST)</span>
                <input className="a-input" inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
              </label>
              <button className="a-btn a-btn-sm" disabled={busy}>
                Apply
              </button>
            </form>
          )}

          {due > 0 && o.status !== 'cancelled' && o.invoice_id && (
            <div className="a-pay-form">
              <p className="a-hint">This order is on invoice {o.invoice_number}. Take payment on the invoice so the whole bill is settled together.</p>
              <button type="button" className="a-btn a-btn-primary a-btn-lg" onClick={() => setInvoiceOpen(true)}>
                Open invoice {o.invoice_number}
              </button>
            </div>
          )}
          {due > 0 && o.status !== 'cancelled' && !o.invoice_id && (
            <form
              className="a-pay-form"
              onSubmit={e => {
                e.preventDefault();
                const paise = Math.round(Number(amount) * 100);
                if (!paise || paise <= 0) return toast('Enter the amount received.', 'bad');
                if (needsReference(method) && !reference.trim()) return toast('Add the transaction ID from the card slip or UPI app.', 'bad');
                void act(
                  () => call(`/api/admin/orders/${o.id}/payments`, { method: 'POST', json: { method, amountPaise: paise, reference: reference.trim() || undefined } }).then(() => setReference('')),
                  `${rs(paise)} received`,
                );
              }}
            >
              <span className="a-label">Take payment</span>
              <div className="a-seg a-seg-full">
                {METHODS.map(m => (
                  <button key={m.key} type="button" className={method === m.key ? 'on' : ''} onClick={() => setMethod(m.key)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="a-field">
                <span>Amount (₹)</span>
                <input className="a-input a-input-lg num" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
              </label>
              {needsReference(method) && (
                <label className="a-field">
                  <span>Transaction ID (from the {method === 'card' ? 'card slip' : 'UPI app'})</span>
                  <input className="a-input" value={reference} maxLength={60} onChange={e => setReference(e.target.value)} autoComplete="off" />
                </label>
              )}
              <button className="a-btn a-btn-primary a-btn-lg" disabled={busy}>
                Record {METHODS.find(m => m.key === method)?.label} payment
              </button>
              <p className="a-hint">Split bills: record each part separately.</p>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AddItems({ orderId, onClose, onDone }: { orderId: number; onClose: () => void; onDone: () => void }) {
  const { call } = useAuth();
  const { menu } = useAdminMenu('live');
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [busy, setBusy] = useState(false);
  const add = (l: Omit<PickedLine, 'qty'>) =>
    setLines(xs => (xs.find(x => x.optionId === l.optionId) ? xs.map(x => (x.optionId === l.optionId ? { ...x, qty: x.qty + 1 } : x)) : [...xs, { ...l, qty: 1 }]));
  return (
    <Modal
      title="Add items"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="a-muted">{lines.map(l => `${l.qty}× ${l.name}`).join(', ') || 'Tap items to add them.'}</span>
          <span className="a-spacer" />
          <button
            type="button"
            className="a-btn a-btn-primary"
            disabled={!lines.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await call(`/api/admin/orders/${orderId}/lines`, { method: 'POST', json: { lines: lines.map(l => ({ itemId: l.itemId, optionId: l.optionId, qty: l.qty })) } });
                onDone();
              } catch (e) {
                toast(errText(e), 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Add to order
          </button>
        </>
      }
    >
      {menu ? <ItemPicker menu={menu} onPick={add} /> : <p className="a-muted">Loading menu…</p>}
    </Modal>
  );
}

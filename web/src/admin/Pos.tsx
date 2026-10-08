import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errText, rs, useAuth } from './core';
import { DietDot, PageHead, toast } from './ui';
import { ItemPicker, useAdminMenu, type PickedLine } from './picker';
import type { AOrder } from './Orders';
import { needsReference, printInvoice, type Invoice } from './Invoice';

interface Table { id: number; label: string; active: boolean }

/** Walk-ins and phone orders: pick items, choose table or takeaway, optionally take payment now. */
export default function Pos() {
  const { call, can } = useAuth();
  const nav = useNavigate();
  const { menu, error } = useAdminMenu('live');
  const [tables, setTables] = useState<Table[]>([]);
  const [gstRate, setGstRate] = useState(0.18);
  const [lines, setLines] = useState<PickedLine[]>([]);
  const [source, setSource] = useState<'table' | 'takeaway' | 'counter'>('table');
  const [table, setTable] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [discount, setDiscount] = useState('');
  const [payNow, setPayNow] = useState<'' | 'upi' | 'cash' | 'card'>('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  // Phones: the Review order bar shows while the order itself is off screen.
  const [ticketInView, setTicketInView] = useState(false);
  useEffect(() => {
    const el = document.getElementById('pos-ticket');
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setTicketInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    call<{ tables: Table[] }>('/api/admin/tables').then(r => setTables(r.tables.filter(t => t.active))).catch(() => {});
    call<{ settings: { gst_rate: number } }>('/api/admin/settings').then(r => setGstRate(Number(r.settings.gst_rate))).catch(() => {});
  }, [call]);

  const add = (l: Omit<PickedLine, 'qty'>) =>
    setLines(xs => (xs.find(x => x.optionId === l.optionId) ? xs.map(x => (x.optionId === l.optionId ? { ...x, qty: x.qty + 1 } : x)) : [...xs, { ...l, qty: 1 }]));
  const bump = (optionId: number, d: number) => setLines(xs => xs.map(x => (x.optionId === optionId ? { ...x, qty: x.qty + d } : x)).filter(x => x.qty > 0));

  const t = useMemo(() => {
    const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
    const disc = Math.min(subtotal, Math.round(Number(discount || 0) * 100));
    const taxable = subtotal - disc;
    const half = Math.round((taxable * gstRate) / 2);
    const exact = taxable + half * 2;
    const total = Math.round(exact / 100) * 100;
    return { subtotal, disc, half, roundOff: total - exact, total };
  }, [lines, discount, gstRate]);

  const submit = async () => {
    if (!lines.length) return toast('Add at least one item.', 'bad');
    if (source === 'table' && !table) return toast('Pick a table.', 'bad');
    if (payNow && needsReference(payNow) && !reference.trim()) {
      document.getElementById('pos-ref')?.focus();
      return toast('Add the transaction ID from the card slip or UPI app.', 'bad');
    }
    setBusy(true);
    try {
      const r = await call<{ order: AOrder }>('/api/admin/orders', {
        method: 'POST',
        json: {
          source,
          table: source === 'table' ? table : undefined,
          name: name || undefined,
          phone: phone || undefined,
          note: note || undefined,
          lines: lines.map(l => ({ itemId: l.itemId, optionId: l.optionId, qty: l.qty })),
          discountPaise: t.disc || undefined,
          discountNote: t.disc ? 'Owner discount' : undefined,
          // No amount: the server charges what's due by its own prices (or the table's whole bill, if one is open).
          payment: payNow ? { method: payNow, reference: reference.trim() || undefined } : undefined,
        },
      });
      toast(`Order #${r.order.number} sent to the kitchen`);
      if (payNow) {
        // The receipt is the invoice.
        const inv = await call<{ invoice: Invoice }>('/api/admin/invoices', { method: 'POST', json: { orderId: r.order.id } });
        printInvoice(inv.invoice);
      }
      setLines([]);
      setNote('');
      setDiscount('');
      setPayNow('');
      setReference('');
      setName('');
      setPhone('');
      nav('/admin');
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const pct = `${(gstRate * 50).toFixed(1).replace(/\.0$/, '')}%`;

  return (
    <div className="a-page a-pos">
      <PageHead title="New order" />
      {error && <p className="a-error">{error}</p>}
      <div className="a-pos-grid">
        <section aria-label="Menu">{menu ? <ItemPicker menu={menu} onPick={add} /> : <p className="a-muted">Loading menu…</p>}</section>
        <aside className="a-ticket" aria-label="Order" id="pos-ticket">
          <div className="a-seg a-seg-full">
            {(['table', 'takeaway', 'counter'] as const).map(s => (
              <button key={s} type="button" className={source === s ? 'on' : ''} onClick={() => setSource(s)}>
                {s === 'table' ? 'Dine-in' : s === 'takeaway' ? 'Takeaway' : 'Counter'}
              </button>
            ))}
          </div>
          {source === 'table' ? (
            <div className="a-tables" role="radiogroup" aria-label="Table">
              {tables.map(tb => (
                <button key={tb.id} type="button" role="radio" aria-checked={table === tb.label} className={table === tb.label ? 'on' : ''} onClick={() => setTable(tb.label)}>
                  {tb.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="a-row2">
              <input className="a-input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} aria-label="Customer name" />
              <input className="a-input" placeholder="Mobile" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} aria-label="Customer mobile" />
            </div>
          )}

          <ul className="a-lines">
            {lines.length === 0 && <li className="a-muted">Tap items on the left to add them.</li>}
            {lines.map(l => (
              <li key={l.optionId}>
                <span>
                  <DietDot diet={l.diet} /> {l.name}
                  {l.option && <em> {l.option}</em>}
                </span>
                <span className="a-step">
                  <button type="button" onClick={() => bump(l.optionId, -1)} aria-label={`One less ${l.name}`}>
                    −
                  </button>
                  <b>{l.qty}</b>
                  <button type="button" onClick={() => bump(l.optionId, 1)} aria-label={`One more ${l.name}`}>
                    +
                  </button>
                </span>
                <span className="num r">{rs(l.price * l.qty)}</span>
              </li>
            ))}
          </ul>

          <input className="a-input" placeholder="Note for the kitchen" value={note} onChange={e => setNote(e.target.value)} aria-label="Note for the kitchen" />
          {can('manager') && (
            <label className="a-field a-field-inline">
              <span>Discount ₹</span>
              <input className="a-input" inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
            </label>
          )}

          <dl className="a-bill-mini">
            <div><dt>Subtotal</dt><dd className="num">{rs(t.subtotal)}</dd></div>
            {t.disc > 0 && <div><dt>Discount</dt><dd className="num">−{rs(t.disc)}</dd></div>}
            <div><dt>CGST {pct} + SGST {pct}</dt><dd className="num">{rs(t.half * 2)}</dd></div>
            {t.roundOff !== 0 && <div><dt>Round off</dt><dd className="num">{rs(t.roundOff)}</dd></div>}
            <div className="grand"><dt>Total</dt><dd className="num">{rs(t.total)}</dd></div>
          </dl>

          <div className="a-field">
            <span className="a-label">Payment</span>
            <div className="a-seg a-seg-full">
              {(['', 'upi', 'cash', 'card'] as const).map(m => (
                <button key={m || 'later'} type="button" className={payNow === m ? 'on' : ''} onClick={() => setPayNow(m)}>
                  {m === '' ? 'Pay later' : m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {payNow && needsReference(payNow) && (
            <label className="a-field">
              <span>Transaction ID (from the {payNow === 'card' ? 'card slip' : 'UPI app'})</span>
              <input id="pos-ref" className="a-input" value={reference} maxLength={60} onChange={e => setReference(e.target.value)} autoComplete="off" />
            </label>
          )}
          <button type="button" className="a-btn a-btn-primary a-btn-lg a-btn-block" onClick={submit} disabled={busy || !lines.length}>
            {busy ? 'Sending…' : payNow ? `Paid ${rs(t.total)}: send to kitchen` : 'Send to kitchen'}
          </button>
        </aside>
      </div>
      {lines.length > 0 && !ticketInView && (
        <button type="button" className="a-pos-jump" onClick={() => document.getElementById('pos-ticket')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span>
            Review order ({lines.reduce((a, l) => a + l.qty, 0)})
          </span>
          <b className="num">{rs(t.total)}</b>
        </button>
      )}
    </div>
  );
}

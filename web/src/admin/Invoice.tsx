import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errText, rs, useAuth, useOnEvent } from './core';
import { Modal, toast } from './ui';

export interface Invoice {
  id: number;
  number: string;
  token: string;
  status: 'open' | 'paid';
  createdAt: string;
  paidAt: string | null;
  source: 'table' | 'takeaway' | 'counter';
  table: string | null;
  orders: number[];
  cafe: { name: string; address: string; phone: string; email: string; gstin: string };
  lines: { name: string; option: string; diet: string; unit: number; qty: number; amount: number }[];
  totals: {
    subtotal: number;
    discount: number;
    discountNote: string | null;
    taxable: number;
    cgstRate: number;
    sgstRate: number;
    cgst: number;
    sgst: number;
    roundOff: number;
    total: number;
    paid: number;
    due: number;
  };
  payments: { at: string; method: string; amount: number; reference: string | null; staff?: string | null }[];
}

export const METHODS = [
  { key: 'upi', label: 'UPI' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'other', label: 'Other' },
];
/** Card and UPI payments need the transaction ID from the slip or app. */
export const needsReference = (method: string) => method === 'card' || method === 'upi';

const pct = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, '')}%`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
export const billFor = (inv: Invoice) => (inv.table ? `Table ${inv.table}` : inv.source === 'takeaway' ? 'Takeaway' : 'Counter');

/** The bill for an order (found or created) or an invoice by id, with Print and Take payment. */
export function InvoiceModal({ orderId, invoiceId, onClose, onChanged }: { orderId?: number; invoiceId?: number; onClose: () => void; onChanged?: () => void }) {
  const { call } = useAuth();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [method, setMethod] = useState('upi');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((i: Invoice) => {
    setInv(i);
    setAmount(i.totals.due ? String(i.totals.due / 100) : '');
  }, []);
  const load = useCallback(async () => {
    try {
      const r = inv?.id ?? invoiceId
        ? await call<{ invoice: Invoice }>(`/api/admin/invoices/${inv?.id ?? invoiceId}`)
        : await call<{ invoice: Invoice }>('/api/admin/invoices', { method: 'POST', json: { orderId } });
      show(r.invoice);
    } catch (e) {
      setError(errText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, orderId, invoiceId, inv?.id]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useOnEvent(['invoice.updated'], e => e.id === inv?.id && void load());

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    if (!inv) return;
    const paise = Math.round(Number(amount) * 100);
    if (!paise || paise <= 0) return toast('Enter the amount received.', 'bad');
    if (needsReference(method) && !reference.trim()) {
      document.getElementById('inv-ref')?.focus();
      return toast('Add the transaction ID from the card slip or UPI app.', 'bad');
    }
    setBusy(true);
    try {
      const r = await call<{ invoice: Invoice }>(`/api/admin/invoices/${inv.id}/payments`, {
        method: 'POST',
        json: { method, amountPaise: paise, reference: reference.trim() || undefined },
      });
      show(r.invoice);
      setReference('');
      toast(r.invoice.status === 'paid' ? `${inv.number} is paid` : `${rs(paise)} received`);
      onChanged?.();
    } catch (err) {
      toast(errText(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      onClose={onClose}
      wide
      footer={
        inv && (
          <>
            <span className="a-spacer" />
            <button type="button" className="a-btn" onClick={() => printInvoice(inv)}>
              Print
            </button>
          </>
        )
      }
    >
      {error && <p className="a-error">{error}</p>}
      {!inv && !error && <p className="a-muted">Getting the bill ready…</p>}
      {inv && (
        <div className="a-detail">
          <div>
            <p className="a-muted">
              {billFor(inv)}, {when(inv.createdAt)}. {inv.orders.length === 1 ? 'Order' : 'Orders'} #{inv.orders.join(', #')}.
            </p>
            {inv.status === 'paid' && <p className="a-paid-stamp">Paid{inv.paidAt ? `, ${when(inv.paidAt)}` : ''}</p>}
            <ul className="a-lines">
              {inv.lines.map((l, i) => (
                <li key={i}>
                  <span>
                    {l.name}
                    {l.option && <em> {l.option}</em>}
                    <small className="num"> {rs(l.unit)} each</small>
                  </span>
                  <b>{l.qty}</b>
                  <span className="num r">{rs(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="a-bill">
            <dl>
              <div><dt>Subtotal</dt><dd className="num">{rs(inv.totals.subtotal)}</dd></div>
              {inv.totals.discount > 0 && <div><dt>Discount{inv.totals.discountNote ? ` (${inv.totals.discountNote})` : ''}</dt><dd className="num">−{rs(inv.totals.discount)}</dd></div>}
              <div><dt>CGST {pct(inv.totals.cgstRate)}</dt><dd className="num">{rs(inv.totals.cgst)}</dd></div>
              <div><dt>SGST {pct(inv.totals.sgstRate)}</dt><dd className="num">{rs(inv.totals.sgst)}</dd></div>
              {inv.totals.roundOff !== 0 && <div><dt>Round off</dt><dd className="num">{rs(inv.totals.roundOff)}</dd></div>}
              <div className="grand"><dt>Total</dt><dd className="num">{rs(inv.totals.total)}</dd></div>
              {inv.totals.paid > 0 && <div><dt>Paid</dt><dd className="num">{rs(inv.totals.paid)}</dd></div>}
              {inv.totals.due > 0 && inv.totals.paid > 0 && <div className="grand"><dt>Due</dt><dd className="num">{rs(inv.totals.due)}</dd></div>}
            </dl>
            {inv.payments.length > 0 && (
              <ul className="a-payments">
                {inv.payments.map((p, i) => (
                  <li key={i}>
                    {p.method.toUpperCase()} <span className="num">{rs(p.amount)}</span>
                    {p.reference && <small> ID {p.reference}</small>} <small>{when(p.at)}{p.staff ? `, ${p.staff}` : ''}</small>
                  </li>
                ))}
              </ul>
            )}
            {inv.status === 'open' && inv.totals.due > 0 && (
              <form className="a-pay-form" onSubmit={pay}>
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
                    <input id="inv-ref" className="a-input" value={reference} maxLength={60} onChange={e => setReference(e.target.value)} autoComplete="off" />
                  </label>
                )}
                <button className="a-btn a-btn-primary a-btn-lg" disabled={busy}>
                  Record {METHODS.find(m => m.key === method)?.label} payment
                </button>
                <p className="a-hint">
                  Split bills: record each part separately. On the card machine, type {inv.number} as the bill number if it asks.
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Prints an 80 mm receipt of the invoice in a hidden frame, so the admin screen stays as it is. */
export function printInvoice(inv: Invoice) {
  const row = (a: string, b: string, strong = false) => `<tr${strong ? ' class="s"' : ''}><td>${a}</td><td class="r">${b}</td></tr>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const t = inv.totals;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.number)}</title><style>
    @page{size:80mm auto;margin:4mm} body{font:12px/1.35 'Courier New',monospace;color:#000;margin:0;width:72mm}
    h1{font-size:16px;text-align:center;margin:0} p{margin:2px 0;text-align:center} table{width:100%;border-collapse:collapse;margin-top:6px}
    td{padding:1px 0;vertical-align:top} .r{text-align:right;white-space:nowrap} .s td{font-weight:bold;border-top:1px dashed #000;padding-top:3px} hr{border:0;border-top:1px dashed #000}
  </style></head><body>
    <h1>${esc(inv.cafe.name)}</h1><p>${esc(inv.cafe.address)}</p><p>${esc(inv.cafe.phone)}</p>
    ${inv.cafe.gstin ? `<p>GSTIN ${esc(inv.cafe.gstin)}</p>` : ''}<hr>
    <p>Tax invoice ${esc(inv.number)}</p><p>${when(inv.createdAt)}</p><p>${esc(billFor(inv))}</p>
    <table>${inv.lines.map(l => row(`${l.qty} x ${esc(l.name)}${l.option ? ` (${esc(l.option)})` : ''}`, rs(l.amount))).join('')}</table>
    <table>${row('Subtotal', rs(t.subtotal), true)}${t.discount ? row('Discount', '-' + rs(t.discount)) : ''}${row(`CGST ${pct(t.cgstRate)}`, rs(t.cgst))}${row(`SGST ${pct(t.sgstRate)}`, rs(t.sgst))}${t.roundOff ? row('Round off', rs(t.roundOff)) : ''}${row('Total', rs(t.total), true)}${inv.payments.map(p => row(`Paid ${p.method.toUpperCase()}${p.reference ? ` ${esc(p.reference)}` : ''}`, rs(p.amount))).join('')}${t.due && t.paid ? row('Due', rs(t.due), true) : ''}</table>
    <hr>${inv.status === 'paid' ? '<p>Paid. Thank you.</p>' : ''}<p>Eat loud. Stay late. Be a Bandit.</p><p>lbscafe.com</p>
  </body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument!.open();
  f.contentDocument!.write(html);
  f.contentDocument!.close();
  setTimeout(() => {
    f.contentWindow!.focus();
    f.contentWindow!.print();
    setTimeout(() => f.remove(), 1000);
  }, 200);
}

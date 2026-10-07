import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Footer, Nav } from '../components/Chrome';
import { api, ApiError, paiseToRupees } from '../lib/api';
import { inr } from '../lib/format';
import { getCardToken } from '../lib/card';

interface GuestInvoice {
  number: string;
  status: 'open' | 'paid';
  createdAt: string;
  source: 'table' | 'takeaway' | 'counter';
  table: string | null;
  cafe: { name: string; address: string; phone: string; email: string; gstin: string };
  lines: { name: string; option: string; unit: number; qty: number; amount: number }[];
  totals: { subtotal: number; discount: number; discountNote: string | null; cgstRate: number; sgstRate: number; cgst: number; sgst: number; roundOff: number; total: number; paid: number; due: number };
  payments: { at: string; method: string; amount: number; reference: string | null }[];
  card: { linked: true } | null;
}

const money = (p: number) => inr(paiseToRupees(p));
const pct = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, '')}%`;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const METHOD: Record<string, string> = { upi: 'UPI', cash: 'Cash', card: 'Card', other: 'Other' };

/** The guest's copy of their bill: /bill/<token>. Refreshes so it shows "Paid" once staff record payment. */
export default function Bill() {
  const { token = '' } = useParams();
  const [inv, setInv] = useState<GuestInvoice | null>(null);
  const [error, setError] = useState('');
  const [cardMsg, setCardMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const cardToken = getCardToken();
  const addToCard = async () => {
    setAdding(true);
    setCardMsg('');
    try {
      const r = await api<{ invoice: GuestInvoice }>(`/api/public/card/invoices/${encodeURIComponent(token)}`, { method: 'POST', token: cardToken });
      setInv(r.invoice);
      setCardMsg('Added to your LB’s card. The stamp lands when the bill is paid.');
    } catch (e) {
      setCardMsg(e instanceof ApiError ? e.message : 'Couldn’t add it. Ask your server.');
    } finally {
      setAdding(false);
    }
  };

  useEffect(() => {
    document.title = "Your bill | LB's";
    let stop = false;
    const load = () =>
      api<{ invoice: GuestInvoice }>(`/api/public/invoices/${encodeURIComponent(token)}`)
        .then(r => !stop && (setInv(r.invoice), setError('')))
        .catch(e => !stop && setError(e instanceof ApiError ? e.message : 'Couldn’t load the bill. Refresh to try again.'));
    void load();
    const t = setInterval(load, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token]);

  return (
    <div className="page">
      <Nav />
      <main className="wrap narrow status-page bill-page">
        {!inv && !error && <p className="status-meta">Loading your bill…</p>}
        {error && !inv && (
          <div className="empty">
            <p>{error}</p>
            <Link to="/menu" className="btn btn-ink">
              Back to the menu
            </Link>
          </div>
        )}
        {inv && (
          <>
            <header>
              <h1 className="display">Your bill</h1>
              <p className="status-meta">
                {inv.cafe.name}, {inv.cafe.address}
                {inv.cafe.gstin && <>. GSTIN {inv.cafe.gstin}</>}
              </p>
              <p className="status-meta">
                Invoice {inv.number}, {inv.table ? `table ${inv.table}` : inv.source === 'takeaway' ? 'takeaway' : 'counter'}, {when(inv.createdAt)}
              </p>
            </header>

            <p className="status-now" aria-live="polite">
              {inv.status === 'paid' ? 'Paid. Thank you for coming.' : `${money(inv.totals.due)} to pay. Your server takes cash, cards and UPI.`}
            </p>

            <section className="bill" aria-label="Bill">
              <ul className="lines">
                {inv.lines.map((l, i) => (
                  <li key={i} className="line">
                    <span className="line-name">
                      {l.qty} × {l.name}
                      {l.option && <small>{l.option}</small>}
                    </span>
                    <span className="num">{money(l.amount)}</span>
                  </li>
                ))}
              </ul>
              <dl className="totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd className="num">{money(inv.totals.subtotal)}</dd>
                </div>
                {inv.totals.discount > 0 && (
                  <div>
                    <dt>Discount{inv.totals.discountNote ? ` (${inv.totals.discountNote})` : ''}</dt>
                    <dd className="num">−{money(inv.totals.discount)}</dd>
                  </div>
                )}
                <div>
                  <dt>CGST ({pct(inv.totals.cgstRate)})</dt>
                  <dd className="num">{money(inv.totals.cgst)}</dd>
                </div>
                <div>
                  <dt>SGST ({pct(inv.totals.sgstRate)})</dt>
                  <dd className="num">{money(inv.totals.sgst)}</dd>
                </div>
                {inv.totals.roundOff !== 0 && (
                  <div>
                    <dt>Round off</dt>
                    <dd className="num">{money(inv.totals.roundOff)}</dd>
                  </div>
                )}
                <div className="totals-grand">
                  <dt>Total</dt>
                  <dd className="num">{money(inv.totals.total)}</dd>
                </div>
                {inv.payments.map((p, i) => (
                  <div key={i}>
                    <dt>
                      Paid by {METHOD[p.method] ?? p.method}
                      {p.reference ? `, ID ${p.reference}` : ''}
                    </dt>
                    <dd className="num">{money(p.amount)}</dd>
                  </div>
                ))}
                {inv.totals.paid > 0 && inv.totals.due > 0 && (
                  <div className="totals-grand">
                    <dt>Still to pay</dt>
                    <dd className="num">{money(inv.totals.due)}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="card-box no-print" aria-label="LB’s card">
              {inv.card ? (
                <p>This bill is on an LB’s card.</p>
              ) : cardToken ? (
                <button type="button" className="btn btn-line" onClick={addToCard} disabled={adding}>
                  Add to my LB’s card
                </button>
              ) : (
                <p>
                  Collect a stamp for this visit: <Link to={`/card?bill=${encodeURIComponent(token)}`}>open LB’s card</Link>, or give your server your number.
                </p>
              )}
              {cardMsg && <p className="status-meta">{cardMsg}</p>}
            </section>

            <div className="status-actions no-print">
              <button type="button" className="btn btn-ink" onClick={() => window.print()}>
                Print or save as PDF
              </button>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

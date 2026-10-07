import { useCallback, useEffect, useState } from 'react';
import { downloadCsv, errText, rs, todayIST, useAuth } from './core';
import { Empty, PageHead, toast } from './ui';

interface Summary {
  totals: { orders: number; gross: string; subtotal: string; discount: string; taxable: string; cgst: string; sgst: string; unpaid: string; cancelled: number };
  byMethod: { method: string; count: number; amount: string }[];
  bySource: { source: string; orders: number; amount: string }[];
  daily: { day: string; orders: number; amount: string }[];
  hourly: { hour: number; orders: number }[];
  topItems: { name: string; qty: number; amount: string }[];
  discounts: { kind: string; offer: string | null; bills: number; amount: string }[];
}
interface GstRow { number: number; invoice: string | null; at: string; customer: string; subtotal_paise: number; discount_paise: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; round_off_paise: number; total_paise: number; payment_status: string }

function monthStart(offset = 0) {
  const [y, m] = todayIST().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}
function monthEnd(offset = 0) {
  const [y, m] = todayIST().split('-').map(Number);
  const d = new Date(Date.UTC(y, m + offset, 0));
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { key: 'today', label: 'Today', range: () => [todayIST(), todayIST()] },
  { key: 'yesterday', label: 'Yesterday', range: () => [todayIST(-1), todayIST(-1)] },
  { key: '7d', label: 'Last 7 days', range: () => [todayIST(-6), todayIST()] },
  { key: 'month', label: 'This month', range: () => [monthStart(), todayIST()] },
  { key: 'lastmonth', label: 'Last month', range: () => [monthStart(-1), monthEnd(-1)] },
] as const;

export default function Reports() {
  const { call, token } = useAuth();
  const [preset, setPreset] = useState<string>('today');
  const [from, setFrom] = useState(todayIST());
  const [to, setTo] = useState(todayIST());
  const [s, setS] = useState<Summary | null>(null);
  const [gst, setGst] = useState<GstRow[] | null>(null);
  const [tab, setTab] = useState<'sales' | 'gst' | 'payments'>('sales');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        call<Summary>(`/api/admin/reports/summary?from=${from}&to=${to}`),
        call<{ rows: GstRow[] }>(`/api/admin/reports/gst?from=${from}&to=${to}`),
      ]);
      setS(a);
      setGst(b.rows);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [call, from, to]);
  useEffect(() => void load(), [load]);

  const pick = (key: string) => {
    const p = PRESETS.find(x => x.key === key)!;
    const [f, t] = p.range();
    setPreset(key);
    setFrom(f);
    setTo(t);
  };

  const gross = Number(s?.totals.gross ?? 0);
  const orders = s?.totals.orders ?? 0;

  return (
    <div className="a-page">
      <PageHead title="Reports">
        <div className="a-seg a-seg-wrap">
          {PRESETS.map(p => (
            <button key={p.key} type="button" className={preset === p.key ? 'on' : ''} onClick={() => pick(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="a-range">
          <input className="a-input a-input-date" type="date" value={from} max={to} onChange={e => (setFrom(e.target.value), setPreset(''))} aria-label="From" />
          <span>to</span>
          <input className="a-input a-input-date" type="date" value={to} min={from} max={todayIST()} onChange={e => (setTo(e.target.value), setPreset(''))} aria-label="To" />
        </span>
      </PageHead>
      {error && <p className="a-error">{error}</p>}
      {s && (
        <>
          <section className="a-kpis" aria-label="Totals">
            <Kpi label="Sales (incl. GST)" value={rs(gross)} />
            <Kpi label="Orders" value={String(orders)} sub={s.totals.cancelled ? `${s.totals.cancelled} cancelled` : undefined} />
            <Kpi label="Average order" value={rs(orders ? Math.round(gross / orders) : 0)} />
            <Kpi label="GST collected" value={rs(Number(s.totals.cgst) + Number(s.totals.sgst))} sub={`CGST ${rs(s.totals.cgst)}, SGST ${rs(s.totals.sgst)}`} />
            <Kpi label="Still unpaid" value={rs(s.totals.unpaid)} tone={Number(s.totals.unpaid) > 0 ? 'warn' : undefined} />
          </section>

          <div className="a-seg">
            <button type="button" className={tab === 'sales' ? 'on' : ''} onClick={() => setTab('sales')}>
              Sales
            </button>
            <button type="button" className={tab === 'gst' ? 'on' : ''} onClick={() => setTab('gst')}>
              GST report
            </button>
            <button type="button" className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>
              Payments
            </button>
          </div>

          {tab === 'sales' && (
            <div className="a-report-grid">
              {from !== to && (
                <figure className="a-chart-card wide">
                  <figcaption>Sales by day</figcaption>
                  {s.daily.length ? (
                    <BarChart data={s.daily.map(d => ({ key: d.day, label: shortDay(d.day), value: Number(d.amount), tip: `${shortDay(d.day)}: ${rs(d.amount)}, ${d.orders} orders` }))} format={v => rs(v)} />
                  ) : (
                    <Empty>No sales in this range.</Empty>
                  )}
                </figure>
              )}
              <figure className="a-chart-card">
                <figcaption>Money received, by method</figcaption>
                <HBars rows={s.byMethod.map(m => ({ label: m.method.toUpperCase(), value: Number(m.amount), note: `${m.count} ${m.count === 1 ? 'payment' : 'payments'}` }))} format={v => rs(v)} empty="No payments recorded yet." />
              </figure>
              <figure className="a-chart-card">
                <figcaption>Orders by type</figcaption>
                <HBars
                  rows={s.bySource.map(m => ({ label: m.source === 'table' ? 'Dine-in' : m.source === 'takeaway' ? 'Takeaway' : 'Counter', value: Number(m.amount), note: `${m.orders} ${m.orders === 1 ? 'order' : 'orders'}` }))}
                  format={v => rs(v)}
                  empty="No orders yet."
                />
              </figure>
              <figure className="a-chart-card">
                <figcaption>Busiest hours (orders placed)</figcaption>
                {s.hourly.length ? (
                  <BarChart
                    data={hourSpan(s.hourly).map(h => {
                      const n = s.hourly.find(x => x.hour === h)?.orders ?? 0;
                      const h12 = h % 12 === 0 ? 12 : h % 12;
                      return { key: String(h), label: `${h12}${h >= 12 ? 'p' : 'a'}`, value: n, tip: `${h12} ${h >= 12 ? 'pm' : 'am'}: ${n} ${n === 1 ? 'order' : 'orders'}` };
                    })}
                    format={v => String(v)}
                  />
                ) : (
                  <Empty>No orders yet.</Empty>
                )}
              </figure>
              <figure className="a-chart-card">
                <figcaption>Best sellers</figcaption>
                <HBars rows={s.topItems.map(t => ({ label: t.name, value: t.qty, note: rs(t.amount) }))} format={v => `${v} sold`} empty="Nothing sold yet." />
              </figure>
              <figure className="a-chart-card">
                <figcaption>Discounts given</figcaption>
                <HBars
                  rows={(s.discounts ?? []).map(d => ({
                    label: d.kind === 'offer' ? d.offer ?? 'Offer' : DISCOUNT_LABEL[d.kind] ?? d.kind,
                    value: Number(d.amount),
                    note: `${d.bills} ${d.bills === 1 ? 'bill' : 'bills'}`,
                  }))}
                  format={v => rs(v)}
                  empty="No discounts in this range."
                />
              </figure>
            </div>
          )}

          {tab === 'payments' && <PaymentsTab from={from} to={to} />}

          {tab === 'gst' && gst && (
            <section className="a-gst">
              <div className="a-gst-head">
                <p className="a-muted">
                  Taxable value {rs(s.totals.taxable)}, CGST {rs(s.totals.cgst)}, SGST {rs(s.totals.sgst)} across {gst.length} bills. Cancelled orders are left out.
                </p>
                <button
                  type="button"
                  className="a-btn a-btn-primary"
                  onClick={() => downloadCsv(call, token, `/api/admin/reports/gst?from=${from}&to=${to}&format=csv`, `lbs-gst-${from}-to-${to}.csv`).catch(e => toast(errText(e), 'bad'))}
                >
                  Download CSV
                </button>
              </div>
              {gst.length === 0 ? (
                <Empty>No bills in this range.</Empty>
              ) : (
                <div className="a-table-wrap">
                  <table className="a-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th className="r">Subtotal</th>
                        <th className="r">Discount</th>
                        <th className="r">Taxable</th>
                        <th className="r">CGST</th>
                        <th className="r">SGST</th>
                        <th className="r">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gst.map(r => (
                        <tr key={r.number}>
                          <td>#{r.number}</td>
                          <td>{r.invoice ?? ''}</td>
                          <td>{r.at}</td>
                          <td>{r.customer}</td>
                          <td className="r num">{rs(r.subtotal_paise)}</td>
                          <td className="r num">{r.discount_paise ? rs(r.discount_paise) : ''}</td>
                          <td className="r num">{rs(r.taxable_paise)}</td>
                          <td className="r num">{rs(r.cgst_paise)}</td>
                          <td className="r num">{rs(r.sgst_paise)}</td>
                          <td className="r num">{rs(r.total_paise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

interface PaymentRow { time: string; method: string; amount: number; reference: string | null; invoice: string | null; orders: string; tables: string | null; staff: string | null }
const DISCOUNT_LABEL: Record<string, string> = { reward: '5th-visit reward', welcome: 'Welcome offer', manual: 'Manual (on a bill)', order: 'Manual (on an order)' };
const METHOD_LABEL: Record<string, string> = { upi: 'UPI', cash: 'Cash', card: 'Card', other: 'Other' };

/** Reconciliation: one row per transaction, to match against the card machine's settlement and the UPI statement. */
function PaymentsTab({ from, to }: { from: string; to: string }) {
  const { call, token } = useAuth();
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ rows: PaymentRow[]; byMethod: Record<string, number> } | null>(null);
  const query = `from=${from}&to=${to}${method ? `&method=${method}` : ''}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`;
  useEffect(() => {
    const t = setTimeout(() => {
      call<{ rows: PaymentRow[]; byMethod: Record<string, number> }>(`/api/admin/reports/payments?${query}`)
        .then(setData)
        .catch(e => toast(errText(e), 'bad'));
    }, 250);
    return () => clearTimeout(t);
  }, [call, query]);

  return (
    <section className="a-gst">
      <div className="a-gst-head">
        <div className="a-seg">
          {['', 'upi', 'card', 'cash', 'other'].map(m => (
            <button key={m || 'all'} type="button" className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
              {m ? METHOD_LABEL[m] : 'All'}
            </button>
          ))}
        </div>
        <input className="a-input" type="search" placeholder="Transaction ID or invoice" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search payments" />
        <button
          type="button"
          className="a-btn a-btn-primary"
          onClick={() => downloadCsv(call, token, `/api/admin/reports/payments?${query}&format=csv`, `lbs-payments-${from}-to-${to}.csv`).catch(e => toast(errText(e), 'bad'))}
        >
          Download CSV
        </button>
      </div>
      {data && (
        <p className="a-muted">
          {Object.keys(data.byMethod).length === 0
            ? 'No payments in this range.'
            : Object.entries(data.byMethod)
                .map(([m, v]) => `${METHOD_LABEL[m] ?? m} ${rs(v)}`)
                .join(', ') + `. ${data.rows.length} ${data.rows.length === 1 ? 'transaction' : 'transactions'}.`}
        </p>
      )}
      {data && data.rows.length > 0 && (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Method</th>
                <th className="r">Amount</th>
                <th>Transaction ID</th>
                <th>Invoice</th>
                <th>Orders</th>
                <th>Table</th>
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.time}</td>
                  <td>{METHOD_LABEL[r.method] ?? r.method}</td>
                  <td className="r num">{rs(r.amount)}</td>
                  <td>{r.reference ?? (r.method === 'card' || r.method === 'upi' ? <span className="a-muted">Missing</span> : '')}</td>
                  <td>{r.invoice ?? ''}</td>
                  <td>#{r.orders.split(', ').join(', #')}</td>
                  <td>{r.tables ?? ''}</td>
                  <td>{r.staff ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Opening hours by default, stretched to include any order placed outside them. */
function hourSpan(hourly: { hour: number }[]) {
  const lo = Math.min(10, ...hourly.map(h => h.hour));
  const hi = Math.max(22, ...hourly.map(h => h.hour));
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

function shortDay(iso: string) {
  return new Date(iso + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className={`a-kpi ${tone ?? ''}`}>
      <span>{label}</span>
      <b className="num">{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Vertical bars, one series: lemon marks on the night surface, rounded data-ends, hover tooltip. */
function BarChart({ data, format }: { data: { key: string; label: string; value: number; tip: string }[]; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, padL = 8, padB = 22, padT = 12;
  const max = Math.max(1, ...data.map(d => d.value));
  const bw = (W - padL * 2) / data.length;
  const barW = Math.max(4, Math.min(36, bw - 2));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const showEvery = Math.ceil(data.length / 12);
  return (
    <div className="a-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bar chart, highest ${format(max)}`} preserveAspectRatio="none">
        {[0.5, 1].map(t => (
          <line key={t} x1={0} x2={W} y1={y(max * t)} y2={y(max * t)} className="a-grid" />
        ))}
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="a-axis" />
        {data.map((d, i) => {
          const x = padL + i * bw + (bw - barW) / 2;
          const top = y(d.value);
          const h = Math.max(0, H - padB - top);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={d.tip}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {h > 0 && <path d={roundedTop(x, top, barW, h, Math.min(4, barW / 2, h))} className={`a-bar ${hover === i ? 'on' : ''}`} />}
              {i % showEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} className="a-tick" textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="a-tip" style={{ left: `${((padL + hover * bw + bw / 2) / W) * 100}%` }}>
          {data[hover].tip}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Horizontal bars with the value written at the end: for a handful of named rows. */
function HBars({ rows, format, empty }: { rows: { label: string; value: number; note?: string }[]; format: (v: number) => string; empty: string }) {
  if (!rows.length) return <p className="a-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="a-hbars">
      {rows.map(r => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? `, ${r.note}` : ''}`}>
          <span className="a-hbar-label">{r.label}</span>
          <span className="a-hbar-track">
            <i style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="a-hbar-val num">
            {format(r.value)}
            {r.note && <small>{r.note}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

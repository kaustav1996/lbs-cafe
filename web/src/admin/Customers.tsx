import { useCallback, useEffect, useState } from 'react';
import { downloadCsv, errText, rs, useAuth } from './core';
import { Empty, Modal, PageHead, toast } from './ui';

interface Customer {
  id: number;
  name: string | null;
  phone: string;
  email: string | null;
  visits: number;
  spent_paise: string;
  orders: number;
  bookings: number;
  created_at: string;
  last_seen_at: string;
  stamps: number;
  rewards: number;
  opted_in: boolean;
  welcome_used_at: string | null;
  last_visit_at: string | null;
}

export default function Customers() {
  const { call, token, can } = useAuth();
  const [adjusting, setAdjusting] = useState<Customer | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await call<{ customers: Customer[] }>(`/api/admin/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`);
      setRows(r.customers);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [call, q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  return (
    <div className="a-page">
      <PageHead title="Customers">
        <input className="a-input" type="search" placeholder="Name or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Search customers" />
        <button type="button" className="a-btn" onClick={() => downloadCsv(call, token, '/api/admin/customers?format=csv', 'lbs-customers.csv').catch(e => toast(errText(e), 'bad'))}>
          Download CSV
        </button>
      </PageHead>
      <p className="a-muted">
        Anyone who leaves a mobile number on a takeaway order, a counter order or a booking is saved here, along with everyone on an LB’s card.
      </p>
      {error && <p className="a-error">{error}</p>}
      {rows && rows.length === 0 && <Empty>{q ? `No one matches “${q}”.` : 'No customers yet. They appear after their first order or booking.'}</Empty>}
      {rows && rows.length > 0 && (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th className="r">Orders</th>
                <th className="r">Bookings</th>
                <th className="r">Spent</th>
                <th className="r">Stamps</th>
                <th className="r">Rewards</th>
                <th>WhatsApp</th>
                <th>Last visit</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>{c.name || <span className="a-muted">No name</span>}</td>
                  <td>
                    <a href={`tel:${c.phone}`}>{c.phone}</a>
                  </td>
                  <td className="r num">{c.orders}</td>
                  <td className="r num">{c.bookings}</td>
                  <td className="r num">{rs(c.spent_paise)}</td>
                  <td className="r num">
                    {can('owner') ? (
                      <button type="button" className="a-link" onClick={() => setAdjusting(c)} title="Correct stamps">
                        {c.stamps}
                      </button>
                    ) : (
                      c.stamps
                    )}
                  </td>
                  <td className="r num">{c.rewards}</td>
                  <td>{c.opted_in ? 'Yes' : ''}</td>
                  <td>{c.last_visit_at ? date(c.last_visit_at) : ''}</td>
                  <td>{date(c.created_at)}</td>
                  <td>{date(c.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adjusting && <StampEditor c={adjusting} onClose={() => setAdjusting(null)} onSaved={() => (setAdjusting(null), void load())} />}
    </div>
  );
}

/** Owner-only: put a customer's stamps right (logged with the reason). */
function StampEditor({ c, onClose, onSaved }: { c: Customer; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const [stamps, setStamps] = useState(String(c.stamps));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    if (!note.trim()) return setError('Say why, for example "Missed a stamp on Sunday".');
    try {
      await call(`/api/admin/customers/${c.id}/stamps`, { method: 'PATCH', json: { stamps: Number(stamps), note: note.trim() } });
      toast('Stamps updated');
      onSaved();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Modal
      title={`Stamps for ${c.name || c.phone}`}
      onClose={onClose}
      footer={
        <>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="a-form">
        <label className="a-field">
          <span>Stamps</span>
          <input className="a-input num" type="number" min={0} value={stamps} onChange={e => setStamps(e.target.value)} data-autofocus />
        </label>
        <label className="a-field">
          <span>Why</span>
          <input className="a-input" value={note} maxLength={120} onChange={e => setNote(e.target.value)} placeholder="Missed a stamp on Sunday" />
        </label>
        {error && <p className="a-error">{error}</p>}
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { downloadCsv, errText, rs, useAuth } from './core';
import { Empty, PageHead, toast } from './ui';

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
}

export default function Customers() {
  const { call, token } = useAuth();
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
      <p className="a-muted">Anyone who leaves a mobile number on a takeaway order, a counter order or a booking is saved here.</p>
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
                  <td>{date(c.created_at)}</td>
                  <td>{date(c.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

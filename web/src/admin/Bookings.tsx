import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errText, timeIST, todayIST, useAuth, useOnEvent } from './core';
import { Empty, Modal, PageHead, toast } from './ui';

interface Reservation {
  id: number;
  ref: string;
  name: string;
  phone: string;
  party_size: number;
  starts_at: string;
  table_label: string | null;
  note: string | null;
  status: 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'rejected' | 'no_show';
  source: 'web' | 'staff';
}

const LABEL: Record<Reservation['status'], string> = {
  pending: 'Waiting for you',
  confirmed: 'Confirmed',
  seated: 'Seated',
  completed: 'Done',
  cancelled: 'Cancelled',
  rejected: 'Declined',
  no_show: 'No-show',
};

export default function Bookings() {
  const { call } = useAuth();
  const [from, setFrom] = useState(todayIST());
  const [span, setSpan] = useState<1 | 7>(1);
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [pending, setPending] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const to = span === 1 ? from : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(new Date(from + 'T12:00:00+05:30').getTime() + 6 * 86400000));
  const load = useCallback(async () => {
    try {
      const r = await call<{ reservations: Reservation[]; pending: number }>(`/api/admin/reservations?from=${from}&to=${to}`);
      setRows(r.reservations);
      setPending(r.pending);
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [call, from, to]);
  useEffect(() => void load(), [load]);
  useOnEvent(['reservation.created', 'reservation.updated'], () => void load());

  const set = async (r: Reservation, status: Reservation['status'], table?: string) => {
    try {
      await call(`/api/admin/reservations/${r.id}`, { method: 'PATCH', json: { status, ...(table !== undefined ? { table } : {}) } });
      toast(`${r.name}: ${LABEL[status].toLowerCase()}`);
      void load();
    } catch (e) {
      toast(errText(e), 'bad');
    }
  };

  const byDay = new Map<string, Reservation[]>();
  for (const r of rows ?? []) {
    const d = new Date(r.starts_at).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(r);
  }

  return (
    <div className="a-page">
      <PageHead title="Bookings">
        <input className="a-input a-input-date" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
        <div className="a-seg">
          <button type="button" className={span === 1 ? 'on' : ''} onClick={() => setSpan(1)}>
            Day
          </button>
          <button type="button" className={span === 7 ? 'on' : ''} onClick={() => setSpan(7)}>
            Week
          </button>
        </div>
        <button type="button" className="a-btn a-btn-primary" onClick={() => setAdding(true)}>
          Add booking
        </button>
      </PageHead>
      {pending > 0 && <p className="a-banner">{pending === 1 ? '1 online request is' : `${pending} online requests are`} waiting for a yes or no. Call the guest, then confirm.</p>}
      {error && <p className="a-error">{error}</p>}
      {rows && rows.length === 0 && <Empty>No bookings {span === 1 ? 'on this day' : 'this week'}. Online requests show up here with a notification.</Empty>}
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day} className="a-book-day">
          <h2>
            {day}{' '}
            <span className="a-muted">{list.filter(r => !['cancelled', 'rejected'].includes(r.status)).reduce((a, r) => a + r.party_size, 0)} guests</span>
          </h2>
          <ul className="a-bookings">
            {list.map(r => (
              <li key={r.id} className={`a-book ${r.status}`}>
                <span className="a-book-time">{timeIST(r.starts_at)}</span>
                <span className="a-book-who">
                  <span>
                    <b>{r.name}</b>, {r.party_size} {r.party_size === 1 ? 'guest' : 'guests'}
                  </span>
                  <small>
                    <a href={`tel:${r.phone}`}>{r.phone}</a>, ref {r.ref}
                    {r.source === 'web' && ', booked online'}
                  </small>
                  {r.note && <small>“{r.note}”</small>}
                </span>
                <span className="a-book-table">
                  <input
                    className="a-input a-input-xs"
                    defaultValue={r.table_label ?? ''}
                    placeholder="Table"
                    aria-label={`Table for ${r.name}`}
                    onBlur={e => e.target.value !== (r.table_label ?? '') && call(`/api/admin/reservations/${r.id}`, { method: 'PATCH', json: { table: e.target.value || null } }).catch(err => toast(errText(err), 'bad'))}
                  />
                </span>
                <span className={`a-book-status ${r.status}`}>{LABEL[r.status]}</span>
                <span className="a-book-actions">
                  {r.status === 'pending' && (
                    <>
                      <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={() => set(r, 'confirmed')}>
                        Confirm
                      </button>
                      <button type="button" className="a-btn a-btn-sm" onClick={() => set(r, 'rejected')}>
                        Decline
                      </button>
                    </>
                  )}
                  {r.status === 'confirmed' && (
                    <>
                      <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={() => set(r, 'seated')}>
                        Seated
                      </button>
                      <button type="button" className="a-btn a-btn-sm" onClick={() => set(r, 'no_show')}>
                        No-show
                      </button>
                      <button type="button" className="a-link" onClick={() => set(r, 'cancelled')}>
                        Cancel
                      </button>
                    </>
                  )}
                  {r.status === 'seated' && (
                    <button type="button" className="a-btn a-btn-sm" onClick={() => set(r, 'completed')}>
                      Done
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {adding && <NewBooking onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}

function NewBooking({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const [f, setF] = useState({ name: '', phone: '', partySize: '2', date: todayIST(), time: '19:30', table: '', note: '' });
  const [error, setError] = useState('');
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    try {
      await call('/api/admin/reservations', {
        method: 'POST',
        json: { name: f.name, phone: f.phone, partySize: Number(f.partySize), date: f.date, time: f.time, table: f.table || undefined, note: f.note || undefined },
      });
      toast('Booking added');
      onSaved();
      onClose();
    } catch (err) {
      setError(errText(err));
    }
  };
  return (
    <Modal
      title="Add a booking"
      onClose={onClose}
      footer={
        <>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={() => save()}>
            Add booking
          </button>
        </>
      }
    >
      <form className="a-form" onSubmit={save}>
        <div className="a-row2">
          <label className="a-field">
            <span>Name</span>
            <input className="a-input" value={f.name} onChange={up('name')} data-autofocus />
          </label>
          <label className="a-field">
            <span>Mobile</span>
            <input className="a-input" inputMode="tel" value={f.phone} onChange={up('phone')} />
          </label>
        </div>
        <div className="a-row3">
          <label className="a-field">
            <span>Date</span>
            <input className="a-input" type="date" value={f.date} onChange={up('date')} />
          </label>
          <label className="a-field">
            <span>Time</span>
            <input className="a-input" type="time" step={900} value={f.time} onChange={up('time')} />
          </label>
          <label className="a-field">
            <span>Guests</span>
            <input className="a-input" inputMode="numeric" value={f.partySize} onChange={up('partySize')} />
          </label>
        </div>
        <div className="a-row2">
          <label className="a-field">
            <span>Table (optional)</span>
            <input className="a-input" value={f.table} onChange={up('table')} />
          </label>
          <label className="a-field">
            <span>Note (optional)</span>
            <input className="a-input" value={f.note} onChange={up('note')} />
          </label>
        </div>
        {error && <p className="a-error">{error}</p>}
      </form>
    </Modal>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { errText, useAuth } from './core';
import { Modal, PageHead, Toggle, toast } from './ui';

interface SettingsShape {
  gst_rate: number;
  hours: { open: string; close: string }[];
  ordering_enabled: boolean;
  takeaway_enabled: boolean;
  booking_enabled: boolean;
  cafe: { name: string; address: string; phone: string; email: string; gstin: string };
}
interface Table { id: number; label: string; seats: number; active: boolean }
interface Staff { id: number; name: string; email: string; role: 'owner' | 'manager' | 'staff'; active: boolean }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://lbscafe.com';

export default function Settings() {
  const { can } = useAuth();
  return (
    <div className="a-page">
      <PageHead title="Settings" />
      <div className="a-settings">
        <OrderingSettings />
        <TablesCard />
        {can('manager') && <StaffCard />}
        <PasswordCard />
      </div>
    </div>
  );
}

function OrderingSettings() {
  const { call, can } = useAuth();
  const [s, setS] = useState<SettingsShape | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<{ settings: SettingsShape }>('/api/admin/settings').then(r => setS(r.settings)).catch(e => toast(errText(e), 'bad'));
  }, [call]);
  if (!s) return <section className="a-card-panel"><p className="a-muted">Loading settings…</p></section>;
  const readOnly = !can('manager');

  const save = async (patch: Partial<SettingsShape>, msg = 'Saved') => {
    setBusy(true);
    try {
      const r = await call<{ settings: SettingsShape }>('/api/admin/settings', { method: 'PUT', json: patch });
      setS(r.settings);
      toast(msg);
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="a-card-panel">
        <h2>Online ordering and bookings</h2>
        <p className="a-muted">Switch these off on a packed night. The website tells guests to order with a server or call instead.</p>
        <Toggle id="set-ordering" checked={s.ordering_enabled} onChange={v => !readOnly && save({ ordering_enabled: v }, v ? 'QR ordering is on' : 'QR ordering paused')} label="QR table ordering" />
        <Toggle id="set-takeaway" checked={s.takeaway_enabled} onChange={v => !readOnly && save({ takeaway_enabled: v }, v ? 'Takeaway is on' : 'Takeaway paused')} label="Online takeaway orders" />
        <Toggle id="set-booking" checked={s.booking_enabled} onChange={v => !readOnly && save({ booking_enabled: v }, v ? 'Bookings are on' : 'Bookings paused')} label="Online table bookings" />
      </section>

      <section className="a-card-panel">
        <h2>Opening hours</h2>
        <form
          className="a-hours"
          onSubmit={e => {
            e.preventDefault();
            void save({ hours: s.hours }, 'Hours saved');
          }}
        >
          {[1, 2, 3, 4, 5, 6, 0].map(d => (
            <div key={d} className="a-hours-row">
              <span>{DAYS[d]}</span>
              <input className="a-input" type="time" value={s.hours[d].open} disabled={readOnly} onChange={e => setS({ ...s, hours: s.hours.map((h, i) => (i === d ? { ...h, open: e.target.value } : h)) })} aria-label={`${DAYS[d]} opens`} />
              <span>to</span>
              <input className="a-input" type="time" value={s.hours[d].close} disabled={readOnly} onChange={e => setS({ ...s, hours: s.hours.map((h, i) => (i === d ? { ...h, close: e.target.value } : h)) })} aria-label={`${DAYS[d]} closes`} />
            </div>
          ))}
          {!readOnly && (
            <button className="a-btn a-btn-primary" disabled={busy}>
              Save hours
            </button>
          )}
        </form>
      </section>

      <section className="a-card-panel">
        <h2>Bill details</h2>
        <form
          className="a-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save({ cafe: s.cafe, gst_rate: s.gst_rate }, 'Bill details saved');
          }}
        >
          <label className="a-field">
            <span>Cafe name</span>
            <input className="a-input" value={s.cafe.name} disabled={readOnly} onChange={e => setS({ ...s, cafe: { ...s.cafe, name: e.target.value } })} />
          </label>
          <label className="a-field">
            <span>Address</span>
            <input className="a-input" value={s.cafe.address} disabled={readOnly} onChange={e => setS({ ...s, cafe: { ...s.cafe, address: e.target.value } })} />
          </label>
          <div className="a-row2">
            <label className="a-field">
              <span>Phone</span>
              <input className="a-input" value={s.cafe.phone} disabled={readOnly} onChange={e => setS({ ...s, cafe: { ...s.cafe, phone: e.target.value } })} />
            </label>
            <label className="a-field">
              <span>Email</span>
              <input className="a-input" value={s.cafe.email} disabled={readOnly} onChange={e => setS({ ...s, cafe: { ...s.cafe, email: e.target.value } })} />
            </label>
          </div>
          <div className="a-row2">
            <label className="a-field">
              <span>GSTIN</span>
              <input className="a-input" value={s.cafe.gstin} maxLength={15} disabled={readOnly} onChange={e => setS({ ...s, cafe: { ...s.cafe, gstin: e.target.value.toUpperCase() } })} placeholder="15 characters" />
            </label>
            <label className="a-field">
              <span>GST rate (%)</span>
              <input className="a-input" inputMode="decimal" value={Math.round(s.gst_rate * 1000) / 10} disabled={readOnly} onChange={e => setS({ ...s, gst_rate: Number(e.target.value.replace(/[^\d.]/g, '')) / 100 })} />
            </label>
          </div>
          <p className="a-hint">The rate applies to new orders only. Bills already made keep the rate they were made with.</p>
          {!readOnly && (
            <button className="a-btn a-btn-primary" disabled={busy}>
              Save bill details
            </button>
          )}
        </form>
      </section>
    </>
  );
}

function TablesCard() {
  const { call, can } = useAuth();
  const [tables, setTables] = useState<Table[]>([]);
  const [label, setLabel] = useState('');
  const [printing, setPrinting] = useState(false);
  const load = useCallback(() => call<{ tables: Table[] }>('/api/admin/tables').then(r => setTables(r.tables)), [call]);
  useEffect(() => void load().catch(e => toast(errText(e), 'bad')), [load]);
  return (
    <section className="a-card-panel">
      <h2>Tables and QR codes</h2>
      <p className="a-muted">Each table's QR opens the menu with the table number filled in, so orders arrive marked with it.</p>
      <div className="a-table-chips">
        {tables.map(t => (
          <button
            key={t.id}
            type="button"
            className={t.active ? 'on' : ''}
            disabled={!can('manager')}
            title={t.active ? 'Tap to switch this table off' : 'Tap to switch this table on'}
            onClick={() => call(`/api/admin/tables/${t.id}`, { method: 'PATCH', json: { active: !t.active } }).then(load).catch(e => toast(errText(e), 'bad'))}
          >
            {t.label}
          </button>
        ))}
      </div>
      {can('manager') && (
        <form
          className="a-inline-form"
          onSubmit={e => {
            e.preventDefault();
            if (!label.trim()) return;
            call('/api/admin/tables', { method: 'POST', json: { label: label.trim() } })
              .then(() => (setLabel(''), load(), toast(`Table ${label.trim()} added`)))
              .catch(err => toast(errText(err), 'bad'));
          }}
        >
          <label className="a-field">
            <span>Add a table</span>
            <input className="a-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. 13 or Patio-1" maxLength={10} />
          </label>
          <button className="a-btn">Add</button>
        </form>
      )}
      <button type="button" className="a-btn a-btn-primary" onClick={() => setPrinting(true)}>
        Print QR stickers
      </button>
      {printing && <QrSheet tables={tables.filter(t => t.active)} onClose={() => setPrinting(false)} />}
    </section>
  );
}

function QrSheet({ tables, onClose }: { tables: Table[]; onClose: () => void }) {
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all(
      tables.map(async t => [t.label, await QRCode.toString(`${SITE_URL}/menu?table=${encodeURIComponent(t.label)}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })] as const),
    ).then(pairs => setSvgs(Object.fromEntries(pairs)));
  }, [tables]);

  const print = () => {
    const cards = tables
      .map(t => `<div class="c"><div class="q">${svgs[t.label] ?? ''}</div><b>Table ${t.label}</b><span>Scan to see the menu and order</span></div>`)
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>LB's table QR codes</title><style>
      @page{size:A4;margin:10mm} body{font-family:Arial,sans-serif;margin:0} .g{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}
      .c{border:2px solid #000;border-radius:6mm;padding:5mm;text-align:center;break-inside:avoid;background:#D0FF00}
      .q{background:#fff;padding:2mm;border-radius:3mm} .q svg{width:100%;height:auto;display:block}
      b{display:block;font-size:20pt;margin-top:3mm} span{font-size:9pt}
    </style></head><body><div class="g">${cards}</div></body></html>`;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    f.contentDocument!.open();
    f.contentDocument!.write(html);
    f.contentDocument!.close();
    setTimeout(() => {
      f.contentWindow!.print();
      setTimeout(() => f.remove(), 1000);
    }, 300);
  };

  return (
    <Modal
      title="Table QR stickers"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="a-muted">Links point to {SITE_URL}/menu?table=…</span>
          <span className="a-spacer" />
          <button type="button" className="a-btn a-btn-primary" onClick={print} disabled={Object.keys(svgs).length < tables.length}>
            Print on A4
          </button>
        </>
      }
    >
      <div className="a-qr-grid">
        {tables.map(t => (
          <div key={t.id} className="a-qr">
            <div dangerouslySetInnerHTML={{ __html: svgs[t.label] ?? '' }} />
            <b>Table {t.label}</b>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function StaffCard() {
  const { call, can, me } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'staff' as Staff['role'] });
  const load = useCallback(() => call<{ staff: Staff[] }>('/api/admin/staff').then(r => setStaff(r.staff)), [call]);
  useEffect(() => void load().catch(() => {}), [load]);
  const owner = can('owner');
  const patch = (s: Staff, body: object, msg: string) =>
    call(`/api/admin/staff/${s.id}`, { method: 'PATCH', json: body })
      .then(() => (load(), toast(msg)))
      .catch(e => toast(errText(e), 'bad'));
  return (
    <section className="a-card-panel">
      <h2>Staff logins</h2>
      <p className="a-muted">Staff can run orders and bookings and mark items sold out. Managers can also give discounts, cancel orders, edit the menu and change settings. Only owners add people.</p>
      <ul className="a-staff">
        {staff.map(s => (
          <li key={s.id} className={s.active ? '' : 'off'}>
            <span>
              <b>{s.name}</b>
              <small>{s.email}</small>
            </span>
            {owner && s.id !== me?.id ? (
              <select className="a-input a-input-xs" value={s.role} onChange={e => patch(s, { role: e.target.value }, `${s.name} is now ${e.target.value}`)} aria-label={`Role for ${s.name}`}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            ) : (
              <span className="a-tag">{s.role}</span>
            )}
            {owner && s.id !== me?.id && (
              <button type="button" className="a-link" onClick={() => patch(s, { active: !s.active }, s.active ? `${s.name} can no longer sign in` : `${s.name} can sign in again`)}>
                {s.active ? 'Switch off' : 'Switch on'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <button type="button" className="a-btn" onClick={() => setAdding(true)}>
          Add a login
        </button>
      )}
      {adding && (
        <Modal
          title="Add a login"
          onClose={() => setAdding(false)}
          footer={
            <>
              <span className="a-spacer" />
              <button
                type="button"
                className="a-btn a-btn-primary"
                onClick={() =>
                  call('/api/admin/staff', { method: 'POST', json: f })
                    .then(() => (load(), setAdding(false), setF({ name: '', email: '', password: '', role: 'staff' }), toast(`${f.name} can now sign in`)))
                    .catch(e => toast(errText(e), 'bad'))
                }
              >
                Add login
              </button>
            </>
          }
        >
          <div className="a-form">
            <label className="a-field">
              <span>Name</span>
              <input className="a-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} data-autofocus />
            </label>
            <label className="a-field">
              <span>Email</span>
              <input className="a-input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
            </label>
            <label className="a-field">
              <span>Temporary password (8+ characters)</span>
              <input className="a-input" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
            </label>
            <label className="a-field">
              <span>Role</span>
              <select className="a-input" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Staff['role'] })}>
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            </label>
          </div>
        </Modal>
      )}
    </section>
  );
}

function PasswordCard() {
  const { call } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  return (
    <section className="a-card-panel">
      <h2>Your password</h2>
      <form
        className="a-form"
        onSubmit={e => {
          e.preventDefault();
          call('/api/auth/password', { method: 'POST', json: { current: cur, next } })
            .then(() => (setCur(''), setNext(''), toast('Password changed')))
            .catch(err => toast(errText(err), 'bad'));
        }}
      >
        <label className="a-field">
          <span>Current password</span>
          <input className="a-input" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} />
        </label>
        <label className="a-field">
          <span>New password (8+ characters)</span>
          <input className="a-input" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
        </label>
        <button className="a-btn">Change password</button>
      </form>
    </section>
  );
}

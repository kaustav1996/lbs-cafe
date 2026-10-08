import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { errText, ROLE_LABEL, useAuth, useOnEvent, type Role } from './core';
import { Modal, PageHead, Toggle, toast } from './ui';
import MusicCard from './MusicCard';

interface SettingsShape {
  gst_rate: number;
  hours: { open: string; close: string }[];
  ordering_enabled: boolean;
  takeaway_enabled: boolean;
  booking_enabled: boolean;
  cafe: { name: string; address: string; phone: string; email: string; gstin: string };
}
interface Table { id: number; label: string; seats: number; active: boolean; otp: string; sitting: number }
interface Staff { id: number; name: string; email: string; role: Role; active: boolean }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined) ?? 'https://lbscafe.com';

export default function Settings() {
  const { can } = useAuth();
  return (
    <div className="a-page">
      <PageHead title="Settings" />
      <div className="a-settings">
        <OrderingSettings />
        <LoyaltyCard />
        <LicencesCard />
        <MusicCard />
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

interface Loyalty {
  reward_stamps: number;
  reward_percent: number;
  reward_cap_paise: number;
  welcome_percent: number;
  welcome_limit: number;
  google_review_url: string;
  instagram_url: string;
  reminder_days: number;
  reminder_cap: number;
  reminder_hour: number;
}

/** LB's card rules. Changes apply to bills worked out from now on. */
function LoyaltyCard() {
  const { call, can } = useAuth();
  const [l, setL] = useState<Loyalty | null>(null);
  const [used, setUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<{ settings: { loyalty: Loyalty }; welcomesUsed: number }>('/api/admin/settings')
      .then(r => (setL(r.settings.loyalty), setUsed(r.welcomesUsed)))
      .catch(e => toast(errText(e), 'bad'));
  }, [call]);
  if (!l) return null;
  const readOnly = !can('manager');
  const num = (k: keyof Loyalty, label: string, opts: { min?: number; max?: number; rupees?: boolean } = {}) => (
    <label className="a-field">
      <span>{label}</span>
      <input
        className="a-input num"
        type="number"
        min={opts.min ?? 0}
        max={opts.max}
        disabled={readOnly}
        value={opts.rupees ? Number(l[k]) / 100 : Number(l[k])}
        onChange={e => setL({ ...l, [k]: opts.rupees ? Math.round(Number(e.target.value) * 100) : Number(e.target.value) })}
      />
    </label>
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await call<{ settings: { loyalty: Loyalty } }>('/api/admin/settings', { method: 'PUT', json: { loyalty: l } });
      if (r.settings.loyalty) setL(r.settings.loyalty);
      toast('LB’s card rules saved');
    } catch (err) {
      toast(errText(err), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="a-card-panel">
      <h2>LB’s card</h2>
      <p className="a-muted">
        A stamp for each paid bill (one a day), up to {l.reward_stamps}; the next visit gets {l.reward_percent}% off, at most ₹{(l.reward_cap_paise / 100).toLocaleString('en-IN')}.
        New card holders get {l.welcome_percent}% off their first visit: {used} of {l.welcome_limit} welcome offers used.
      </p>
      <form className="a-form" onSubmit={save}>
        <div className="a-row2">
          {num('reward_stamps', 'Stamps for a reward', { min: 1, max: 20 })}
          {num('reward_percent', 'Reward, % off', { min: 1, max: 100 })}
        </div>
        <div className="a-row2">
          {num('reward_cap_paise', 'Reward at most (₹)', { rupees: true })}
          {num('welcome_percent', 'Welcome, % off', { max: 100 })}
        </div>
        <div className="a-row2">
          {num('welcome_limit', 'Welcome offers in total')}
          {num('reminder_days', 'Reminder after (days away)', { min: 1, max: 365 })}
        </div>
        <label className="a-field">
          <span>Google review link</span>
          <input className="a-input" type="url" disabled={readOnly} value={l.google_review_url} onChange={e => setL({ ...l, google_review_url: e.target.value.trim() })} placeholder="https://g.page/r/…/review" />
        </label>
        <label className="a-field">
          <span>Instagram link</span>
          <input className="a-input" type="url" disabled={readOnly} value={l.instagram_url} onChange={e => setL({ ...l, instagram_url: e.target.value.trim() })} placeholder="https://instagram.com/…" />
        </label>
        <p className="a-hint">The card page links to these. Nothing on the card depends on reviews or follows.</p>
        {!readOnly && (
          <button className="a-btn a-btn-primary" disabled={busy}>
            Save card rules
          </button>
        )}
      </form>
    </section>
  );
}

interface LicenceFile { key: string; name: string; type: string; size: number }
interface Licence { id: string; name: string; number: string; validUntil?: string | null; file?: LicenceFile | null }
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Licences shown on the public /licences page. The GSTIN there comes from Bill details. */
function LicencesCard() {
  const { call, can } = useAuth();
  const [list, setList] = useState<Licence[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const readOnly = !can('manager');
  useEffect(() => {
    call<{ settings: { licences?: Licence[] } }>('/api/admin/settings')
      .then(r => setList(r.settings.licences ?? []))
      .catch(e => toast(errText(e), 'bad'));
  }, [call]);
  if (!list) return null;

  const edit = (id: string, patch: Partial<Licence>) => setList(list.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const upload = async (id: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    setUploading(id);
    try {
      const r = await call<{ file: LicenceFile }>('/api/admin/files', { method: 'POST', body: form });
      edit(id, { file: r.file });
      toast('Document uploaded. Save to publish it.');
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setUploading(null);
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const clean = list.map(l => ({ ...l, validUntil: l.validUntil || null }));
      const r = await call<{ settings: { licences?: Licence[] } }>('/api/admin/settings', { method: 'PUT', json: { licences: clean } });
      setList(r.settings.licences ?? []);
      toast('Licences saved');
    } catch (err) {
      toast(errText(err), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="a-card-panel">
      <h2>Licences</h2>
      <p className="a-muted">
        Shown on <a href={`${SITE_URL}/licences`} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}/licences</a> with the GSTIN from Bill details.
        Documents can be a PDF or a JPG, PNG or WebP image, up to 10 MB. Anyone can open them, so upload only what's meant to be public.
      </p>
      <form className="a-form" onSubmit={save}>
        {list.length === 0 && <p className="a-muted">No licences yet.</p>}
        {list.map(l => (
          <fieldset key={l.id} className="a-licence" disabled={readOnly}>
            <div className="a-row2">
              <label className="a-field">
                <span>Name</span>
                <input className="a-input" value={l.name} maxLength={60} required placeholder="FSSAI licence" onChange={e => edit(l.id, { name: e.target.value })} />
              </label>
              <label className="a-field">
                <span>Number</span>
                <input className="a-input" value={l.number} maxLength={60} onChange={e => edit(l.id, { number: e.target.value })} />
              </label>
            </div>
            <div className="a-row2">
              <label className="a-field">
                <span>Valid until (optional)</span>
                <input className="a-input" type="date" value={l.validUntil ?? ''} onChange={e => edit(l.id, { validUntil: e.target.value || null })} />
              </label>
              <div className="a-field">
                <span>Document</span>
                {l.file ? (
                  <p className="a-licence-file">
                    <a href={`/files/${l.file.key}`} target="_blank" rel="noreferrer">{l.file.name}</a> <small className="a-muted">{kb(l.file.size)}</small>{' '}
                    {!readOnly && (
                      <button type="button" className="a-btn a-btn-sm" onClick={() => edit(l.id, { file: null })}>
                        Remove
                      </button>
                    )}
                  </p>
                ) : (
                  <input
                    className="a-input"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={readOnly || uploading === l.id}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) void upload(l.id, f);
                      e.target.value = '';
                    }}
                  />
                )}
                {uploading === l.id && <small className="a-muted">Uploading…</small>}
              </div>
            </div>
            {!readOnly && (
              <button type="button" className="a-btn a-btn-danger a-btn-sm" onClick={() => setList(list.filter(x => x.id !== l.id))}>
                Remove this licence
              </button>
            )}
          </fieldset>
        ))}
        {!readOnly && (
          <div className="a-actions">
            <button type="button" className="a-btn" onClick={() => setList([...list, { id: newId(), name: '', number: '', validUntil: null, file: null }])}>
              Add a licence
            </button>
            <button className="a-btn a-btn-primary" disabled={busy || uploading !== null}>
              Save licences
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

function TablesCard() {
  const { call, can } = useAuth();
  const [tables, setTables] = useState<Table[]>([]);
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState('4');
  const [printing, setPrinting] = useState(false);
  const [qrFor, setQrFor] = useState<Table | null>(null);
  const manager = can('manager');
  const load = useCallback(() => call<{ tables: Table[] }>('/api/admin/tables').then(r => setTables(r.tables)), [call]);
  useEffect(() => void load().catch(e => toast(errText(e), 'bad')), [load]);
  // Codes change when a table frees up; keep every open screen current.
  useOnEvent(['table.updated'], () => void load().catch(() => {}));

  const patch = (t: Table, json: Partial<Table>, msg: string) =>
    call(`/api/admin/tables/${t.id}`, { method: 'PATCH', json }).then(() => (load(), toast(msg))).catch(e => toast(errText(e), 'bad'));
  const newCode = (t: Table) =>
    call(`/api/admin/tables/${t.id}/new-code`, { method: 'POST' }).then(() => (load(), toast(`Table ${t.label} has a new code`))).catch(e => toast(errText(e), 'bad'));

  return (
    <section className="a-card-panel">
      <h2>Tables, codes and QR</h2>
      <p className="a-muted">
        Each table's QR opens the menu with the table filled in. The first time a phone orders at a table, the guest asks a server for
        that table's code. Codes change on their own once a table's orders are closed and paid. Tap New code if a group leaves without settling.
      </p>
      <ul className="a-tablelist">
        {tables.map(t => (
          <li key={t.id} className={t.active ? '' : 'off'}>
            <b className="a-tablelist-label">Table {t.label}</b>
            <span className="a-tablelist-code" aria-label={`Code for table ${t.label}`}>{t.active ? t.otp : 'Off'}</span>
            <label className="a-tablelist-seats">
              <span>Seats</span>
              <input
                className="a-input"
                type="number"
                min={1}
                max={30}
                defaultValue={t.seats}
                disabled={!manager}
                onBlur={e => {
                  const n = Number(e.target.value);
                  if (n !== t.seats && n >= 1 && n <= 30) void patch(t, { seats: n }, `Table ${t.label} seats ${n}`);
                }}
              />
            </label>
            <span className="a-tablelist-actions">
              {t.active && (
                <button type="button" className="a-btn a-btn-sm" onClick={() => setQrFor(t)}>
                  QR
                </button>
              )}
              {t.active && (
                <button type="button" className="a-btn a-btn-sm" onClick={() => void newCode(t)}>
                  New code
                </button>
              )}
              {manager && (
                <button type="button" className="a-btn a-btn-sm" onClick={() => void patch(t, { active: !t.active }, t.active ? `Table ${t.label} switched off` : `Table ${t.label} switched on`)}>
                  {t.active ? 'Switch off' : 'Switch on'}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {manager && (
        <form
          className="a-inline-form"
          onSubmit={e => {
            e.preventDefault();
            const n = Number(seats);
            if (!label.trim()) return;
            call('/api/admin/tables', { method: 'POST', json: { label: label.trim(), seats: n >= 1 && n <= 30 ? n : 4 } })
              .then(() => (setLabel(''), load(), toast(`Table ${label.trim()} added`)))
              .catch(err => toast(errText(err), 'bad'));
          }}
        >
          <label className="a-field">
            <span>Add a table</span>
            <input className="a-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. 6 or Patio-1" maxLength={10} />
          </label>
          <label className="a-field a-field-narrow">
            <span>Seats</span>
            <input className="a-input" type="number" min={1} max={30} value={seats} onChange={e => setSeats(e.target.value)} />
          </label>
          <button className="a-btn">Add</button>
        </form>
      )}
      <button type="button" className="a-btn a-btn-primary" onClick={() => setPrinting(true)}>
        Print QR stickers for all tables
      </button>
      {printing && <QrSheet tables={tables.filter(t => t.active)} onClose={() => setPrinting(false)} />}
      {qrFor && <TableQr table={qrFor} onClose={() => setQrFor(null)} />}
    </section>
  );
}

const tableLink = (label: string) => `${SITE_URL}/menu?table=${encodeURIComponent(label)}`;
const tableSvg = (label: string) => QRCode.toString(tableLink(label), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

/** Prints table stickers (lime card, QR, table number) on A4, three across, in a hidden frame. */
function printStickers(tables: Table[], svgs: Record<string, string>) {
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
}

/** One table's QR: show it, download it as a PNG, copy its link, or print its sticker. */
function TableQr({ table, onClose }: { table: Table; onClose: () => void }) {
  const [svg, setSvg] = useState('');
  useEffect(() => void tableSvg(table.label).then(setSvg), [table.label]);
  const link = tableLink(table.label);
  const download = async () => {
    const url = await QRCode.toDataURL(link, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `lbs-table-${table.label}-qr.png`;
    a.click();
  };
  const copy = () =>
    navigator.clipboard.writeText(link).then(
      () => toast('Link copied'),
      () => toast('Couldn’t copy. Select the link and copy it instead.', 'bad'),
    );
  return (
    <Modal
      title={`Table ${table.label} QR`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="a-btn" onClick={copy}>
            Copy link
          </button>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={download}>
            Download PNG
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={() => printStickers([table], { [table.label]: svg })} disabled={!svg}>
            Print sticker
          </button>
        </>
      }
    >
      <div className="a-qr-one">
        <div className="a-qr-big" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="a-muted">
          Scanning it opens <span className="a-qr-link">{link}</span> with table {table.label} filled in. Guests still need the table’s code
          the first time they order.
        </p>
      </div>
    </Modal>
  );
}

function QrSheet({ tables, onClose }: { tables: Table[]; onClose: () => void }) {
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all(
      tables.map(async t => [t.label, await tableSvg(t.label)] as const),
    ).then(pairs => setSvgs(Object.fromEntries(pairs)));
  }, [tables]);

  const print = () => printStickers(tables, svgs);

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
              <select className="a-input a-input-xs" value={s.role} onChange={e => patch(s, { role: e.target.value }, `${s.name} is now ${ROLE_LABEL[e.target.value as Role].toLowerCase()}`)} aria-label={`Role for ${s.name}`}>
                <option value="chef">Chef (kitchen screen only)</option>
                <option value="staff">Server (serves, bills, bookings)</option>
                <option value="server_kitchen">Server and kitchen (both, for quiet days)</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
            ) : (
              <span className="a-tag">{ROLE_LABEL[s.role]}</span>
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
                <option value="chef">Chef (kitchen screen only)</option>
                <option value="staff">Server (serves, bills, bookings)</option>
                <option value="server_kitchen">Server and kitchen (both, for quiet days)</option>
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

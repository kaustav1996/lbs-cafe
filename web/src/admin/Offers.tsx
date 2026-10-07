import { useCallback, useEffect, useState } from 'react';
import { errText, rs, todayIST, useAuth } from './core';
import { Empty, Modal, PageHead, Toggle, toast } from './ui';
import { useAdminMenu } from './picker';

interface Offer {
  id: number;
  name: string;
  percent: number;
  scope: 'bill' | 'sections';
  audience: 'everyone' | 'members';
  startsOn: string;
  endsOn: string;
  paused: boolean;
  sections: number[];
  status: 'scheduled' | 'running' | 'paused' | 'ended';
  bills: number;
  given: number;
}
type Draft = Omit<Offer, 'id' | 'status' | 'bills' | 'given'>;

const STATUS = { running: 'Running', scheduled: 'Scheduled', paused: 'Paused', ended: 'Ended' };
const longDate = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** Campaign offers: a percentage off the whole bill or chosen sections, for some dates. One discount per bill applies. */
export default function Offers() {
  const { call, can } = useAuth();
  const { menu } = useAdminMenu('all');
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);
  const load = useCallback(
    () => call<{ offers: Offer[] }>('/api/admin/offers').then(r => setOffers(r.offers)).catch(e => toast(errText(e), 'bad')),
    [call],
  );
  useEffect(() => void load(), [load]);
  const sectionName = (id: number) => menu?.find(c => c.id === id)?.name ?? 'a section';

  return (
    <div className="a-page">
      <PageHead title="Offers">
        {can('manager') && (
          <button type="button" className="a-btn a-btn-primary" onClick={() => setEditing('new')}>
            New offer
          </button>
        )}
      </PageHead>
      <p className="a-muted">
        Each bill gets one discount: whichever saves the guest most out of a running offer, the welcome offer and the 5th-visit reward.
        Changing an offer updates bills that haven’t started being paid.
      </p>
      {offers && offers.length === 0 && <Empty>No offers yet.</Empty>}
      {offers && offers.length > 0 && (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Offer</th>
                <th>On</th>
                <th>For</th>
                <th>Dates</th>
                <th>Status</th>
                <th className="r">Bills</th>
                <th className="r">Given</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offers.map(o => (
                <tr key={o.id}>
                  <td>
                    <b>{o.name}</b> {o.percent}% off
                  </td>
                  <td>{o.scope === 'bill' ? 'Whole bill' : o.sections.map(sectionName).join(', ')}</td>
                  <td>{o.audience === 'everyone' ? 'Everyone' : 'Card members'}</td>
                  <td>{o.startsOn === o.endsOn ? longDate(o.startsOn) : `${longDate(o.startsOn)} to ${longDate(o.endsOn)}`}</td>
                  <td>
                    <span className={`a-offer-status ${o.status}`}>{STATUS[o.status]}</span>
                  </td>
                  <td className="r num">{o.bills}</td>
                  <td className="r num">{rs(o.given)}</td>
                  <td className="r">
                    {can('manager') && (
                      <button type="button" className="a-link" onClick={() => setEditing(o)}>
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && menu && (
        <OfferEditor
          offer={editing === 'new' ? null : editing}
          sections={menu.map(c => ({ id: c.id, name: c.name }))}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), void load())}
        />
      )}
    </div>
  );
}

function OfferEditor({ offer, sections, onClose, onSaved }: { offer: Offer | null; sections: { id: number; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const [d, setD] = useState<Draft>(
    offer
      ? { name: offer.name, percent: offer.percent, scope: offer.scope, audience: offer.audience, startsOn: offer.startsOn, endsOn: offer.endsOn, paused: offer.paused, sections: offer.sections }
      : { name: '', percent: 10, scope: 'bill', audience: 'everyone', startsOn: todayIST(), endsOn: todayIST(6), paused: false, sections: [] },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));
  const save = async () => {
    setError('');
    if (!d.name.trim()) return setError('Give the offer a name, for example Puja special.');
    if (d.scope === 'sections' && !d.sections.length) return setError('Pick at least one section, or choose the whole bill.');
    if (d.endsOn < d.startsOn) return setError('The end date is before the start date.');
    setBusy(true);
    try {
      const json = { ...d, name: d.name.trim() };
      if (offer) await call(`/api/admin/offers/${offer.id}`, { method: 'PATCH', json });
      else await call('/api/admin/offers', { method: 'POST', json });
      toast(offer ? 'Offer saved' : 'Offer created');
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={offer ? `Edit ${offer.name}` : 'New offer'}
      onClose={onClose}
      footer={
        <>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={save} disabled={busy}>
            {offer ? 'Save offer' : 'Create offer'}
          </button>
        </>
      }
    >
      <div className="a-form">
        <div className="a-row2">
          <label className="a-field">
            <span>Name</span>
            <input className="a-input" value={d.name} maxLength={40} onChange={e => set({ name: e.target.value })} placeholder="Puja special" data-autofocus />
          </label>
          <label className="a-field">
            <span>Percent off</span>
            <input className="a-input num" type="number" min={1} max={90} value={d.percent} onChange={e => set({ percent: Number(e.target.value) })} />
          </label>
        </div>
        <div className="a-seg">
          <button type="button" className={d.scope === 'bill' ? 'on' : ''} onClick={() => set({ scope: 'bill' })}>
            Whole bill
          </button>
          <button type="button" className={d.scope === 'sections' ? 'on' : ''} onClick={() => set({ scope: 'sections' })}>
            Chosen sections
          </button>
        </div>
        {d.scope === 'sections' && (
          <div className="a-chips">
            {sections.map(s => (
              <button
                key={s.id}
                type="button"
                className={d.sections.includes(s.id) ? 'on' : ''}
                onClick={() => set({ sections: d.sections.includes(s.id) ? d.sections.filter(x => x !== s.id) : [...d.sections, s.id] })}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="a-seg">
          <button type="button" className={d.audience === 'everyone' ? 'on' : ''} onClick={() => set({ audience: 'everyone' })}>
            Everyone
          </button>
          <button type="button" className={d.audience === 'members' ? 'on' : ''} onClick={() => set({ audience: 'members' })}>
            LB’s card members only
          </button>
        </div>
        <div className="a-row2">
          <label className="a-field">
            <span>From</span>
            <input className="a-input" type="date" value={d.startsOn} onChange={e => set({ startsOn: e.target.value })} />
          </label>
          <label className="a-field">
            <span>Until (inclusive)</span>
            <input className="a-input" type="date" value={d.endsOn} onChange={e => set({ endsOn: e.target.value })} />
          </label>
        </div>
        <Toggle id="offer-paused" checked={d.paused} onChange={v => set({ paused: v })} label="Paused" />
        {error && <p className="a-error">{error}</p>}
      </div>
    </Modal>
  );
}

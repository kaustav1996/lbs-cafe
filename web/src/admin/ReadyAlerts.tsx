import { useState } from 'react';
import { errText, useAuth, useOnEvent, useStream } from './core';
import { toast } from './ui';

interface Ready {
  id: number;
  number: number;
  table: string | null;
  source: string;
}

const where = (r: Ready) => (r.table ? `Serve it to table ${r.table}.` : r.source === 'takeaway' ? 'Hand it over at the counter.' : 'Serve it at the counter.');

/**
 * Tells the floor staff when the kitchen marks an order ready: a chime, a system notification if this screen is in
 * the background, and a banner on every admin screen that stays until someone serves it.
 */
export default function ReadyAlerts() {
  const { call } = useAuth();
  const { chime, notify } = useStream();
  const [ready, setReady] = useState<Ready[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useOnEvent(['order.updated'], e => {
    const r = { id: e.orderId as number, number: e.number as number, table: (e.table as string | null) ?? null, source: String(e.source ?? '') };
    if (e.status === 'ready') {
      setReady(xs => (xs.some(x => x.id === r.id) ? xs : [...xs, r]));
      chime('ready');
      notify(`Order #${r.number} is ready`, where(r));
    } else {
      setReady(xs => xs.filter(x => x.id !== r.id));
    }
  });

  const served = async (r: Ready) => {
    setBusy(r.id);
    try {
      await call(`/api/admin/orders/${r.id}`, { method: 'PATCH', json: { status: 'served' } });
      setReady(xs => xs.filter(x => x.id !== r.id));
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (!ready.length) return null;
  return (
    <section className="a-ready" aria-label="Orders ready to serve" aria-live="assertive">
      {ready.map(r => (
        <div key={r.id} className="a-ready-row">
          <p>
            <b>Order #{r.number} is ready.</b> {where(r)}
          </p>
          <div className="a-ready-actions">
            <button type="button" className="a-btn a-btn-primary" disabled={busy === r.id} onClick={() => served(r)}>
              {r.source === 'takeaway' ? 'Picked up' : 'Mark served'}
            </button>
            <button type="button" className="a-btn" onClick={() => setReady(xs => xs.filter(x => x.id !== r.id))}>
              Hide
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { errText, rs, useAuth } from './core';
import { Modal, toast } from './ui';
import type { AItem } from './picker';

export interface MenuSummary { id: number; name: string; live: boolean; items: number }
export interface MenuDetail { id: number; name: string; live: boolean; itemIds: number[]; prices: Record<string, number> }

/** The menus list plus the one being edited. Starts on the live menu. */
export function useMenus() {
  const { call } = useAuth();
  const [menus, setMenus] = useState<MenuSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<MenuDetail | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await call<{ menus: MenuSummary[] }>('/api/admin/menus');
      setMenus(r.menus);
      setSelected(s => (s && r.menus.some(m => m.id === s) ? s : (r.menus.find(m => m.live) ?? r.menus[0])?.id ?? null));
    } catch (e) {
      toast(errText(e), 'bad');
    }
  }, [call]);

  const reloadDetail = useCallback(async () => {
    if (!selected) return setDetail(null);
    try {
      setDetail(await call<MenuDetail>(`/api/admin/menus/${selected}`));
    } catch (e) {
      toast(errText(e), 'bad');
    }
  }, [call, selected]);

  useEffect(() => void reload(), [reload]);
  useEffect(() => void reloadDetail(), [reloadDetail]);
  const refresh = useCallback(() => Promise.all([reload(), reloadDetail()]).then(() => {}), [reload, reloadDetail]);
  return { menus, selected, setSelected, detail, setDetail, refresh };
}

type Dialog = 'new' | 'rename' | 'live' | 'delete' | null;

/** Picker and actions for menus, above the dish list. */
export function MenuBar({ menus, selected, onSelect, onChanged }: { menus: MenuSummary[]; selected: number | null; onSelect: (id: number) => void; onChanged: () => void }) {
  const { call, can } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = menus.find(m => m.id === selected);
  const manager = can('manager');

  const open = (d: Dialog) => {
    setError('');
    setName(d === 'rename' ? current?.name ?? '' : '');
    setCopyFrom(menus.find(m => m.live)?.id ?? '');
    setDialog(d);
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      toast(msg);
      setDialog(null);
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const dialogs: Record<Exclude<Dialog, null>, { title: string; action: string; danger?: boolean; go: () => void }> = {
    new: {
      title: 'New menu',
      action: 'Create menu',
      go: () =>
        name.trim()
          ? void run(async () => {
          const r = await call<{ menu: MenuSummary }>('/api/admin/menus', { method: 'POST', json: { name: name.trim(), copyFrom: copyFrom || undefined } });
          onSelect(r.menu.id);
        }, `${name.trim()} created`)
          : setError('Give the menu a name, for example Durga Puja.'),
    },
    rename: {
      title: `Rename ${current?.name ?? ''}`,
      action: 'Save name',
      go: () =>
        name.trim()
          ? void run(() => call(`/api/admin/menus/${selected}`, { method: 'PATCH', json: { name: name.trim() } }), 'Menu renamed')
          : setError('Give the menu a name.'),
    },
    live: {
      title: `Make ${current?.name ?? ''} live?`,
      action: 'Make live',
      go: () => void run(() => call(`/api/admin/menus/${selected}`, { method: 'PATCH', json: { live: true } }), `${current?.name} is live`),
    },
    delete: {
      title: `Delete ${current?.name ?? ''}?`,
      action: 'Delete menu',
      danger: true,
      go: () =>
        void run(async () => {
          await call(`/api/admin/menus/${selected}`, { method: 'DELETE' });
          onSelect(menus.find(m => m.live)?.id ?? menus[0].id);
        }, 'Menu deleted'),
    },
  };
  const d = dialog && dialogs[dialog];

  return (
    <div className="a-menubar">
      <label className="a-field">
        <span>Menu</span>
        <select className="a-input" value={selected ?? ''} onChange={e => onSelect(Number(e.target.value))}>
          {menus.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.live ? ' (live)' : ''}, {m.items} dishes
            </option>
          ))}
        </select>
      </label>
      <span className={current?.live ? 'a-menubar-state live' : 'a-menubar-state'}>
        {current?.live ? 'Live. Guests see this menu.' : 'Not live. Guests don’t see this menu yet.'}
      </span>
      {manager && (
        <span className="a-menubar-actions">
          {current && !current.live && (
            <button type="button" className="a-btn a-btn-primary a-btn-sm" onClick={() => open('live')}>
              Make live
            </button>
          )}
          <button type="button" className="a-btn a-btn-sm" onClick={() => open('new')}>
            New menu
          </button>
          {current && (
            <button type="button" className="a-btn a-btn-sm" onClick={() => open('rename')}>
              Rename
            </button>
          )}
          {current && !current.live && (
            <button type="button" className="a-btn a-btn-danger a-btn-sm" onClick={() => open('delete')}>
              Delete
            </button>
          )}
        </span>
      )}
      {d && (
        <Modal
          title={d.title}
          onClose={() => setDialog(null)}
          footer={
            <>
              <span className="a-spacer" />
              <button type="button" className="a-btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className={`a-btn ${d.danger ? 'a-btn-danger' : 'a-btn-primary'}`} onClick={d.go} disabled={busy}>
                {d.action}
              </button>
            </>
          }
        >
          <div className="a-form">
            {(dialog === 'new' || dialog === 'rename') && (
              <label className="a-field">
                <span>Name</span>
                <input className="a-input" value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Durga Puja" data-autofocus />
              </label>
            )}
            {dialog === 'new' && (
              <label className="a-field">
                <span>Start from</span>
                <select className="a-input" value={copyFrom} onChange={e => setCopyFrom(e.target.value ? Number(e.target.value) : '')}>
                  {menus.map(m => (
                    <option key={m.id} value={m.id}>
                      A copy of {m.name} ({m.items} dishes, its prices)
                    </option>
                  ))}
                  <option value="">An empty menu</option>
                </select>
              </label>
            )}
            {dialog === 'live' && (
              <p>Guests scanning a QR code see {current?.name} straight away, at its prices. Orders already placed keep their prices.</p>
            )}
            {dialog === 'delete' && <p>This removes the menu and its prices. Dishes stay in the master list and on other menus.</p>}
            {error && <p className="a-error">{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Per-menu prices for one dish. Empty means the dish's normal price. */
export function MenuPriceEditor({ menu, item, onClose, onSaved }: { menu: MenuDetail; item: AItem; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const opts = item.options.filter(o => o.active);
  const [vals, setVals] = useState<Record<number, string>>(
    Object.fromEntries(opts.map(o => [o.id, menu.prices[o.id] !== undefined ? String(menu.prices[o.id] / 100) : ''])),
  );
  const [error, setError] = useState('');
  const save = async () => {
    const prices: Record<string, number | null> = {};
    for (const o of opts) {
      const v = vals[o.id].trim();
      if (!v) prices[o.id] = null;
      else {
        const p = Math.round(Number(v) * 100);
        if (!Number.isFinite(p) || p <= 0) return setError('Every price needs to be more than ₹0, or empty for the normal price.');
        prices[o.id] = p;
      }
    }
    try {
      await call(`/api/admin/menus/${menu.id}/items/${item.id}`, { method: 'PUT', json: { on: true, prices } });
      toast(`${item.name} prices saved on ${menu.name}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Modal
      title={`${item.name} on ${menu.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={save}>
            Save prices
          </button>
        </>
      }
    >
      <div className="a-form">
        <p className="a-muted">Leave a price empty to use the normal price. This only changes {menu.name}.</p>
        {opts.map((o, i) => (
          <label key={o.id} className="a-field">
            <span>
              {o.label || 'Price'} (normally {rs(o.price_paise)})
            </span>
            <input
              className="a-input num"
              inputMode="decimal"
              placeholder={String(o.price_paise / 100)}
              value={vals[o.id]}
              onChange={e => setVals(v => ({ ...v, [o.id]: e.target.value.replace(/[^\d.]/g, '') }))}
              data-autofocus={i === 0 ? true : undefined}
            />
          </label>
        ))}
        {error && <p className="a-error">{error}</p>}
      </div>
    </Modal>
  );
}

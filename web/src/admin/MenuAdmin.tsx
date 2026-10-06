import { useState } from 'react';
import { errText, rs, useAuth, useOnEvent } from './core';
import { DietDot, Modal, PageHead, Toggle, toast } from './ui';
import { useAdminMenu, type ACategory, type AItem } from './picker';

export default function MenuAdmin() {
  const { call, can } = useAuth();
  const { menu, error, reload, setMenu } = useAdminMenu();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ item?: AItem; categoryId: number } | null>(null);
  const [editingCat, setEditingCat] = useState<ACategory | 'new' | null>(null);
  useOnEvent(['menu.updated'], () => void reload());

  const toggleAvailable = async (item: AItem) => {
    // Flip it on screen straight away; undo if the API says no.
    const flip = (v: boolean) =>
      setMenu(m => m && m.map(c => ({ ...c, items: c.items.map(i => (i.id === item.id ? { ...i, available: v } : i)) })));
    flip(!item.available);
    try {
      await call(`/api/admin/items/${item.id}`, { method: 'PATCH', json: { available: !item.available } });
      toast(`${item.name} is ${item.available ? 'sold out' : 'back on'}`);
    } catch (e) {
      flip(item.available);
      toast(errText(e), 'bad');
    }
  };

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const soldOut = menu?.flatMap(c => c.items.filter(i => i.active && !i.available)) ?? [];

  return (
    <div className="a-page">
      <PageHead title="Menu">
        <input className="a-input" type="search" placeholder="Find an item" value={q} onChange={e => setQ(e.target.value)} aria-label="Find an item" />
        {can('manager') && (
          <button type="button" className="a-btn" onClick={() => setEditingCat('new')}>
            Add section
          </button>
        )}
      </PageHead>
      <p className="a-muted">
        Switch an item off when it runs out. It shows as sold out on the website straight away. {soldOut.length > 0 && <b>{soldOut.length} sold out right now.</b>}
      </p>
      {error && <p className="a-error">{error}</p>}
      {!menu && !error && <p className="a-muted">Loading menu…</p>}
      {menu?.map(c => {
        const items = c.items.filter(i => !words.length || words.every(w => i.name.toLowerCase().includes(w)));
        if (words.length && !items.length) return null;
        return (
          <section key={c.id} className={`a-menu-sec ${c.active ? '' : 'hidden'}`}>
            <header>
              <i style={{ background: c.color }} aria-hidden="true" />
              <h2>{c.name}</h2>
              {!c.active && <span className="a-tag">Hidden</span>}
              <span className="a-muted">{c.items.length} items</span>
              {can('manager') && (
                <>
                  <button type="button" className="a-link" onClick={() => setEditingCat(c)}>
                    Edit section
                  </button>
                  <button type="button" className="a-btn a-btn-sm" onClick={() => setEditing({ categoryId: c.id })}>
                    Add item
                  </button>
                </>
              )}
            </header>
            <ul className="a-menu-items">
              {items.map(i => (
                <li key={i.id} className={`${i.active ? '' : 'hidden'} ${i.available ? '' : 'out'}`}>
                  <Toggle id={`av-${i.id}`} checked={i.available} onChange={() => toggleAvailable(i)} label={<span className="a-sr">In stock</span>} />
                  <span className="a-menu-name">
                    {i.name}
                    {!i.active && <span className="a-tag">Hidden</span>}
                    {i.featured && <span className="a-tag gold">Featured</span>}
                  </span>
                  <span className="a-menu-opts">
                    {i.options
                      .filter(o => o.active)
                      .map(o => (
                        <span key={o.id}>
                          <DietDot diet={o.diet} />
                          {o.label && `${o.label} `}
                          <b className="num">{rs(o.price_paise)}</b>
                        </span>
                      ))}
                  </span>
                  {can('manager') && (
                    <button type="button" className="a-link" onClick={() => setEditing({ item: i, categoryId: c.id })}>
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {editing && menu && <ItemEditor menu={menu} {...editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {editingCat && <CategoryEditor cat={editingCat === 'new' ? null : editingCat} onClose={() => setEditingCat(null)} onSaved={reload} />}
    </div>
  );
}

interface OptDraft { id?: number; label: string; diet: string; price: string }

function ItemEditor({ menu, item, categoryId, onClose, onSaved }: { menu: ACategory[]; item?: AItem; categoryId: number; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [cat, setCat] = useState(categoryId);
  const [active, setActive] = useState(item?.active ?? true);
  const [featured, setFeatured] = useState(item?.featured ?? false);
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const [opts, setOpts] = useState<OptDraft[]>(
    item?.options.filter(o => o.active).map(o => ({ id: o.id, label: o.label, diet: o.diet, price: String(o.price_paise / 100) })) ?? [{ label: '', diet: 'veg', price: '' }],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('Give the item a name.');
    const options = opts.map(o => ({ id: o.id, label: o.label.trim(), diet: o.diet, pricePaise: Math.round(Number(o.price) * 100) }));
    if (options.some(o => !Number.isFinite(o.pricePaise) || o.pricePaise <= 0)) return setError('Every price needs to be more than ₹0.');
    if (options.length > 1 && options.some(o => !o.label)) return setError('With more than one price, label each one (for example Veg and Non-veg).');
    setBusy(true);
    try {
      const body = { categoryId: cat, name: name.trim(), description: description.trim() || null, active, featured, imageUrl: imageUrl.trim() || null, options };
      if (item) await call(`/api/admin/items/${item.id}`, { method: 'PATCH', json: body });
      else await call('/api/admin/items', { method: 'POST', json: body });
      toast(item ? 'Item saved' : 'Item added');
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add an item'}
      onClose={onClose}
      footer={
        <>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={save} disabled={busy}>
            {item ? 'Save item' : 'Add item'}
          </button>
        </>
      }
    >
      <div className="a-form">
        <label className="a-field">
          <span>Name</span>
          <input className="a-input" value={name} onChange={e => setName(e.target.value)} data-autofocus />
        </label>
        <label className="a-field">
          <span>Description (optional)</span>
          <textarea className="a-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What's in it, in a line" />
        </label>
        <label className="a-field">
          <span>Section</span>
          <select className="a-input" value={cat} onChange={e => setCat(Number(e.target.value))}>
            {menu.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="a-field">
          <legend>Prices</legend>
          {opts.map((o, i) => (
            <div key={i} className="a-opt-row">
              <input className="a-input" placeholder={opts.length > 1 ? 'Label, e.g. Veg' : 'Label (optional)'} value={o.label} onChange={e => setOpts(xs => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Price label" />
              <select className="a-input" value={o.diet} onChange={e => setOpts(xs => xs.map((x, j) => (j === i ? { ...x, diet: e.target.value } : x)))} aria-label="Veg or non-veg">
                <option value="veg">Veg</option>
                <option value="nonveg">Non-veg</option>
                <option value="unknown">Not marked</option>
              </select>
              <input className="a-input num" inputMode="decimal" placeholder="₹" value={o.price} onChange={e => setOpts(xs => xs.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(/[^\d.]/g, '') } : x)))} aria-label="Price in rupees" />
              {opts.length > 1 && (
                <button type="button" className="a-icon" aria-label="Remove this price" onClick={() => setOpts(xs => xs.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          {opts.length < 6 && (
            <button type="button" className="a-link" onClick={() => setOpts(xs => [...xs, { label: '', diet: 'nonveg', price: '' }])}>
              Add another price
            </button>
          )}
        </fieldset>
        <label className="a-field">
          <span>Photo URL (optional)</span>
          <input className="a-input" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" />
        </label>
        <Toggle id="it-active" checked={active} onChange={setActive} label="Show on the menu" />
        <Toggle id="it-featured" checked={featured} onChange={setFeatured} label="Featured" />
        {error && <p className="a-error">{error}</p>}
      </div>
    </Modal>
  );
}

const SWATCHES = ['#FF8F1F', '#A58BFF', '#FF5CBE', '#63E8CF', '#D0FF00', '#FF6A4D', '#B8EE4F', '#00BCC8', '#F4EBDD', '#FF4646', '#F2B8FF'];

function CategoryEditor({ cat, onClose, onSaved }: { cat: ACategory | null; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const [name, setName] = useState(cat?.name ?? '');
  const [color, setColor] = useState(cat?.color ?? SWATCHES[0]);
  const [kind, setKind] = useState(cat?.kind ?? 'food');
  const [active, setActive] = useState(cat?.active ?? true);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim()) return setError('Give the section a name.');
    try {
      const body = { name: name.trim(), color, kind, active };
      if (cat) await call(`/api/admin/categories/${cat.id}`, { method: 'PATCH', json: body });
      else await call('/api/admin/categories', { method: 'POST', json: body });
      toast(cat ? 'Section saved' : 'Section added');
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Modal
      title={cat ? `Edit ${cat.name}` : 'Add a section'}
      onClose={onClose}
      footer={
        <>
          <span className="a-spacer" />
          <button type="button" className="a-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="a-btn a-btn-primary" onClick={save}>
            Save section
          </button>
        </>
      }
    >
      <div className="a-form">
        <label className="a-field">
          <span>Name</span>
          <input className="a-input" value={name} onChange={e => setName(e.target.value)} data-autofocus />
        </label>
        <fieldset className="a-field">
          <legend>Record label colour</legend>
          <div className="a-swatches">
            {SWATCHES.map(s => (
              <button key={s} type="button" className={color.toLowerCase() === s.toLowerCase() ? 'on' : ''} style={{ background: s }} onClick={() => setColor(s)} aria-label={`Colour ${s}`} />
            ))}
          </div>
        </fieldset>
        <div className="a-seg">
          <button type="button" className={kind === 'food' ? 'on' : ''} onClick={() => setKind('food')}>
            Food
          </button>
          <button type="button" className={kind === 'drink' ? 'on' : ''} onClick={() => setKind('drink')}>
            Drinks
          </button>
        </div>
        <Toggle id="cat-active" checked={active} onChange={setActive} label="Show on the menu" />
        {error && <p className="a-error">{error}</p>}
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { errText, rs, useAuth, useOnEvent } from './core';
import { DietDot, Modal, PageHead, Toggle, toast } from './ui';
import { useAdminMenu, type ACategory, type AItem } from './picker';
import { MenuBar, MenuPriceEditor, useMenus } from './Menus';

export default function MenuAdmin() {
  const { call, can } = useAuth();
  const { menu, error, reload, setMenu } = useAdminMenu('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ item?: AItem; categoryId: number } | null>(null);
  const [editingCat, setEditingCat] = useState<ACategory | 'new' | null>(null);
  const [pricing, setPricing] = useState<AItem | null>(null);
  const { menus, selected, setSelected, detail, setDetail, refresh } = useMenus();
  useOnEvent(['menu.updated'], () => void (reload(), refresh()));
  const onMenu = new Set(detail?.itemIds ?? []);

  const toggleOnMenu = async (item: AItem) => {
    if (!detail) return;
    const on = !onMenu.has(item.id);
    setDetail({ ...detail, itemIds: on ? [...detail.itemIds, item.id] : detail.itemIds.filter(id => id !== item.id) });
    try {
      await call(`/api/admin/menus/${detail.id}/items/${item.id}`, { method: 'PUT', json: { on } });
      toast(`${item.name} ${on ? 'added to' : 'taken off'} ${detail.name}`);
      void refresh();
    } catch (e) {
      void refresh();
      toast(errText(e), 'bad');
    }
  };

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
      {menus && <MenuBar menus={menus} selected={selected} onSelect={setSelected} onChanged={() => void refresh()} />}
      <p className="a-hint">
        Turn off <b>In stock</b> when a dish runs out: guests see it as sold out straight away.
        {soldOut.length > 0 && (
          <>
            {' '}
            <b className="a-soldout-count">{soldOut.length} sold out right now.</b>
          </>
        )}
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
              <span className="a-muted">
                {detail ? `${c.items.filter(i => onMenu.has(i.id)).length} of ${c.items.length} on ${detail.name}` : `${c.items.length} items`}
              </span>
              {can('manager') && (
                <>
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setEditingCat(c)}>
                    Edit section
                  </button>
                  <button type="button" className="a-btn a-btn-sm" onClick={() => setEditing({ categoryId: c.id })}>
                    Add item
                  </button>
                </>
              )}
            </header>
            <ul className={detail ? 'a-menu-items with-menu' : 'a-menu-items'}>
              {items.map(i => (
                <li key={i.id} className={`${i.active ? '' : 'hidden'} ${i.available ? '' : 'out'} ${detail && !onMenu.has(i.id) ? 'offmenu' : ''}`}>
                  <Toggle id={`av-${i.id}`} checked={i.available} onChange={() => toggleAvailable(i)} label={<small className="a-toggle-cap">In stock</small>} />
                  {detail && (
                    <Toggle
                      id={`on-${i.id}`}
                      checked={onMenu.has(i.id)}
                      onChange={() => (can('manager') ? void toggleOnMenu(i) : toast('Only a manager can change what’s on a menu.', 'bad'))}
                      label={<small className="a-toggle-cap">On {detail.name}</small>}
                    />
                  )}
                  <span className="a-menu-name">
                    {i.image_url && <img className="a-menu-thumb" src={i.image_url} alt="" loading="lazy" width="44" height="44" />}
                    {i.name}
                    {!i.active && <span className="a-tag">Hidden</span>}
                    {i.featured && <span className="a-tag gold">Featured</span>}
                    {detail && !onMenu.has(i.id) && <span className="a-tag">Not on {detail.name}</span>}
                    {i.description && <small className="a-menu-desc">{i.description}</small>}
                  </span>
                  <span className="a-menu-opts">
                    {i.options
                      .filter(o => o.active)
                      .map(o => {
                        const own = detail && onMenu.has(i.id) ? detail.prices[o.id] : undefined;
                        return (
                          <span key={o.id}>
                            <DietDot diet={o.diet} />
                            {o.label && `${o.label} `}
                            {own !== undefined ? (
                              <>
                                <b className="num">{rs(own)}</b> <s className="a-muted num">{rs(o.price_paise)}</s>
                              </>
                            ) : (
                              <b className="num">{rs(o.price_paise)}</b>
                            )}
                          </span>
                        );
                      })}
                  </span>
                  {can('manager') && (
                    <span className="a-menu-links">
                      {detail && onMenu.has(i.id) && (
                        <button type="button" className="a-btn a-btn-sm" onClick={() => setPricing(i)}>
                          Price on {detail.name}
                        </button>
                      )}
                      <button type="button" className="a-btn a-btn-sm" onClick={() => setEditing({ item: i, categoryId: c.id })}>
                        Edit
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {editing && menu && (
        <ItemEditor menu={menu} menuId={detail?.id} {...editing} onClose={() => setEditing(null)} onSaved={() => void (reload(), refresh())} />
      )}
      {pricing && detail && <MenuPriceEditor menu={detail} item={pricing} onClose={() => setPricing(null)} onSaved={() => void refresh()} />}
      {editingCat && <CategoryEditor cat={editingCat === 'new' ? null : editingCat} onClose={() => setEditingCat(null)} onSaved={reload} />}
    </div>
  );
}

/** Room for a line or two under the dish name. */
const DESC_MAX = 160;

interface OptDraft { id?: number; label: string; diet: string; price: string }

function ItemEditor({ menu, menuId, item, categoryId, onClose, onSaved }: { menu: ACategory[]; menuId?: number; item?: AItem; categoryId: number; onClose: () => void; onSaved: () => void }) {
  const { call } = useAuth();
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [cat, setCat] = useState(categoryId);
  const [active, setActive] = useState(item?.active ?? true);
  const [featured, setFeatured] = useState(item?.featured ?? false);
  // The saved photo, a newly picked one (already shrunk) waiting for Save, or a request to remove it.
  const [photo, setPhoto] = useState<string | null>(item?.image_url ?? null);
  const [picked, setPicked] = useState<{ blob: Blob; preview: string } | null>(null);
  const [shrinking, setShrinking] = useState(false);
  useEffect(() => () => void (picked && URL.revokeObjectURL(picked.preview)), [picked]);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setShrinking(true);
    setError('');
    try {
      const blob = await shrinkPhoto(f);
      setPicked({ blob, preview: URL.createObjectURL(blob) });
    } catch {
      setError('That photo couldn’t be read. Try a JPG or PNG.');
    } finally {
      setShrinking(false);
    }
  };
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
      const body = { categoryId: cat, name: name.trim(), description: description.trim() || null, active, featured, options };
      let id = item?.id;
      if (item) await call(`/api/admin/items/${item.id}`, { method: 'PATCH', json: body });
      else id = (await call<{ id: number }>('/api/admin/items', { method: 'POST', json: { ...body, menuId } })).id;
      if (id && picked) {
        const form = new FormData();
        form.set('file', new File([picked.blob], `dish.${picked.blob.type.split('/')[1] ?? 'jpg'}`, { type: picked.blob.type }));
        await call(`/api/admin/items/${id}/photo`, { method: 'POST', body: form });
      } else if (id && item?.image_url && !photo) await call(`/api/admin/items/${id}/photo`, { method: 'DELETE' });
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
          <span>Short description (optional)</span>
          <textarea
            className="a-input"
            rows={3}
            maxLength={DESC_MAX}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="For example: double espresso over hemp milk, with a little cardamom"
          />
          <small className="a-field-note">
            Guests see this under the dish name on the menu. Keep it to a line or two. {description.length} of {DESC_MAX}
          </small>
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
        <div className="a-field">
          <span>Photo (optional)</span>
          <div className="a-photo">
            {picked || photo ? (
              <img src={picked?.preview ?? photo!} alt={`${name || 'Dish'} photo`} />
            ) : (
              <div className="a-photo-empty" aria-hidden="true">
                No photo
              </div>
            )}
            <div className="a-photo-actions">
              <label className="a-btn a-btn-sm">
                {shrinking ? 'Getting it ready…' : picked || photo ? 'Change photo' : 'Add a photo'}
                <input type="file" accept="image/*" className="a-sr" disabled={shrinking} onChange={e => void pick(e.target.files?.[0])} />
              </label>
              {(picked || photo) && (
                <button
                  type="button"
                  className="a-btn a-btn-sm a-btn-ghost"
                  onClick={() => {
                    setPicked(null);
                    setPhoto(null);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <small className="a-field-note">
            Take one with the phone or pick from the gallery. It’s made smaller before it’s sent, and guests see it on the menu. Saved when you tap
            {item ? ' Save item' : ' Add item'}.
          </small>
        </div>
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

/** Phone photos are several MB; send at most 1200 px on the long side, as WebP (or JPEG where WebP can't be made). */
async function shrinkPhoto(file: File): Promise<Blob> {
  const MAX = 1200;
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise<HTMLImageElement>((ok, bad) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = bad;
      img.src = url;
    });
  }
  const scale = Math.min(1, MAX / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  const make = (type: string, q: number) => new Promise<Blob | null>(ok => canvas.toBlob(ok, type, q));
  const webp = await make('image/webp', 0.82);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await make('image/jpeg', 0.85);
  if (!jpeg) throw new Error('could not encode');
  return jpeg;
}

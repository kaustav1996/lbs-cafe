import { useEffect, useRef, useState, type ReactNode } from 'react';

/* Tiny global toast queue so any screen can confirm an action. */
type T = { id: number; msg: string; tone: 'ok' | 'bad' };
let push: ((t: T) => void) | null = null;
let seq = 0;
export function toast(msg: string, tone: 'ok' | 'bad' = 'ok') {
  push?.({ id: ++seq, msg, tone });
}

export function Toasts() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = t => {
      setItems(xs => [...xs.slice(-3), t]);
      setTimeout(() => setItems(xs => xs.filter(x => x.id !== t.id)), 4200);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="a-toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={`a-toast ${t.tone}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="a-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`a-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="a-modal-head">
          <h2>{title}</h2>
          <button type="button" className="a-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="a-modal-body">{children}</div>
        {footer && <footer className="a-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id: string }) {
  return (
    <label className="a-toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <i className="a-switch" aria-hidden="true" />
      {label}
    </label>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="a-page-head">
      <h1>{title}</h1>
      {children && <div className="a-page-actions">{children}</div>}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="a-empty">{children}</div>;
}

export function DietDot({ diet }: { diet: string }) {
  if (diet !== 'veg' && diet !== 'nonveg') return null;
  return <i className={`a-diet ${diet}`} title={diet === 'veg' ? 'Veg' : 'Non-veg'} aria-label={diet === 'veg' ? 'Veg' : 'Non-veg'} />;
}

/**
 * On phones the order boards show one column at a time; these tabs pick it and show how many orders each holds.
 * Hidden on wider screens, where every column is visible.
 */
export function BoardTabs({ tabs, value, onChange }: { tabs: { key: string; title: string; count: number }[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="a-board-tabs" role="tablist" aria-label="Order columns" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map(t => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>
          <span>{t.title}</span>
          <b>{t.count}</b>
        </button>
      ))}
    </div>
  );
}

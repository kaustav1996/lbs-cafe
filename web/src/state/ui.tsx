import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Panel = 'cart' | 'booking' | 'waiter' | null;

interface UiApi {
  panel: Panel;
  open: (p: Exclude<Panel, null>) => void;
  close: () => void;
  toast: string | null;
  say: (msg: string) => void;
}

const Ctx = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // While a sheet is open the page behind it must not move. overflow: hidden alone doesn't stop that on iPhones
  // (Safari, the Google app's browser), where swipes then scrolled the page instead of the sheet. So the page is
  // pinned in place and put back where it was on close (or at the top, if closing went to a new page).
  const open_ = panel !== null;
  useEffect(() => {
    if (!open_) return;
    const y = window.scrollY;
    const path = window.location.pathname;
    const body = document.body.style;
    document.documentElement.classList.add('locked');
    Object.assign(body, { position: 'fixed', top: `-${y}px`, left: '0', right: '0', width: '100%' });
    return () => {
      document.documentElement.classList.remove('locked');
      Object.assign(body, { position: '', top: '', left: '', right: '', width: '' });
      window.scrollTo({ top: window.location.pathname === path ? y : 0, left: 0, behavior: 'instant' });
    };
  }, [open_]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const open = useCallback((p: Exclude<Panel, null>) => setPanel(p), []);
  const close = useCallback(() => setPanel(null), []);
  const say = useCallback((m: string) => setToast(m), []);

  const api = useMemo(() => ({ panel, open, close, toast, say }), [panel, open, close, toast, say]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useUi() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUi outside UiProvider');
  return c;
}

export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

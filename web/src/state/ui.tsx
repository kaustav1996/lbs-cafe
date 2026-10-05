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

  useEffect(() => {
    document.documentElement.classList.toggle('locked', panel !== null);
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

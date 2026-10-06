import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, API_URL, ApiError, HAS_API } from '../lib/api';

export type Role = 'owner' | 'manager' | 'staff';
export interface Me {
  id: number;
  name: string;
  email: string;
  role: Role;
}

const TOKEN_KEY = 'lbs.admin.token';
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

interface AuthApi {
  me: Me | null;
  token: string | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  call: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
  can: (role: Role) => boolean;
}

const AuthCtx = createContext<AuthApi | null>(null);
const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readToken);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setMe(null);
  }, []);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit & { json?: unknown } = {}) => {
      try {
        return await api<T>(path, { ...init, token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) signOut();
        throw e;
      }
    },
    [token, signOut],
  );

  useEffect(() => {
    if (!token || !HAS_API) {
      setReady(true);
      return;
    }
    api<{ staff: Me }>('/api/auth/me', { token })
      .then(r => setMe(r.staff))
      .catch(() => signOut())
      .finally(() => setReady(true));
  }, [token, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; staff: Me }>('/api/auth/login', { method: 'POST', json: { email, password } });
    try {
      localStorage.setItem(TOKEN_KEY, r.token);
    } catch {
      /* session-only */
    }
    setToken(r.token);
    setMe(r.staff);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ me, token, ready, signIn, signOut, call, can: role => !!me && RANK[me.role] >= RANK[role] }),
    [me, token, ready, signIn, signOut, call],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/* ---------- Live events from the API (Server-Sent Events) ---------- */

export interface CafeEvent {
  type: string;
  [k: string]: unknown;
}
type Listener = (e: CafeEvent) => void;

interface StreamApi {
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  chime: (kind?: 'order' | 'call') => void;
}
const StreamCtx = createContext<StreamApi | null>(null);

export function StreamProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const [soundOn, setSoundOnState] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  const chime = useCallback(
    (kind: 'order' | 'call' = 'order') => {
      if (!soundOn || !audio.current) return;
      const ctx = audio.current;
      const notes = kind === 'order' ? [880, 1175, 1568] : [660, 660];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        const t = ctx.currentTime + i * 0.16;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.32);
      });
    },
    [soundOn],
  );

  const setSoundOn = useCallback((v: boolean) => {
    if (v && !audio.current) audio.current = new AudioContext();
    if (v) void audio.current?.resume();
    setSoundOnState(v);
  }, []);

  useEffect(() => {
    if (!token || !HAS_API) return;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let ping: ReturnType<typeof setInterval>;
    let closed = false;
    const base = (API_URL || window.location.origin).replace(/^http/, 'ws');
    const open = () => {
      ws = new WebSocket(`${base}/api/auth/stream?token=${encodeURIComponent(token)}`);
      ws.onmessage = ev => {
        if (ev.data === 'pong') return;
        const data = JSON.parse(ev.data as string) as CafeEvent | { type: 'hello' };
        if (data.type === 'hello') return setConnected(true);
        listeners.current.forEach(fn => fn(data as CafeEvent));
      };
      // Keeps proxies from closing a quiet socket; the server answers without waking up.
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
      ws.onclose = () => {
        setConnected(false);
        clearInterval(ping);
        if (!closed) retry = setTimeout(open, 4000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      ws?.close();
    };
  }, [token]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const value = useMemo(() => ({ connected, subscribe, soundOn, setSoundOn, chime }), [connected, subscribe, soundOn, setSoundOn, chime]);
  return <StreamCtx.Provider value={value}>{children}</StreamCtx.Provider>;
}

export function useStream() {
  const c = useContext(StreamCtx);
  if (!c) throw new Error('useStream outside StreamProvider');
  return c;
}

/** Re-run `fn` whenever one of the given event types arrives. */
export function useOnEvent(types: string[], fn: (e: CafeEvent) => void) {
  const { subscribe } = useStream();
  const ref = useRef(fn);
  ref.current = fn;
  const key = types.join(',');
  useEffect(() => subscribe(e => key.split(',').includes(e.type) && ref.current(e)), [subscribe, key]);
}

/* ---------- Small helpers ---------- */

export const rs = (paise: number | string | null | undefined) => {
  const v = Number(paise ?? 0) / 100;
  const frac = !Number.isInteger(v);
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
};

export const todayIST = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + offsetDays * 86400000));

export function timeIST(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** Re-renders every `ms` so "x min ago" labels stay fresh. */
export function useTick(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export async function downloadCsv(call: AuthApi['call'], token: string | null, path: string, filename: string) {
  const res = await fetch(API_URL + path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, 'Couldn’t download the file. Try again.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  void call;
}

export function errText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_URL } from '../lib/api';
import { useLive } from './live';

/**
 * LB's set, playing in the background. Every record player, cassette, Walkman and boombox on the site plays and
 * pauses this one track. Pausing keeps the place; the place is remembered on this phone, so it carries on after a
 * reload. Past the end time (or the end of the file) it goes back to the start time and keeps playing.
 * Nothing downloads until someone presses play.
 */
interface MusicApi {
  /** There's music to play (uploaded in Admin). */
  available: boolean;
  /** Sound is coming out. */
  playing: boolean;
  /** Play was pressed and the sound is on its way (downloading or seeking). */
  loading: boolean;
  /** Played at least once on this visit, so the pause control stays in reach. */
  started: boolean;
  toggle: () => void;
  pause: () => void;
}

const Ctx = createContext<MusicApi>({ available: false, playing: false, loading: false, started: false, toggle: () => {}, pause: () => {} });
const POS_KEY = 'lbs.music.pos';

function readPos(url: string): number | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { url: string; t: number } | null;
    return p && p.url === url ? p.t : null;
  } catch {
    return null;
  }
}
function writePos(url: string, t: number) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ url, t: Math.floor(t) }));
  } catch {
    /* fine: it starts from the start time next visit */
  }
}

export function MusicProvider({ children }: { children: ReactNode }) {
  const { settings } = useLive();
  const music = settings.music;
  const src = music ? (/^https?:/.test(music.url) ? music.url : (API_URL || '') + music.url) : null;
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const win = useRef({ start: 0, end: null as number | null });
  win.current = { start: music?.start ?? 0, end: music?.end ?? null };

  const get = useCallback(() => {
    if (!src) return null;
    if (audio.current && audio.current.dataset.src === src) return audio.current;
    audio.current?.pause();
    const a = new Audio();
    a.dataset.src = src;
    a.preload = 'none';
    a.src = src;
    const back = () => {
      a.currentTime = win.current.start;
    };
    a.addEventListener('timeupdate', () => {
      const { start, end } = win.current;
      if (end !== null && a.currentTime >= end) back();
      else if (a.currentTime < start - 1) back();
    });
    a.addEventListener('ended', () => {
      back();
      void a.play().catch(() => setPlaying(false));
    });
    a.addEventListener('play', () => setLoading(a.readyState < 3));
    a.addEventListener('waiting', () => !a.paused && setLoading(true));
    a.addEventListener('playing', () => {
      setLoading(false);
      setPlaying(true);
    });
    a.addEventListener('pause', () => {
      setLoading(false);
      setPlaying(false);
      writePos(src, a.currentTime);
    });
    // Start where this phone left off, if that's inside the part that plays.
    const saved = readPos(src);
    const { start, end } = win.current;
    const at = saved !== null && saved >= start && (end === null || saved < end) ? saved : start;
    a.addEventListener('loadedmetadata', () => (a.currentTime = at), { once: true });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'LB’s set', artist: 'LB’s Hemp Cafe & Lounge' });
    }
    audio.current = a;
    return a;
  }, [src]);

  // Remember the place every few seconds, and when the page goes away.
  useEffect(() => {
    if (!playing || !src) return;
    const t = setInterval(() => audio.current && writePos(src, audio.current.currentTime), 5000);
    const away = () => audio.current && writePos(src, audio.current.currentTime);
    window.addEventListener('pagehide', away);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', away);
    };
  }, [playing, src]);

  // Music removed or replaced in Admin: stop the old one.
  useEffect(() => {
    if (audio.current && audio.current.dataset.src !== src) {
      audio.current.pause();
      audio.current = null;
      setPlaying(false);
      setLoading(false);
    }
  }, [src]);

  const toggle = useCallback(() => {
    const a = get();
    if (!a) return;
    if (a.paused) {
      setStarted(true);
      setLoading(true);
      void a.play().catch(() => {
        setLoading(false);
        setPlaying(false);
      });
    } else a.pause();
  }, [get]);
  const pause = useCallback(() => audio.current?.pause(), []);

  const value = useMemo(() => ({ available: !!src, playing, loading, started, toggle, pause }), [src, playing, loading, started, toggle, pause]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useMusic = () => useContext(Ctx);

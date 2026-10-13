import { useEffect, useState } from 'react';

/**
 * Sound effects for the single-player games, synthesised with Web Audio (no files to download). One switch for
 * all of them, remembered on the phone. The first sound is made from a tap, which is when browsers allow audio.
 */
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
/** End times (audio clock) of the sounds playing now, to cap how many overlap. */
let ends: number[] = [];
const KEY = 'lbs.games.muted';
let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<(m: boolean) => void>();

function audio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.45;
      out.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export const isMuted = () => muted;

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* fine */
  }
  listeners.forEach(f => f(m));
  if (!m) audio();
}
export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, set] = useState(muted);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return [m, setMuted];
}

function voice(len: number) {
  if (muted) return null;
  const c = audio();
  if (!c || !out) return null;
  ends = ends.filter(e => e > c.currentTime);
  if (ends.length > 10) return null;
  ends.push(c.currentTime + len + 0.05);
  return { c, t: c.currentTime };
}
function env(c: AudioContext, t: number, peak: number, len: number, attack = 0.005) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}
function tone(type: OscillatorType, f1: number, f2: number, len: number, vol: number, delay = 0) {
  const v = voice(len + delay);
  if (!v) return;
  const t = v.t + delay;
  const o = v.c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + len);
  o.connect(env(v.c, t, vol, len)).connect(out!);
  o.start(t);
  o.stop(t + len + 0.02);
}
function hiss(f1: number, f2: number, len: number, vol: number, q = 0.8) {
  const v = voice(len);
  if (!v || !noise) return;
  const src = v.c.createBufferSource();
  src.buffer = noise;
  const f = v.c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f1, v.t);
  f.frequency.exponentialRampToValueAtTime(f2, v.t + len);
  src.connect(f).connect(env(v.c, v.t, vol, len)).connect(out!);
  src.start(v.t, Math.random() * 0.5);
  src.stop(v.t + len + 0.02);
}
const arp = (notes: number[], step: number, type: OscillatorType = 'square', vol = 0.12, len = 0.12) => notes.forEach((f, i) => tone(type, f, f, len, vol, i * step));

const SOUNDS = {
  /** A short tap: buttons, a flap, a turn. */
  tick: () => tone('square', 880, 660, 0.04, 0.06),
  flap: () => {
    tone('triangle', 380, 720, 0.09, 0.16);
    hiss(2500, 900, 0.06, 0.05);
  },
  /** A point scored. */
  point: () => tone('square', 1046, 1046, 0.07, 0.08),
  coin: () => arp([988, 1319], 0.06, 'square', 0.09, 0.09),
  /** Something eaten or collected. */
  eat: () => tone('square', 520, 980, 0.08, 0.1),
  /** A tile, card or layer lands. */
  drop: () => {
    tone('sine', 220, 110, 0.12, 0.25);
    hiss(1200, 300, 0.07, 0.08);
  },
  perfect: () => arp([784, 1046, 1568], 0.05, 'triangle', 0.14, 0.14),
  cut: () => hiss(3000, 500, 0.12, 0.12, 1.5),
  bounce: () => tone('square', 330, 330, 0.05, 0.1),
  break: () => {
    hiss(4000, 800, 0.1, 0.16, 2);
    tone('square', 660, 440, 0.06, 0.06);
  },
  /** A good hit (a bonk). */
  bonk: () => {
    tone('sine', 300, 120, 0.12, 0.3);
    hiss(2500, 400, 0.08, 0.12);
  },
  /** A mistake that costs you (a lemon, a wrong pair). */
  bad: () => tone('sawtooth', 220, 110, 0.22, 0.1),
  flip: () => hiss(5000, 2000, 0.05, 0.08, 1),
  pair: () => arp([660, 990], 0.07, 'triangle', 0.14, 0.12),
  slide: () => hiss(1800, 600, 0.06, 0.06),
  merge: () => tone('triangle', 440, 880, 0.1, 0.12),
  /** Lost a life. */
  lose: () => tone('square', 440, 140, 0.35, 0.1),
  /** Next level. */
  level: () => arp([523, 659, 784, 1046], 0.08, 'square', 0.1, 0.14),
  /** Game over. */
  over: () => {
    arp([392, 330, 262], 0.14, 'square', 0.1, 0.18);
    hiss(800, 80, 0.5, 0.08);
  },
  /** A start. */
  start: () => arp([523, 784], 0.07, 'triangle', 0.12, 0.1),
  /** Brew Bandits. */
  yourTurn: () => arp([659, 988], 0.09, 'triangle', 0.14, 0.16),
  draw: () => hiss(6000, 2500, 0.05, 0.07, 1),
  brew: () => {
    hiss(900, 400, 0.35, 0.1, 2);
    arp([784, 1175], 0.12, 'triangle', 0.12, 0.2);
  },
  raid: () => {
    tone('sawtooth', 520, 780, 0.12, 0.08);
    tone('sawtooth', 780, 520, 0.12, 0.08, 0.13);
    tone('sawtooth', 520, 780, 0.12, 0.08, 0.26);
  },
  whistle: () => {
    tone('sine', 2000, 2300, 0.12, 0.12);
    tone('sine', 2300, 1900, 0.2, 0.12, 0.14);
  },
  steal: () => hiss(5000, 900, 0.18, 0.12, 2),
  caw: () => {
    tone('sawtooth', 700, 380, 0.14, 0.09);
    tone('sawtooth', 680, 360, 0.16, 0.09, 0.2);
  },
  bark: () => {
    tone('square', 260, 160, 0.09, 0.14);
    tone('square', 280, 170, 0.1, 0.14, 0.16);
  },
  rain: () => hiss(3500, 1800, 1.2, 0.12, 0.5),
  win: () => arp([523, 659, 784, 1046, 1318], 0.1, 'square', 0.11, 0.2),
} as const;
export type SoundName = keyof typeof SOUNDS;

export function sfx(name: SoundName) {
  if (muted) return;
  try {
    SOUNDS[name]();
  } catch {
    /* never let a sound break a game */
  }
}

/** The switch, for the game header. */
export function SoundToggle() {
  const [m, set] = useMuted();
  return (
    <button type="button" className="btn btn-line btn-sm game-sound" aria-pressed={!m} onClick={() => set(!m)}>
      {m ? 'Sound off' : 'Sound on'}
    </button>
  );
}

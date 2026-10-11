/**
 * LB's Space sound effects, synthesised with Web Audio (no files to download). Sounds fade with distance from
 * your ship, and there's a cap on how many play at once so a busy fight doesn't turn into noise.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('lbs.space.muted') === '1';
  } catch {
    return false;
  }
})();
let playing = 0;

/** Call from a tap (browsers only allow sound after one). */
export function unlockSound() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* no Web Audio: the game is silent */
  }
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('lbs.space.muted', m ? '1' : '0');
  } catch {
    /* fine */
  }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
}

function voice(len: number) {
  if (!ctx || !master || muted || playing > 10) return null;
  playing++;
  setTimeout(() => playing--, len * 1000 + 50);
  return { c: ctx, out: master, t: ctx.currentTime };
}

function env(c: AudioContext, t: number, peak: number, attack: number, len: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}

function tone(type: OscillatorType, f1: number, f2: number, len: number, vol: number) {
  const v = voice(len);
  if (!v) return;
  const o = v.c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f1, v.t);
  o.frequency.exponentialRampToValueAtTime(f2, v.t + len);
  const g = env(v.c, v.t, vol, 0.005, len);
  o.connect(g).connect(v.out);
  o.start(v.t);
  o.stop(v.t + len + 0.02);
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
  const g = env(v.c, v.t, vol, 0.004, len);
  src.connect(f).connect(g).connect(v.out);
  src.start(v.t, Math.random() * 0.5);
  src.stop(v.t + len + 0.02);
}

/** Plays the sound for one effect. `near` is 1 at your ship, 0 at the edge of the screen; `mine` = 1 you did it, 2 it hit you. */
export function play(kind: number, size: number, near: number, mine: number) {
  if (!ctx || muted) return;
  const k = Math.max(0, Math.min(1, near)) * (mine ? 1 : 0.55);
  if (k < 0.04) return;
  switch (kind) {
    case 5: // shot
      if (mine !== 1 && Math.random() < 0.5) return;
      tone('square', 1100, 260, 0.09, 0.09 * k);
      break;
    case 6: // missile launch
      tone('sawtooth', 320, 70, 0.35, 0.12 * k);
      hiss(3000, 400, 0.3, 0.18 * k);
      break;
    case 0: // bullet hits a ship
      if (mine === 2) tone('sine', 140, 50, 0.18, 0.35 * k);
      hiss(5000, 1500, 0.06 * size, 0.2 * k, 2);
      break;
    case 1: // hits a rock
      hiss(2400, 600, 0.07 * size, 0.18 * k, 3);
      break;
    case 2: // hits a planet
      hiss(900, 300, 0.1 * size, 0.18 * k);
      break;
    case 7: // shield reflect
      tone('triangle', 600, 1600, 0.15, 0.15 * k);
      break;
    case 3: // asteroid breaks
      hiss(1800, 120, 0.25 + Math.min(0.35, size / 200), 0.35 * k);
      tone('sine', 110, 40, 0.25, 0.25 * k);
      break;
    case 4: // ship destroyed
    case 8: // ship eaten
      hiss(2600, 60, 0.9, 0.55 * k, 0.6);
      tone('sine', 90, 28, 0.7, 0.5 * k);
      if (kind === 8) tone('triangle', 500, 90, 0.4, 0.15 * k);
      break;
    case 9: // gamma beam
      tone('sawtooth', 200, 1400, 0.45, 0.14 * k);
      tone('sine', 60, 40, 0.5, 0.3 * k);
      break;
  }
}

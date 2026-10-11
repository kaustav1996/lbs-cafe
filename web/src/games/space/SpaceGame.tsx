import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import { useGames } from '../../state/games';
import { playerId, savedName, saveName } from '../brew/online';
import { draw, drawMini, spawnFx, type Frame } from './render';
import { isMuted, play, setMuted, unlockSound } from './sfx';
import {
  addShip,
  leaderboard,
  LEVEL_XP,
  minimap,
  newWorld,
  respawn,
  setInput,
  snapshot,
  staticMap,
  step,
  TICK_MS,
  UNLOCK,
  WEAPON_LABEL,
  type Input,
  type Planet,
  type Snapshot,
  type Weapon,
} from './engine';

/** Where snapshots come from: the shared map over a WebSocket, or a world running on this phone (solo). */
interface Source {
  prev: Snapshot | null;
  curr: Snapshot | null;
  prevAt: number;
  currAt: number;
  map: { size: number; planets: Planet[] } | null;
  top: ReturnType<typeof leaderboard>;
  mini: (number | string)[][];
  events: { text: string; at: number }[];
  status: 'connecting' | 'live' | 'closed' | 'full';
  send: (i: Partial<Input>) => void;
  respawn: () => void;
  close: () => void;
}

function push(src: Source, s: Snapshot) {
  // Effects: animations and sounds, quieter the further they are from you.
  const now = performance.now();
  spawnFx(s.f, now);
  if (s.f && s.me)
    for (const [k, x, y, size, mine] of s.f) {
      const d = Math.hypot(x - s.me.x, y - s.me.y);
      play(k, size, 1 - d / 900, mine);
    }
  src.prev = src.curr;
  src.prevAt = src.currAt;
  src.curr = s;
  src.currAt = performance.now();
}

function onlineSource(table: string, name: string, onChange: () => void): Source {
  const src: Source = { prev: null, curr: null, prevAt: 0, currAt: 0, map: null, top: [], mini: [], events: [], status: 'connecting', send: () => {}, respawn: () => {}, close: () => {} };
  const base = (API_URL || window.location.origin).replace(/^http/, 'ws');
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout>;
  let ping: ReturnType<typeof setInterval>;
  const open = () => {
    ws = new WebSocket(`${base}/api/public/games/live?table=${encodeURIComponent(table)}&game=space`);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ t: 'join', id: playerId(), name }));
      src.status = 'live';
      onChange();
    };
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data as string);
      if (m.t === 's') push(src, m as Snapshot);
      else if (m.t === 'map') src.map = m.map;
      else if (m.t === 'board') {
        src.top = m.top;
        src.mini = m.mini;
      } else if (m.t === 'ev') src.events.push({ text: m.text, at: performance.now() });
      else if (m.t === 'full') {
        src.status = 'full';
        closed = true;
        ws?.close();
        onChange();
      }
    };
    ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
    ws.onclose = () => {
      clearInterval(ping);
      if (closed) return;
      src.status = 'connecting';
      onChange();
      retry = setTimeout(open, 2000);
    };
  };
  open();
  src.send = i => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'in', ...i }));
  src.respawn = () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'respawn' }));
  src.close = () => {
    closed = true;
    clearTimeout(retry);
    clearInterval(ping);
    ws?.close();
  };
  return src;
}

function soloSource(name: string): Source {
  const w = newWorld();
  addShip(w, { id: 'me', name, table: null, bot: false });
  for (const n of ['Comet', 'Nebula', 'Quasar', 'Pulsar', 'Meteor', 'Nova']) addShip(w, { id: `bot-${n}`, name: n, table: null, bot: true });
  const src: Source = { prev: null, curr: null, prevAt: 0, currAt: 0, map: staticMap(w), top: [], mini: [], events: [], status: 'live', send: () => {}, respawn: () => {}, close: () => {} };
  let ticks = 0;
  const t = setInterval(() => {
    step(w, TICK_MS);
    for (const e of w.events.splice(0)) if (!e.to || e.to === 'me') src.events.push({ text: e.text, at: performance.now() });
    push(src, snapshot(w, 'me'));
    if (ticks++ % 20 === 0) {
      src.top = leaderboard(w);
      src.mini = minimap(w);
    }
  }, TICK_MS);
  src.send = i => setInput(w, 'me', i);
  src.respawn = () => {
    const s = w.ships.get('me');
    if (s && !s.alive && w.now >= s.respawnAt) respawn(w, 'me');
  };
  src.close = () => clearInterval(t);
  return src;
}

const GUNS: Weapon[] = ['blaster', 'missile'];
const ABILITIES: { w: Weapon; icon: string; cost: string }[] = [
  { w: 'shield', icon: '🛡️', cost: '15 dark energy' },
  { w: 'light', icon: '⚡', cost: '22 dark energy' },
  { w: 'hole', icon: '🕳️', cost: '28 energy, 8 dark matter' },
  { w: 'gamma', icon: '☢️', cost: '25 dark matter, 10 energy' },
];
const canAfford = (a: Weapon, dm: number, de: number) =>
  a === 'shield' ? de >= 15 : a === 'light' ? de >= 22 : a === 'hole' ? de >= 28 && dm >= 8 : a === 'gamma' ? dm >= 25 && de >= 10 : true;

/** Phones play sideways: go full screen and lock to landscape where the browser allows it (Android; iPhones ask you to turn). */
function goLandscape() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
  try {
    if (el.requestFullscreen) el.requestFullscreen().then(lock, () => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not supported: the turn-your-phone note covers it */
  }
}
function leaveLandscape() {
  try {
    screen.orientation?.unlock?.();
    if (document.fullscreenElement) void document.exitFullscreen();
  } catch {
    /* nothing to undo */
  }
}

/** Upright on a phone? */
function usePortraitPhone() {
  const q = '(orientation: portrait) and (pointer: coarse)';
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

/** LB's Space: one shared map for every table with games open (or solo on this phone against bots). */
export default function SpaceGame() {
  const { table } = useGames();
  const [name, setName] = useState(() => savedName());
  const [mode, setMode] = useState<null | 'online' | 'solo'>(null);
  if (mode)
    return (
      <Play
        mode={mode}
        table={table}
        name={name || 'Pilot'}
        onLeave={() => {
          leaveLandscape();
          setMode(null);
        }}
      />
    );
  return (
    <div className="sp-home">
      <p className="lede">One galaxy for everyone at LB’s. Absorb matter to grow, outgrow the other pilots, and climb the leaderboard.</p>
      <ul className="bb-rules">
        <li>
          <b>White matter</b> is your health and size. <b>Purple dark matter</b> powers your weapons. <b>Cyan dark energy</b> fuels boosts and gravity
          weapons.
        </li>
        <li>Ram a smaller pilot to consume them. Asteroids and planets hurt; shoot big asteroids to break them into matter.</li>
        <li>Shots cost dark matter (or a little health). Boosting costs dark energy (or health); it’s free while you’re small.</li>
        <li>
          Level up to unlock Missiles, an Anti-gravity shield, Light speed, a Black hole (asteroids can’t hurt you after this) and the Gamma-ray beam.
        </li>
      </ul>
      <div className="field">
        <label htmlFor="sp-name">Your pilot name</label>
        <input id="sp-name" maxLength={18} value={name} onChange={e => setName(e.target.value)} autoComplete="given-name" />
      </div>
      <div className="bb-home-actions">
        <button
          type="button"
          className="btn btn-ink btn-lg btn-block"
          disabled={!name.trim()}
          onClick={() => {
            saveName(name.trim());
            goLandscape();
            unlockSound();
            setMode('online');
          }}
        >
          Join LB’s Space
        </button>
        <button
          type="button"
          className="btn btn-line btn-lg btn-block"
          onClick={() => {
            if (name.trim()) saveName(name.trim());
            goLandscape();
            unlockSound();
            setMode('solo');
          }}
        >
          Play solo against bots
        </button>
      </div>
      <p className="status-meta">Phone: play it sideways. Left thumb steers, buttons on the right fire and boost. Computer: aim with the mouse, click to fire, Space to boost, 1 to 6 for weapons.</p>
    </div>
  );
}

function Play({ mode, table, name, onLeave }: { mode: 'online' | 'solo'; table: string; name: string; onLeave: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const srcRef = useRef<Source | null>(null);
  const [, setTick] = useState(0);
  const rerender = () => setTick(t => t + 1);
  const input = useRef<Input>({ ax: 0, ay: 0, fire: false, boost: false, weapon: 'blaster', special: 0, ability: 'shield' });
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const portrait = usePortraitPhone();
  const [muted, setMute] = useState(isMuted);
  const [upright, setUpright] = useState(false);

  // The source, and a slow HUD refresh (the canvas runs at 60 fps on its own).
  useEffect(() => {
    const src = mode === 'online' ? onlineSource(table, name, rerender) : soloSource(name);
    srcRef.current = src;
    const hud = setInterval(rerender, 200);
    document.body.classList.add('sp-playing');
    return () => {
      src.close();
      clearInterval(hud);
      document.body.classList.remove('sp-playing');
    };
  }, [mode, table, name]);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const src = srcRef.current;
      const c = canvas.current;
      if (!src?.curr || !src.map || !c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
      if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d')!;
      const span = src.currAt - src.prevAt || TICK_MS;
      const alpha = Math.max(0, Math.min(1, (performance.now() - src.currAt) / span));
      const f: Frame = { prev: src.prev, curr: src.curr, alpha };
      draw(ctx, w, h, f, src.map.planets, src.map.size, performance.now(), dpr);
      const m = mini.current;
      if (m && src.curr.me) drawMini(m.getContext('2d')!, m.width, src.map.size, src.mini, src.map.planets, src.curr.me.x, src.curr.me.y);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Send input a few times a second (and whenever it changes).
  useEffect(() => {
    let last = '';
    const t = setInterval(() => {
      const s = JSON.stringify(input.current);
      if (s !== last || Math.random() < 0.2) {
        srcRef.current?.send(input.current);
        last = s;
      }
    }, 66);
    return () => clearInterval(t);
  }, []);
  const setIn = (p: Partial<Input>) => {
    input.current = { ...input.current, ...p };
    srcRef.current?.send(input.current);
  };
  const ability = (a: Weapon) => setIn({ ability: a, special: input.current.special + 1 });

  // Computer: mouse aims, click fires, Space boosts, 1-6 pick a weapon.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const move = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const dx = e.clientX - r.left - r.width / 2;
      const dy = e.clientY - r.top - r.height / 2;
      const len = Math.hypot(dx, dy);
      const k = Math.min(1, len / (Math.min(r.width, r.height) / 4)) / (len || 1);
      input.current.ax = dx * k;
      input.current.ay = dy * k;
    };
    const down = (e: MouseEvent) => e.button === 0 && (input.current.fire = true);
    const up = () => (input.current.fire = false);
    const key = (e: KeyboardEvent, on: boolean) => {
      if (e.code === 'Space') {
        input.current.boost = on;
        e.preventDefault();
      }
      if (!on) return;
      const n = Number(e.key);
      if (n === 1 || n === 2) setIn({ weapon: GUNS[n - 1] });
      if (n >= 3 && n <= 6) ability(ABILITIES[n - 3].w);
    };
    const kd = (e: KeyboardEvent) => key(e, true);
    const ku = (e: KeyboardEvent) => key(e, false);
    c.addEventListener('mousemove', move);
    c.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      c.removeEventListener('mousemove', move);
      c.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phone: a thumb joystick anywhere on the left half.
  const touchStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.55 && !stick.current) {
        stick.current = { id: t.identifier, x: t.clientX, y: t.clientY };
        setKnob({ x: t.clientX, y: t.clientY, dx: 0, dy: 0 });
      }
    }
  };
  const touchMove = (e: React.TouchEvent) => {
    const st = stick.current;
    if (!st) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== st.id) continue;
      let dx = t.clientX - st.x;
      let dy = t.clientY - st.y;
      const len = Math.hypot(dx, dy);
      const max = 60;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      input.current.ax = dx / max;
      input.current.ay = dy / max;
      setKnob({ x: st.x, y: st.y, dx, dy });
    }
  };
  const touchEnd = (e: React.TouchEvent) => {
    const st = stick.current;
    if (!st) return;
    for (const t of Array.from(e.changedTouches))
      if (t.identifier === st.id) {
        stick.current = null;
        setKnob(null);
        // Keep drifting the way you were heading, a little slower.
        input.current.ax *= 0.4;
        input.current.ay *= 0.4;
      }
  };

  const src = srcRef.current;
  const me = src?.curr?.me;
  const nextXp = me ? LEVEL_XP[me.level] : undefined;
  const xpPct = me && nextXp !== undefined ? ((me.xp - LEVEL_XP[me.level - 1]) / (nextXp - LEVEL_XP[me.level - 1])) * 100 : 100;
  const recent = (src?.events ?? []).filter(e => performance.now() - e.at < 4000).slice(-3);
  const rank = me && src ? src.top.findIndex(t => t.name === name && !t.bot) + 1 : 0;
  const respawnIn = me && !me.alive ? Math.max(0, Math.ceil((me.respawnAt - (src?.curr?.now ?? 0)) / 1000)) : 0;

  return (
    <div className="sp" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={touchEnd}>
      <canvas ref={canvas} className="sp-canvas" aria-label="LB’s Space" />

      <div className="sp-top">
        <button type="button" className="sp-leave" onClick={onLeave}>
          Leave
        </button>
        <button
          type="button"
          className="sp-leave"
          aria-pressed={!muted}
          onClick={() => {
            unlockSound();
            setMuted(!muted);
            setMute(!muted);
          }}
        >
          {muted ? 'Sound off' : 'Sound on'}
        </button>
        {me && (
          <div className="sp-stats">
            <span className="sp-stat is-m" title="Health (matter)">
              <i /> {Math.round(me.mass)}
            </span>
            <span className="sp-stat is-d" title="Dark matter">
              <i /> {Math.round(me.dm)}
            </span>
            <span className="sp-stat is-e" title="Dark energy">
              <i /> {Math.round(me.de)}
            </span>
            <span className="sp-level">
              Level {me.level}
              <span className="sp-xp">
                <span style={{ width: `${Math.min(100, xpPct)}%` }} />
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="sp-board">
        <b>{mode === 'online' ? 'LB’s Space' : 'Solo'}</b>
        <ol>
          {(src?.top ?? []).slice(0, 5).map((t, i) => (
            <li key={t.id} className={t.name === name && !t.bot ? 'is-me' : ''}>
              <span>
                {i + 1}. {t.name}
                {t.bot ? ' 🤖' : ''}
              </span>
              <span className="num">{t.score}</span>
            </li>
          ))}
        </ol>
        {rank > 5 && <p className="num">You: #{rank}</p>}
        <canvas ref={mini} className="sp-mini" width={110} height={110} aria-hidden="true" />
      </div>

      {recent.length > 0 && (
        <div className="sp-events" aria-live="polite">
          {recent.map((e, i) => (
            <p key={`${e.at}-${i}`}>{e.text}</p>
          ))}
        </div>
      )}

      {src?.status === 'connecting' && <p className="sp-banner">Connecting to LB’s Space…</p>}
      {src?.status === 'full' && <p className="sp-banner">Space is full right now. Try again in a minute, or play solo.</p>}

      {knob && (
        <div className="sp-stick" style={{ left: knob.x - 60, top: knob.y - 60 }} aria-hidden="true">
          <span style={{ transform: `translate(${knob.dx}px, ${knob.dy}px)` }} />
        </div>
      )}

      {me?.alive && (
        <div className="sp-pad" onTouchStart={e => e.stopPropagation()}>
          <div className="sp-guns">
            {GUNS.map(g => (
              <button
                key={g}
                type="button"
                className={`sp-chip ${input.current.weapon === g ? 'on' : ''}`}
                disabled={me.level < UNLOCK[g]}
                onClick={() => setIn({ weapon: g })}
              >
                {me.level < UNLOCK[g] ? `${WEAPON_LABEL[g]} (L${UNLOCK[g]})` : WEAPON_LABEL[g]}
              </button>
            ))}
          </div>
          <div className="sp-abilities">
            {ABILITIES.map(a => {
              const locked = me.level < UNLOCK[a.w];
              const ready = !locked && canAfford(a.w, me.dm, me.de) && (a.w !== 'gamma' || me.gammaReadyIn <= 0);
              return (
                <button key={a.w} type="button" className={`sp-ability ${ready ? 'is-ready' : ''}`} disabled={!ready} onClick={() => ability(a.w)} title={`${WEAPON_LABEL[a.w]}: ${a.cost}`}>
                  <span aria-hidden="true">{locked ? '🔒' : a.icon}</span>
                  <small>{locked ? `L${UNLOCK[a.w]}` : WEAPON_LABEL[a.w]}</small>
                </button>
              );
            })}
          </div>
          <div className="sp-main-btns">
            <button
              type="button"
              className="sp-boost"
              onTouchStart={() => (input.current.boost = true)}
              onTouchEnd={() => (input.current.boost = false)}
              onMouseDown={() => (input.current.boost = true)}
              onMouseUp={() => (input.current.boost = false)}
            >
              Boost
            </button>
            <button
              type="button"
              className="sp-fire"
              onTouchStart={() => (input.current.fire = true)}
              onTouchEnd={() => (input.current.fire = false)}
              onMouseDown={() => (input.current.fire = true)}
              onMouseUp={() => (input.current.fire = false)}
            >
              Fire
            </button>
          </div>
        </div>
      )}

      {portrait && !upright && (
        <div className="sp-rotate" onTouchStart={e => e.stopPropagation()}>
          <span className="sp-rotate-phone" aria-hidden="true" />
          <p>Turn your phone sideways to play.</p>
          <button type="button" className="btn btn-line" onClick={() => setUpright(true)}>
            Play upright
          </button>
          <button type="button" className="btn btn-line" onClick={onLeave}>
            Leave
          </button>
        </div>
      )}

      {me && !me.alive && (
        <div className="sp-dead">
          <p>{me.killedBy ? `${me.killedBy} got you.` : 'Your ship broke up.'}</p>
          <button type="button" className="btn btn-ink btn-lg" disabled={respawnIn > 0} onClick={() => src?.respawn()}>
            {respawnIn > 0 ? `Back in ${respawnIn}s` : 'Fly again'}
          </button>
          <button type="button" className="btn btn-line" onClick={onLeave}>
            Leave
          </button>
        </div>
      )}
    </div>
  );
}

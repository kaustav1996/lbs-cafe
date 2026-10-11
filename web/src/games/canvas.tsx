import { useEffect, useRef, useState } from 'react';
import { asset } from '../state/ui';
import { readBest, saveBest } from './shared';

/**
 * A small engine for the canvas mini games: a board of fixed logical size (360 wide) scaled to the screen,
 * a frame loop, taps and drags, score and best, pause when the phone looks away, and the start/over cover.
 */
export const W = 360;

export interface CanvasGameDef<S> {
  id: string;
  /** Board height for a 360-wide board. */
  height: number;
  scoreLabel: string;
  init(): S;
  /** Advance by dt seconds. Return false when the game is over. */
  step(s: S, dt: number): boolean;
  draw(ctx: CanvasRenderingContext2D, s: S, t: number): void;
  score(s: S): number;
  /** A tap or click on the board, in board coordinates. */
  tap?(s: S, x: number, y: number): void;
  /** Pointer movement over the board (paddles). */
  move?(s: S, x: number, y: number): void;
  startText: string;
  overText(score: number): string;
  /** Extra line under the board. */
  help?: string;
}

/** The Lemon Bandit logo, for drawing on canvases. */
let banditImg: HTMLImageElement | null = null;
export function bandit() {
  if (!banditImg) {
    banditImg = new Image();
    banditImg.src = asset('img/bandit-256.webp');
  }
  return banditImg;
}

export const PALETTE = ['#d0ff00', '#00bcc8', '#ff5fa2', '#ff9f1c', '#ffd84d', '#b388ff'];

export function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* fine */
  }
}

export function CanvasGame<S>({ game }: { game: CanvasGameDef<S> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const st = useRef<S>(game.init());
  const [state, setState] = useState<'ready' | 'playing' | 'paused' | 'over'>('ready');
  const stateRef = useRef(state);
  stateRef.current = state;
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBest(game.id));

  // Size and frame loop. Draws every frame (also behind the cover, so the board shows).
  useEffect(() => {
    bandit();
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.round(c.clientWidth * dpr);
      const ph = Math.round((c.clientWidth * game.height * dpr) / W);
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
      // Fixed 1/60 s steps, catching up after a slow frame (up to a quarter second), so speed doesn't depend on the phone.
      let acc = Math.min(0.25, (now - last) / 1000);
      last = now;
      const s = st.current;
      while (stateRef.current === 'playing' && acc > 0) {
        const dt = Math.min(1 / 60, acc);
        acc -= dt;
        if (!game.step(s, dt)) {
          const sc = game.score(s);
          setBest(saveBest(game.id, sc));
          stateRef.current = 'over';
          setState('over');
          buzz(140);
        }
      }
      const sc = game.score(s);
      if (sc !== shown) {
        shown = sc;
        setScore(sc);
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(pw / W, 0, 0, pw / W, 0, 0);
      game.draw(ctx, s, now / 1000);
    };
    raf = requestAnimationFrame(loop);
    const away = () => document.hidden && stateRef.current === 'playing' && setState('paused');
    document.addEventListener('visibilitychange', away);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', away);
    };
  }, [game]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * game.height] as const;
  };
  const start = () => {
    if (stateRef.current === 'over') st.current = game.init();
    setState('playing');
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const [x, y] = at(e);
    if (stateRef.current !== 'playing') return;
    game.move?.(st.current, x, y);
    game.tap?.(st.current, x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!game.move || stateRef.current !== 'playing') return;
    const [x, y] = at(e);
    game.move(st.current, x, y);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
      e.preventDefault();
      if (stateRef.current !== 'playing') return start();
      game.tap?.(st.current, W / 2, game.height / 2);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  return (
    <div className="game gcanvas">
      <div className="game-scores">
        <p>
          <span>{game.scoreLabel}</span>
          <b className="num">{score}</b>
        </p>
        <p>
          <span>Best</span>
          <b className="num">{best}</b>
        </p>
        <button type="button" className="btn btn-line btn-sm" onClick={() => (state === 'playing' ? setState('paused') : start())}>
          {state === 'playing' ? 'Pause' : state === 'over' ? 'Play again' : 'Play'}
        </button>
      </div>
      <div className="gcanvas-board" style={{ aspectRatio: `${W} / ${game.height}` }}>
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} aria-label={`${game.scoreLabel}: ${score}`} />
        {state !== 'playing' && (
          <div className="game-over">
            <p>{state === 'over' ? game.overText(score) : state === 'paused' ? 'Paused.' : game.startText}</p>
            <button type="button" className="btn btn-ink" onClick={start}>
              {state === 'over' ? 'Play again' : state === 'paused' ? 'Carry on' : 'Start'}
            </button>
          </div>
        )}
      </div>
      {game.help && <p className="game-help">{game.help}</p>}
    </div>
  );
}

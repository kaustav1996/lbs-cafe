import { useCallback, useEffect, useRef, useState } from 'react';
import { readBest, saveBest, useSwipe, type Dir } from './shared';

const N = 16; // cells per side
type P = { x: number; y: number };
const STEP: Record<Dir, P> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

function spot(snake: P[]): P {
  for (;;) {
    const p = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
    if (!snake.some(s => s.x === p.x && s.y === p.y)) return p;
  }
}

/** Snake: eat the lemons, don't hit the walls or your own tail. Swipe, use the pad, or the arrow keys. */
export default function Snake() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'ready' | 'playing' | 'paused' | 'over'>('ready');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBest('snake'));
  const game = useRef({ snake: [{ x: 7, y: 8 }, { x: 6, y: 8 }, { x: 5, y: 8 }] as P[], dir: 'right' as Dir, next: 'right' as Dir, food: { x: 11, y: 8 } as P, score: 0 });

  const draw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const size = c.width;
    const cell = size / N;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#0b0b0b';
    const lime = css.getPropertyValue('--lime').trim() || '#d0ff00';
    const cyan = css.getPropertyValue('--cyan').trim() || '#00bcc8';
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 1; i < N; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }
    const g = game.current;
    // The lemon.
    ctx.fillStyle = lime;
    ctx.beginPath();
    ctx.ellipse((g.food.x + 0.5) * cell, (g.food.y + 0.5) * cell, cell * 0.42, cell * 0.34, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.5, cell * 0.08);
    ctx.stroke();
    // The snake: a cyan tape with an ink head.
    g.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#ffffff' : cyan;
      const pad = i === 0 ? cell * 0.06 : cell * 0.12;
      ctx.beginPath();
      ctx.roundRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.25);
      ctx.fill();
    });
    const h = g.snake[0];
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc((h.x + 0.5) * cell, (h.y + 0.5) * cell, cell * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  // Size the canvas to its box, sharp on high-density screens.
  useEffect(() => {
    const fit = () => {
      const c = canvas.current;
      if (!c) return;
      const w = c.clientWidth * Math.min(window.devicePixelRatio || 1, 2);
      c.width = c.height = Math.round(w);
      draw();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [draw]);

  const tick = useCallback(() => {
    const g = game.current;
    g.dir = g.next;
    const h = g.snake[0];
    const n = { x: h.x + STEP[g.dir].x, y: h.y + STEP[g.dir].y };
    const eats = n.x === g.food.x && n.y === g.food.y;
    const body = eats ? g.snake : g.snake.slice(0, -1);
    if (n.x < 0 || n.y < 0 || n.x >= N || n.y >= N || body.some(s => s.x === n.x && s.y === n.y)) {
      setState('over');
      setBest(saveBest('snake', g.score));
      try {
        navigator.vibrate?.(120);
      } catch {
        /* fine */
      }
      return;
    }
    g.snake = [n, ...body];
    if (eats) {
      g.score += 1;
      setScore(g.score);
      g.food = spot(g.snake);
    }
    draw();
  }, [draw]);

  // Speeds up a little with every lemon.
  useEffect(() => {
    if (state !== 'playing') return;
    const t = setInterval(tick, Math.max(85, 170 - score * 4));
    const away = () => document.hidden && setState('paused');
    document.addEventListener('visibilitychange', away);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', away);
    };
  }, [state, tick, score]);

  const turn = useCallback(
    (d: Dir) => {
      const g = game.current;
      if (state === 'ready' || state === 'paused') setState('playing');
      if (state === 'over') return;
      if (d !== OPP[g.dir]) g.next = d;
    },
    [state],
  );
  useSwipe(wrap, turn);

  const restart = () => {
    game.current = { snake: [{ x: 7, y: 8 }, { x: 6, y: 8 }, { x: 5, y: 8 }], dir: 'right', next: 'right', food: { x: 11, y: 8 }, score: 0 };
    setScore(0);
    setState('playing');
    draw();
  };

  return (
    <div className="game gsnake">
      <div className="game-scores">
        <p>
          <span>Lemons</span>
          <b className="num">{score}</b>
        </p>
        <p>
          <span>Best</span>
          <b className="num">{best}</b>
        </p>
        <button type="button" className="btn btn-line btn-sm" onClick={() => (state === 'playing' ? setState('paused') : state === 'over' ? restart() : setState('playing'))}>
          {state === 'playing' ? 'Pause' : state === 'over' ? 'Play again' : 'Play'}
        </button>
      </div>
      <div className="gsnake-board" ref={wrap}>
        <canvas ref={canvas} aria-label={`Snake. ${score} lemons. Swipe or use the arrows to turn.`} />
        {state !== 'playing' && (
          <div className="game-over">
            <p>{state === 'over' ? `Out! ${score} ${score === 1 ? 'lemon' : 'lemons'}.` : state === 'paused' ? 'Paused.' : 'Swipe or tap an arrow to start.'}</p>
            <button type="button" className="btn btn-ink" onClick={state === 'over' ? restart : () => setState('playing')}>
              {state === 'over' ? 'Play again' : state === 'paused' ? 'Carry on' : 'Start'}
            </button>
          </div>
        )}
      </div>
      <div className="gpad" aria-label="Turn">
        <button type="button" className="gpad-up" onClick={() => turn('up')} aria-label="Up">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="gpad-left" onClick={() => turn('left')} aria-label="Left">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="gpad-right" onClick={() => turn('right')} aria-label="Right">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="gpad-down" onClick={() => turn('down')} aria-label="Down">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  );
}

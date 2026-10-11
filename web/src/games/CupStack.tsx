import { buzz, CanvasGame, PALETTE, W, type CanvasGameDef } from './canvas';

const H = 520;
const LAYER = 26;
const DEPTH = 14; // the 3D top face

interface Layer {
  x: number;
  w: number;
  color: string;
}
interface Bit {
  x: number;
  y: number;
  w: number;
  vy: number;
  color: string;
}
interface S {
  stack: Layer[];
  moving: Layer;
  dir: number;
  speed: number;
  cam: number; // how far the view has scrolled up, in px
  bits: Bit[]; // trimmed pieces falling away
  perfect: number; // time of the last perfect drop
  t: number;
  over: boolean;
  score: number;
}

const colorFor = (i: number) => PALETTE[i % PALETTE.length];
/** Screen y of layer i's top, given the camera. */
const yOf = (s: S, i: number) => H - 70 - (i + 1) * LAYER + s.cam;

function slab(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, glow = false) {
  // Front face.
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, LAYER);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x, y + LAYER * 0.55, w, LAYER * 0.45);
  // Top face, slanted back for depth, and lighter.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + DEPTH, y - DEPTH);
  ctx.lineTo(x + w + DEPTH, y - DEPTH);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  // Right side, darker.
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w + DEPTH, y - DEPTH);
  ctx.lineTo(x + w + DEPTH, y - DEPTH + LAYER);
  ctx.lineTo(x + w, y + LAYER);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = glow ? '#ffffff' : 'rgba(11,11,11,0.6)';
  ctx.lineWidth = glow ? 3 : 1.5;
  ctx.strokeRect(x, y, w, LAYER);
}

export const game: CanvasGameDef<S> = {
  id: 'stack',
  height: H,
  scoreLabel: 'Layers',
  startText: 'Tap to drop each layer onto the stack. Whatever hangs over gets cut off.',
  overText: n => `The stack is ${n} ${n === 1 ? 'layer' : 'layers'} tall.`,
  help: 'Tap the board, or press Space, to drop. A perfect drop keeps the full width.',
  init: () => ({
    stack: [{ x: 80, w: 200, color: '#0b0b0b' }],
    moving: { x: -200, w: 200, color: colorFor(1) },
    dir: 1,
    speed: 170,
    cam: 0,
    bits: [],
    perfect: -9,
    t: 0,
    over: false,
    score: 0,
  }),
  tap(s) {
    if (s.over) return;
    const top = s.stack[s.stack.length - 1];
    const m = s.moving;
    const left = Math.max(top.x, m.x);
    const right = Math.min(top.x + top.w, m.x + m.w);
    const y = yOf(s, s.stack.length);
    if (right - left <= 0) {
      s.bits.push({ x: m.x, y, w: m.w, vy: 0, color: m.color });
      s.over = true;
      return;
    }
    let placed: Layer;
    if (Math.abs(m.x - top.x) < 5) {
      placed = { x: top.x, w: top.w, color: m.color };
      s.perfect = s.t;
      buzz(25);
    } else {
      placed = { x: left, w: right - left, color: m.color };
      if (m.x < left) s.bits.push({ x: m.x, y, w: left - m.x, vy: 0, color: m.color });
      if (m.x + m.w > right) s.bits.push({ x: right, y, w: m.x + m.w - right, vy: 0, color: m.color });
    }
    s.stack.push(placed);
    s.score = s.stack.length - 1;
    s.speed = 170 + Math.min(230, s.score * 9);
    s.dir = s.score % 2 ? -1 : 1;
    s.moving = { x: s.dir > 0 ? -placed.w : W, w: placed.w, color: colorFor(s.stack.length) };
  },
  step(s, dt) {
    s.t += dt;
    const m = s.moving;
    if (!s.over) {
      m.x += s.dir * s.speed * dt;
      // Bounce at the edges of the board.
      if (m.x > W - m.w + 30 && s.dir > 0) s.dir = -1;
      if (m.x < -30 && s.dir < 0) s.dir = 1;
    }
    // Keep the top of the stack in view.
    const want = Math.max(0, (s.stack.length - 10) * LAYER);
    s.cam += (want - s.cam) * Math.min(1, dt * 5);
    for (const b of s.bits) {
      b.vy += 1400 * dt;
      b.y += b.vy * dt;
    }
    s.bits = s.bits.filter(b => b.y < H + 100);
    // End once the last missed layer has fallen away.
    return !(s.over && s.bits.length === 0);
  },
  draw(ctx, s) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#fbfaf5');
    bg.addColorStop(1, '#e9f4c0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Table top.
    const tableY = H - 70 + s.cam;
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, tableY, W, H);
    s.stack.forEach((l, i) => slab(ctx, l.x, yOf(s, i), l.w, l.color, i === s.stack.length - 1 && s.t - s.perfect < 0.35));
    for (const b of s.bits) slab(ctx, b.x, b.y, b.w, b.color);
    if (!s.over) slab(ctx, s.moving.x, yOf(s, s.stack.length), s.moving.w, s.moving.color);
    if (s.t - s.perfect < 0.6) {
      ctx.fillStyle = `rgba(11,11,11,${1 - (s.t - s.perfect) / 0.6})`;
      ctx.font = '800 22px Archivo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Perfect', W / 2, 90);
    }
    ctx.fillStyle = '#0b0b0b';
    ctx.font = '800 40px Archivo, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.score), W / 2, 56);
  },
  score: s => s.score,
};

/** Cup stack: drop each sliding layer onto the stack; overhang is trimmed. */
export default function CupStack() {
  return <CanvasGame game={game} />;
}

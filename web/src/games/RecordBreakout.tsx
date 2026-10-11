import { buzz, CanvasGame, PALETTE, W, type CanvasGameDef } from './canvas';

const H = 500;
const PAD_Y = H - 46;
const PAD_H = 16;
const BALL = 8;
const COLS = 7;
const ROWS = 5;
const BW = 44;
const BH = 22;
const GAPX = (W - COLS * BW) / (COLS + 1);

interface Brick {
  x: number;
  y: number;
  hp: number;
  color: string;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}
interface S {
  padX: number; // centre
  padW: number;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  stuck: boolean; // on the paddle, waiting for a tap
  bricks: Brick[];
  lives: number;
  level: number;
  score: number;
  sparks: Spark[];
  spin: number;
}

function wall(level: number): Brick[] {
  const out: Brick[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      // Later walls have gaps and tougher top rows.
      if (level > 1 && (r + c + level) % 5 === 0) continue;
      out.push({ x: GAPX + c * (BW + GAPX), y: 70 + r * (BH + 8), hp: r === 0 && level > 1 ? 2 : 1, color: PALETTE[(r + level) % PALETTE.length] });
    }
  return out;
}

const speedFor = (level: number) => 300 + level * 30;

function reset(s: S) {
  s.stuck = true;
  s.bx = s.padX;
  s.by = PAD_Y - BALL - 1;
  s.vx = 0;
  s.vy = 0;
}

/** A tape on the wall: cassette body, label, two reels. */
function tape(ctx: CanvasRenderingContext2D, b: Brick) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(b.x + 3, b.y + 4, BW, BH);
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, BW, BH, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(b.x + 2, b.y + 2, BW - 4, 3);
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(b.x + 6, b.y + 6, BW - 12, 9);
  ctx.fillStyle = '#0b0b0b';
  ctx.beginPath();
  ctx.arc(b.x + 16, b.y + 10.5, 3, 0, Math.PI * 2);
  ctx.arc(b.x + BW - 16, b.y + 10.5, 3, 0, Math.PI * 2);
  ctx.fill();
  if (b.hp > 1) {
    ctx.strokeStyle = '#0b0b0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, BW - 2, BH - 2);
  }
}

export const game: CanvasGameDef<S> = {
  id: 'breakout',
  height: H,
  scoreLabel: 'Tapes',
  startText: 'Slide to move the cassette. Tap to launch the record and break the tapes.',
  overText: n => `Out of records. ${n} ${n === 1 ? 'tape' : 'tapes'} broken.`,
  help: 'Drag or move the mouse to steer; tap to launch. Three records a game.',
  init: () => {
    const s: S = { padX: W / 2, padW: 78, bx: 0, by: 0, vx: 0, vy: 0, stuck: true, bricks: wall(1), lives: 3, level: 1, score: 0, sparks: [], spin: 0 };
    reset(s);
    return s;
  },
  move(s, x) {
    s.padX = Math.max(s.padW / 2, Math.min(W - s.padW / 2, x));
  },
  tap(s) {
    if (!s.stuck) return;
    s.stuck = false;
    const sp = speedFor(s.level);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    s.vx = Math.cos(a) * sp;
    s.vy = Math.sin(a) * sp;
  },
  step(s, dt) {
    s.spin += dt * 12;
    for (const p of s.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.life -= dt;
    }
    s.sparks = s.sparks.filter(p => p.life > 0);
    if (s.stuck) {
      s.bx = s.padX;
      return true;
    }
    // Small sub-steps so a fast record can't skip through a tape.
    const n = 3;
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      s.bx += s.vx * h;
      s.by += s.vy * h;
      if (s.bx < BALL) (s.bx = BALL), (s.vx = Math.abs(s.vx));
      if (s.bx > W - BALL) (s.bx = W - BALL), (s.vx = -Math.abs(s.vx));
      if (s.by < BALL) (s.by = BALL), (s.vy = Math.abs(s.vy));
      // Paddle: where it hits sets the angle.
      if (s.vy > 0 && s.by + BALL >= PAD_Y && s.by + BALL <= PAD_Y + PAD_H + 6 && Math.abs(s.bx - s.padX) < s.padW / 2 + BALL) {
        const k = (s.bx - s.padX) / (s.padW / 2);
        const sp = Math.hypot(s.vx, s.vy);
        const a = -Math.PI / 2 + k * 1.05;
        s.vx = Math.cos(a) * sp;
        s.vy = Math.sin(a) * sp;
        s.by = PAD_Y - BALL;
      }
      for (const b of s.bricks) {
        if (b.hp <= 0) continue;
        const nx = Math.max(b.x, Math.min(s.bx, b.x + BW));
        const ny = Math.max(b.y, Math.min(s.by, b.y + BH));
        if ((s.bx - nx) ** 2 + (s.by - ny) ** 2 > BALL * BALL) continue;
        // Bounce off the side it hit.
        if (Math.abs(s.bx - nx) > Math.abs(s.by - ny)) s.vx = -s.vx;
        else s.vy = -s.vy;
        b.hp--;
        if (b.hp <= 0) {
          s.score++;
          for (let k = 0; k < 8; k++) s.sparks.push({ x: b.x + BW / 2, y: b.y + BH / 2, vx: (Math.random() - 0.5) * 260, vy: (Math.random() - 0.8) * 220, life: 0.5, color: b.color });
        }
        break;
      }
    }
    s.bricks = s.bricks.filter(b => b.hp > 0);
    if (s.bricks.length === 0) {
      s.level++;
      s.bricks = wall(s.level);
      reset(s);
      buzz([30, 40, 30]);
    }
    if (s.by > H + BALL) {
      s.lives--;
      buzz(90);
      if (s.lives <= 0) return false;
      reset(s);
    }
    return true;
  },
  draw(ctx, s) {
    ctx.fillStyle = '#141416';
    ctx.fillRect(0, 0, W, H);
    // A record shelf look: faint vertical sleeves.
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < W; x += 24) ctx.fillRect(x, 0, 12, H);
    for (const b of s.bricks) tape(ctx, b);
    for (const p of s.sparks) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    // The paddle: a cassette lying flat, with a lit top edge.
    const px = s.padX - s.padW / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + 4, PAD_Y + 5, s.padW, PAD_H);
    ctx.fillStyle = '#00bcc8';
    ctx.beginPath();
    ctx.roundRect(px, PAD_Y, s.padW, PAD_H, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(px + 3, PAD_Y + 2, s.padW - 6, 3);
    ctx.fillStyle = '#0b0b0b';
    ctx.beginPath();
    ctx.arc(s.padX - 14, PAD_Y + PAD_H / 2 + 1, 3.5, 0, Math.PI * 2);
    ctx.arc(s.padX + 14, PAD_Y + PAD_H / 2 + 1, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // The ball: a spinning record with a lime label.
    ctx.save();
    ctx.translate(s.bx, s.by);
    ctx.rotate(s.spin);
    const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, BALL);
    g.addColorStop(0, '#555');
    g.addColorStop(1, '#050505');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, BALL, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d0ff00';
    ctx.beginPath();
    ctx.arc(0, 0, BALL * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, BALL * 0.7, 0, 1.2);
    ctx.stroke();
    ctx.restore();
    // Records left, and the level.
    for (let i = 0; i < s.lives; i++) {
      ctx.fillStyle = '#fbfaf5';
      ctx.beginPath();
      ctx.arc(18 + i * 20, 26, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d0ff00';
      ctx.beginPath();
      ctx.arc(18 + i * 20, 26, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '700 15px Archivo, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Wall ${s.level}`, W - 14, 31);
    if (s.stuck) {
      ctx.textAlign = 'center';
      ctx.fillText('Tap to launch', W / 2, PAD_Y - 40);
    }
  },
  score: s => s.score,
};

/** Record breakout: a cassette paddle, a vinyl ball and walls of tapes. */
export default function RecordBreakout() {
  return <CanvasGame game={game} />;
}

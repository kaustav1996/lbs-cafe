import { bandit, buzz, CanvasGame, W, type CanvasGameDef } from './canvas';

const H = 520;
const GROUND = H - 48;
const BX = 96; // the bandit's x
const R = 15; // hit radius
const TOWER_W = 62;
const GAP = 150;
const SPACING = 205;

interface Tower {
  x: number;
  gapY: number; // centre of the gap
  passed: boolean;
}
interface S {
  y: number;
  vy: number;
  towers: Tower[];
  score: number;
  speed: number;
  dist: number;
  flapAt: number;
  dead: boolean;
  t: number;
}

const newTower = (x: number): Tower => ({ x, gapY: 120 + Math.random() * (GROUND - 240), passed: false });

/** A tower of LB's takeaway cups: lid, sleeve, lemon logo dot. Bottom towers stand up, top ones hang down. */
function cupTower(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, hanging: boolean) {
  const cupH = 30;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 6, top, TOWER_W + 12, bottom - top);
  ctx.clip();
  const n = Math.ceil((bottom - top) / cupH) + 1;
  for (let i = 0; i < n; i++) {
    const y = hanging ? bottom - (i + 1) * cupH : top + i * cupH;
    const narrowTop = !hanging;
    const inset = 6;
    ctx.fillStyle = '#fbfaf5';
    ctx.strokeStyle = '#0b0b0b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (narrowTop) {
      ctx.moveTo(x + inset, y);
      ctx.lineTo(x + TOWER_W - inset, y);
      ctx.lineTo(x + TOWER_W - 2, y + cupH);
      ctx.lineTo(x + 2, y + cupH);
    } else {
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + TOWER_W - 2, y);
      ctx.lineTo(x + TOWER_W - inset, y + cupH);
      ctx.lineTo(x + inset, y + cupH);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Sleeve and a shaded side, for depth.
    ctx.fillStyle = '#00bcc8';
    ctx.fillRect(x + 6, y + cupH * 0.38, TOWER_W - 12, cupH * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x + TOWER_W * 0.68, y + 2, TOWER_W * 0.22, cupH - 4);
    ctx.fillStyle = '#d0ff00';
    ctx.beginPath();
    ctx.arc(x + TOWER_W / 2 - 4, y + cupH * 0.53, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // The lid at the open end.
  const ly = hanging ? bottom : top;
  ctx.fillStyle = '#0b0b0b';
  ctx.beginPath();
  ctx.roundRect(x - 5, hanging ? ly - 10 : ly, TOWER_W + 10, 10, 4);
  ctx.fill();
}

export const game: CanvasGameDef<S> = {
  id: 'flappy',
  height: H,
  scoreLabel: 'Towers',
  startText: 'Tap to flap. Fly the bandit between the cup towers.',
  overText: n => `Crashed after ${n} ${n === 1 ? 'tower' : 'towers'}.`,
  help: 'Tap the board, or press Space, to flap.',
  init: () => ({ y: H * 0.45, vy: -390, towers: [newTower(W + 80), newTower(W + 80 + SPACING)], score: 0, speed: 140, dist: 0, flapAt: -1, dead: false, t: 0 }),
  tap(s) {
    s.vy = -390;
    s.flapAt = s.t;
  },
  step(s, dt) {
    s.t += dt;
    s.vy = Math.min(560, s.vy + 1350 * dt);
    s.y += s.vy * dt;
    s.speed = 140 + Math.min(80, s.score * 3);
    s.dist += s.speed * dt;
    for (const t of s.towers) {
      t.x -= s.speed * dt;
      if (!t.passed && t.x + TOWER_W < BX - R) {
        t.passed = true;
        s.score++;
        if (s.score % 10 === 0) buzz(40);
      }
    }
    if (s.towers[0].x < -TOWER_W - 20) {
      s.towers.shift();
      s.towers.push(newTower(s.towers[s.towers.length - 1].x + SPACING));
    }
    if (s.y + R > GROUND || s.y - R < -40) return false;
    for (const t of s.towers) {
      if (BX + R < t.x || BX - R > t.x + TOWER_W) continue;
      // Circle against the two tower rectangles: nearest point on each.
      const hit = (top: number, bottom: number) => {
        const nx = Math.max(t.x, Math.min(BX, t.x + TOWER_W));
        const ny = Math.max(top, Math.min(s.y, bottom));
        return (BX - nx) ** 2 + (s.y - ny) ** 2 < R * R;
      };
      if (hit(-100, t.gapY - GAP / 2) || hit(t.gapY + GAP / 2, GROUND)) return false;
    }
    return true;
  },
  draw(ctx, s, now) {
    // Night sky over Salt Lake, with a neon glow low down.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d0f24');
    sky.addColorStop(0.75, '#2a1640');
    sky.addColorStop(1, '#4a1a4a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Stars.
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 40; i++) {
      const x = (((i * 97) % W) - (s.dist * 0.05) % W + W) % W;
      ctx.fillRect(x, (i * 53) % 260, 1.5, 1.5);
    }
    // Two layers of skyline, slow and slower.
    const skyline = (speed: number, base: number, color: string, seed: number) => {
      ctx.fillStyle = color;
      const off = (s.dist * speed) % 60;
      for (let i = -1; i < 8; i++) {
        const k = Math.abs(Math.sin((i + Math.floor((s.dist * speed) / 60)) * seed));
        const h = 40 + k * 110;
        ctx.fillRect(i * 60 - off, base - h, 52, h);
        // Lit windows.
        ctx.fillStyle = 'rgba(255, 216, 77, 0.35)';
        for (let wy = base - h + 10; wy < base - 8; wy += 16) ctx.fillRect(i * 60 - off + 10 + (k > 0.5 ? 16 : 0), wy, 6, 6);
        ctx.fillStyle = color;
      }
    };
    skyline(0.15, GROUND, '#1d1733', 3.7);
    skyline(0.35, GROUND, '#151025', 7.3);
    // Towers.
    for (const t of s.towers) {
      cupTower(ctx, t.x, 0, t.gapY - GAP / 2, true);
      cupTower(ctx, t.x, t.gapY + GAP / 2, GROUND, false);
    }
    // Ground: a lime-edged road with moving dashes.
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#d0ff00';
    ctx.fillRect(0, GROUND, W, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let x = -((s.dist % 40) + 40); x < W; x += 40) ctx.fillRect(x, GROUND + 22, 20, 4);
    // The bandit, tilting with its speed, with a flap squash and a shadow-ish glow.
    const img = bandit();
    const tilt = Math.max(-0.5, Math.min(1.1, s.vy / 500));
    const flap = s.t - s.flapAt < 0.12 ? 0.85 : 1;
    ctx.save();
    ctx.translate(BX, s.y);
    ctx.rotate(tilt);
    ctx.scale(1, flap);
    ctx.shadowColor = 'rgba(208,255,0,0.6)';
    ctx.shadowBlur = 12;
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -26, -20, 52, 40);
    else {
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath();
      ctx.arc(0, 0, R + 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Big score.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '800 40px Archivo, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.score), W / 2, 64);
    void now;
  },
  score: s => s.score,
};

/** Flappy Bandit: tap to flap the Lemon Bandit between towers of LB's cups. */
export default function FlappyBandit() {
  return <CanvasGame game={game} />;
}

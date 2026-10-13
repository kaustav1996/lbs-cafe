import { sfx } from './sound';
import { bandit, buzz, CanvasGame, W, type CanvasGameDef } from './canvas';

const H = 520;
const GROUND = H - 48;
const BX = 96; // the bandit's x
const R = 15; // hit radius
const TOWER_W = 62;
const PER_LEVEL = 10; // towers per level

/** Each level is a different stretch of Kolkata at night, with a narrower gap and more speed. */
const LEVELS = [
  { name: 'Salt Lake', sky: ['#0d0f24', '#2a1640', '#4a1a4a'], mark: 'towers' },
  { name: 'Park Street', sky: ['#120a1f', '#3a1238', '#7a1f4a'], mark: 'lights' },
  { name: 'Howrah Bridge', sky: ['#07131f', '#14324a', '#2a5a6a'], mark: 'bridge' },
  { name: 'Victoria Memorial', sky: ['#0b0b1c', '#22224a', '#4a3a6a'], mark: 'dome' },
  { name: 'Eden Gardens', sky: ['#05140f', '#0f3a2a', '#2a5a3a'], mark: 'stadium' },
  { name: 'Esplanade', sky: ['#1a0a05', '#4a1f0f', '#8a3a1a'], mark: 'tram' },
] as const;
const levelOf = (score: number) => 1 + Math.floor(score / PER_LEVEL);
const look = (level: number) => LEVELS[(level - 1) % LEVELS.length];
const gapFor = (level: number) => Math.max(108, 152 - (level - 1) * 8);
const speedFor = (level: number, score: number) => Math.min(270, 140 + (level - 1) * 18 + (score % PER_LEVEL) * 2);
const SPACING = 205;

interface Tower {
  x: number;
  gapY: number; // centre of the gap
  gap: number;
  /** From level 3 some towers drift up and down. */
  sway: number;
  phase: number;
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

function newTower(x: number, level: number): Tower {
  const gap = gapFor(level);
  const sway = level >= 3 && Math.random() < 0.25 + level * 0.08 ? 24 + Math.min(40, level * 6) : 0;
  const margin = 90 + sway;
  return { x, gapY: margin + gap / 2 + Math.random() * (GROUND - 2 * margin - gap), gap, sway, phase: Math.random() * 6, passed: false };
}
const gapAt = (t: Tower, time: number) => t.gapY + Math.sin(time * 1.6 + t.phase) * t.sway;

/** The far-off landmark for each level, drifting very slowly. */
function landmark(ctx: CanvasRenderingContext2D, mark: string, dist: number) {
  const x = W * 0.62 - ((dist * 0.04) % (W + 260)) + 130;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 3;
  const base = GROUND - 60;
  if (mark === 'bridge') {
    // Howrah Bridge: two tall pylons and a cantilever truss.
    for (const px of [x - 90, x + 90]) ctx.fillRect(px - 8, base - 170, 16, 170);
    ctx.beginPath();
    ctx.moveTo(x - 200, base - 40);
    ctx.lineTo(x - 90, base - 170);
    ctx.lineTo(x, base - 90);
    ctx.lineTo(x + 90, base - 170);
    ctx.lineTo(x + 200, base - 40);
    for (let i = -180; i <= 180; i += 30) {
      ctx.moveTo(x + i, base - 40);
      ctx.lineTo(x + i + 15, base - 110 + Math.abs(i) * 0.3);
    }
    ctx.stroke();
    ctx.fillRect(x - 210, base - 44, 420, 8);
  } else if (mark === 'dome') {
    // Victoria Memorial: a wide hall and a dome with an angel on top.
    ctx.fillRect(x - 120, base - 60, 240, 60);
    ctx.beginPath();
    ctx.arc(x, base - 60, 55, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x - 3, base - 140, 6, 30);
    for (const px of [x - 110, x + 110]) {
      ctx.beginPath();
      ctx.arc(px, base - 60, 16, Math.PI, 0);
      ctx.fill();
    }
  } else if (mark === 'stadium') {
    // Eden Gardens: a stadium bowl with floodlights.
    ctx.beginPath();
    ctx.ellipse(x, base, 170, 50, 0, Math.PI, 0);
    ctx.fill();
    for (const px of [x - 150, x + 150]) {
      ctx.fillRect(px - 2, base - 150, 4, 110);
      ctx.fillStyle = 'rgba(255,255,220,0.35)';
      ctx.fillRect(px - 14, base - 160, 28, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
    }
  } else if (mark === 'tram') {
    // Esplanade: a tram on its wires.
    ctx.beginPath();
    ctx.moveTo(x - 260, base - 80);
    ctx.lineTo(x + 260, base - 80);
    ctx.stroke();
    ctx.fillRect(x - 70, base - 50, 140, 50);
    ctx.beginPath();
    ctx.moveTo(x, base - 50);
    ctx.lineTo(x + 20, base - 80);
    ctx.stroke();
  } else if (mark === 'lights') {
    // Park Street: strings of fairy lights.
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 16; i++) {
        const lx = x - 220 + i * 28;
        ctx.fillStyle = `rgba(255, 216, 77, ${0.25 + 0.2 * Math.sin(i + r + dist * 0.02)})`;
        ctx.beginPath();
        ctx.arc(lx, base - 150 + r * 34 + Math.sin(i * 0.8) * 8, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // Salt Lake: glass office towers.
    for (const [dx, hh] of [[-120, 180], [-60, 230], [10, 200], [80, 250]]) ctx.fillRect(x + dx, base - hh, 46, hh);
  }
}

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
  init: () => ({ y: H * 0.45, vy: -390, towers: [newTower(W + 80, 1), newTower(W + 80 + SPACING, 1)], score: 0, speed: 140, dist: 0, flapAt: -1, dead: false, t: 0 }),
  tap(s) {
    s.vy = -390;
    s.flapAt = s.t;
    sfx('flap');
  },
  step(s, dt) {
    s.t += dt;
    s.vy = Math.min(560, s.vy + 1350 * dt);
    s.y += s.vy * dt;
    s.speed = speedFor(levelOf(s.score), s.score);
    s.dist += s.speed * dt;
    for (const t of s.towers) {
      t.x -= s.speed * dt;
      if (!t.passed && t.x + TOWER_W < BX - R) {
        t.passed = true;
        s.score++;
        sfx('point');
        if (s.score % 10 === 0) buzz(40);
      }
    }
    if (s.towers[0].x < -TOWER_W - 20) {
      s.towers.shift();
      // Towers already on screen keep their gap; new ones use the current level.
      s.towers.push(newTower(s.towers[s.towers.length - 1].x + SPACING, levelOf(s.score + s.towers.filter(t => !t.passed).length)));
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
      const gy = gapAt(t, s.t);
      if (hit(-100, gy - t.gap / 2) || hit(gy + t.gap / 2, GROUND)) return false;
    }
    return true;
  },
  draw(ctx, s, now) {
    // Night sky over Salt Lake, with a neon glow low down.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    const lv = look(levelOf(s.score));
    sky.addColorStop(0, lv.sky[0]);
    sky.addColorStop(0.75, lv.sky[1]);
    sky.addColorStop(1, lv.sky[2]);
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
    landmark(ctx, lv.mark, s.dist);
    skyline(0.15, GROUND, '#1d1733', 3.7);
    skyline(0.35, GROUND, '#151025', 7.3);
    // Towers.
    for (const t of s.towers) {
      const gy = gapAt(t, s.t);
      cupTower(ctx, t.x, 0, gy - t.gap / 2, true);
      cupTower(ctx, t.x, gy + t.gap / 2, GROUND, false);
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
  level: s => levelOf(s.score),
  levelName: n => `Level ${n}: ${look(n).name}`,
};

/** Flappy Bandit: tap to flap the Lemon Bandit between towers of LB's cups. */
export default function FlappyBandit() {
  return <CanvasGame game={game} />;
}

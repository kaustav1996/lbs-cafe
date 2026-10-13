import { sfx } from './sound';
import { bandit, buzz, CanvasGame, W, type CanvasGameDef } from './canvas';

const H = 490;
const ROUND = 30; // seconds
const CUP_R = 42;
const SPOTS = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => ({ x: 70 + c * 110, y: 150 + r * 128 })));

type Kind = 'bandit' | 'gold' | 'lemon';
interface Pop {
  spot: number;
  kind: Kind;
  born: number;
  stay: number;
  hit: number; // time it was tapped, or -1
}
interface Float {
  x: number;
  y: number;
  text: string;
  born: number;
  good: boolean;
}
interface S {
  t: number;
  pops: Pop[];
  next: number;
  score: number;
  floats: Float[];
  chappal: { x: number; y: number; at: number } | null;
  level: number;
  /** Points this round, towards the target. */
  roundPts: number;
  /** When this round's clock started (rounds start after a short break). */
  roundStart: number;
}

/** Points needed in a round to reach the next level. */
const target = (level: number) => 10 + level * 4;

export const game: CanvasGameDef<S> = {
  id: 'whack',
  height: H,
  scoreLabel: 'Points',
  startText: `Bandits are raiding the cups. Tap them before they duck back down, and leave the lemons alone. Score ${10 + 4} in 30 seconds to reach level 2.`,
  overText: n => `Time’s up. You missed the target. ${n} ${n === 1 ? 'point' : 'points'} in all.`,
  help: 'Bandit 1 point, golden bandit 3, lemon minus 2. Each level is 30 seconds; reach the target to go on.',
  init: () => ({ t: 0, pops: [], next: 0.6, score: 0, floats: [], chappal: null, level: 1, roundPts: 0, roundStart: 0 }),
  tap(s, x, y) {
    s.chappal = { x, y, at: s.t };
    sfx('slide');
    for (const p of s.pops) {
      if (p.hit >= 0) continue;
      const sp = SPOTS[p.spot];
      if (Math.hypot(x - sp.x, y - (sp.y - 30)) > 46) continue;
      p.hit = s.t;
      const pts = p.kind === 'gold' ? 3 : p.kind === 'lemon' ? -2 : 1;
      s.score = Math.max(0, s.score + pts);
      s.roundPts = Math.max(0, s.roundPts + pts);
      s.floats.push({ x: sp.x, y: sp.y - 70, text: pts > 0 ? `+${pts}` : `${pts}`, born: s.t, good: pts > 0 });
      buzz(pts > 0 ? 20 : [40, 30, 40]);
      sfx(pts < 0 ? 'bad' : pts > 1 ? 'coin' : 'bonk');
      return;
    }
  },
  step(s, dt) {
    s.t += dt;
    const rt = s.t - s.roundStart;
    if (rt < 0) return true; // the break between levels
    if (rt >= ROUND) {
      if (s.roundPts < target(s.level)) return false;
      s.level++;
      s.roundPts = 0;
      s.pops = [];
      s.roundStart = s.t + 2;
      s.next = s.roundStart + 0.4;
      return true;
    }
    // Faster and shorter pops as the round goes on, and in every level.
    const pace = Math.min(1.6, rt / ROUND + (s.level - 1) * 0.18);
    if (s.t >= s.next) {
      const free = SPOTS.map((_, i) => i).filter(i => !s.pops.some(p => p.spot === i));
      if (free.length) {
        const r = Math.random();
        const kind: Kind = r < 0.1 ? 'gold' : r < 0.25 + Math.min(0.15, s.level * 0.03) ? 'lemon' : 'bandit';
        s.pops.push({ spot: free[Math.floor(Math.random() * free.length)], kind, born: s.t, stay: Math.max(0.38, (kind === 'gold' ? 0.7 : 1.1) - pace * 0.4), hit: -1 });
      }
      s.next = s.t + Math.max(0.28, 0.75 - pace * 0.35) + Math.random() * 0.25;
    }
    s.pops = s.pops.filter(p => (p.hit >= 0 ? s.t - p.hit < 0.25 : s.t - p.born < p.stay + 0.3));
    s.floats = s.floats.filter(f => s.t - f.born < 0.7);
    return true;
  },
  draw(ctx, s) {
    ctx.fillStyle = '#ffd84d';
    ctx.fillRect(0, 0, W, H);
    // Table stripes.
    ctx.fillStyle = 'rgba(11,11,11,0.06)';
    for (let x = -H; x < W; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
      ctx.lineTo(x + H + 14, 0);
      ctx.lineTo(x + 14, H);
      ctx.fill();
    }
    // Timer bar.
    const left = Math.max(0, Math.min(ROUND, ROUND - (s.t - s.roundStart)));
    ctx.fillStyle = '#0b0b0b';
    ctx.beginPath();
    ctx.roundRect(16, 18, W - 32, 14, 7);
    ctx.fill();
    ctx.fillStyle = left < 5 ? '#ff5fa2' : '#d0ff00';
    ctx.beginPath();
    ctx.roundRect(18, 20, ((W - 36) * left) / ROUND, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#0b0b0b';
    ctx.font = '800 15px Archivo, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(left)} s`, W - 16, 52);
    // Progress to this level's target.
    const goal = target(s.level);
    ctx.textAlign = 'left';
    ctx.fillStyle = s.roundPts >= goal ? '#1a7a00' : '#0b0b0b';
    ctx.fillText(s.roundPts >= goal ? `Target ${goal} reached` : `Target ${s.roundPts} of ${goal}`, 16, 52);
    const img = bandit();
    SPOTS.forEach((sp, i) => {
      // The back of the cup (rim), so pop-ups come out of it.
      ctx.fillStyle = '#0b0b0b';
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y - 18, CUP_R, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      const p = s.pops.find(q => q.spot === i);
      if (p) {
        // Rise, stay, sink (or drop fast when hit).
        const age = s.t - p.born;
        let up = Math.min(1, age / 0.12);
        if (p.hit >= 0) up = Math.max(0, 1 - (s.t - p.hit) / 0.2);
        else if (age > p.stay) up = Math.max(0, 1 - (age - p.stay) / 0.3);
        ctx.save();
        ctx.beginPath();
        ctx.rect(sp.x - CUP_R - 10, sp.y - 110, CUP_R * 2 + 20, 92);
        ctx.clip();
        const y = sp.y - 18 + 62 * (1 - up) - 36;
        if (p.kind === 'lemon') {
          ctx.fillStyle = '#d0ff00';
          ctx.beginPath();
          ctx.ellipse(sp.x, y, 28, 22, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0b0b0b';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = '#5a8a00';
          ctx.beginPath();
          ctx.ellipse(sp.x + 18, y - 20, 10, 5, -0.8, 0, Math.PI * 2);
          ctx.fill();
        } else {
          if (p.kind === 'gold') {
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 18;
          }
          if (img.complete && img.naturalWidth) ctx.drawImage(img, sp.x - 31, y - 24, 62, 48);
          ctx.shadowBlur = 0;
          if (p.kind === 'gold') {
            // A gold crown: worth three.
            ctx.fillStyle = '#ffc400';
            ctx.strokeStyle = '#0b0b0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sp.x - 16, y - 24);
            ctx.lineTo(sp.x - 16, y - 40);
            ctx.lineTo(sp.x - 8, y - 31);
            ctx.lineTo(sp.x, y - 44);
            ctx.lineTo(sp.x + 8, y - 31);
            ctx.lineTo(sp.x + 16, y - 40);
            ctx.lineTo(sp.x + 16, y - 24);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          if (p.hit >= 0) {
            // Stars round a bonked bandit.
            ctx.fillStyle = '#ffffff';
            for (let k = 0; k < 3; k++) {
              const a = s.t * 10 + k * 2.1;
              ctx.fillRect(sp.x + Math.cos(a) * 34 - 3, y - 26 + Math.sin(a) * 8 - 3, 6, 6);
            }
          }
        }
        ctx.restore();
        ctx.shadowBlur = 0;
      }
      // The front of the cup, with a shaded side and LB's sleeve.
      const g = ctx.createLinearGradient(sp.x - CUP_R, 0, sp.x + CUP_R, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.6, '#f1efe6');
      g.addColorStop(1, '#c9c6b8');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#0b0b0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sp.x - CUP_R, sp.y - 18);
      ctx.lineTo(sp.x + CUP_R, sp.y - 18);
      ctx.lineTo(sp.x + CUP_R - 9, sp.y + 34);
      ctx.lineTo(sp.x - CUP_R + 9, sp.y + 34);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#00bcc8';
      ctx.fillRect(sp.x - CUP_R + 5, sp.y - 2, CUP_R * 2 - 10, 16);
      ctx.fillStyle = '#0b0b0b';
      ctx.font = '800 11px Archivo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LB’s', sp.x, sp.y + 10);
    });
    for (const f of s.floats) {
      const k = (s.t - f.born) / 0.7;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.good ? '#0b0b0b' : '#d4145a';
      ctx.font = '800 24px Archivo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y - k * 30);
    }
    ctx.globalAlpha = 1;
    // The chappal swing where you tapped.
    if (s.chappal && s.t - s.chappal.at < 0.15) {
      const { x, y } = s.chappal;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.6 + ((s.t - s.chappal.at) / 0.15) * 0.6);
      ctx.fillStyle = '#ff9f1c';
      ctx.strokeStyle = '#0b0b0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -14, 13, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -22);
      ctx.lineTo(0, -8);
      ctx.lineTo(9, -22);
      ctx.stroke();
      ctx.restore();
    }
  },
  score: s => s.score,
  level: s => s.level,
  levelName: n => `Level ${n}: ${target(n)} points to pass`,
};

/** Whack-a-bandit: bonk the bandits popping out of LB's cups with a chappal; don't hit the lemons. */
export default function WhackBandit() {
  return <CanvasGame game={game} />;
}

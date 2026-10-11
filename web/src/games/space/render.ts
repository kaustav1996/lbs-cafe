import type { Planet, Snapshot } from './engine';

/** Two snapshots and how far between them to draw (0 to 1), for smooth motion at 60 fps from 20 updates. */
export interface Frame {
  prev: Snapshot | null;
  curr: Snapshot;
  alpha: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** A fixed starfield, three layers deep for parallax. */
const STARS = (() => {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 260 }, () => ({ x: r() * 2000, y: r() * 2000, z: 0.15 + r() * 0.5, a: 0.3 + r() * 0.7 }));
})();

/** Asteroid outline from its seed: jagged but the same on every phone. */
function rockShape(seed: number) {
  let s = seed || 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 11 }, (_, i) => ({ a: (i / 11) * Math.PI * 2, k: 0.72 + r() * 0.36 }));
}
const shapes = new Map<number, ReturnType<typeof rockShape>>();

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: Frame, planets: Planet[], size: number, nowMs: number, dpr = 1) {
  const { prev, curr, alpha } = f;
  const me = curr.me;
  const pm = prev?.me;
  const cx = me ? (pm ? lerp(pm.x, me.x, alpha) : me.x) : size / 2;
  const cy = me ? (pm ? lerp(pm.y, me.y, alpha) : me.y) : size / 2;
  const myR = me ? 8 + Math.sqrt(Math.max(me.mass, 1)) * 2.4 : 20;
  // Zoom out as you grow.
  const scale = Math.sqrt(w * h) / (2 * (250 + myR * 4));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, w, h);
  // Stars (screen space, parallax).
  for (const st of STARS) {
    const x = (((st.x - cx * st.z * 0.2) % 2000) + 2000) % 2000;
    const y = (((st.y - cy * st.z * 0.2) % 2000) + 2000) % 2000;
    ctx.globalAlpha = st.a;
    ctx.fillStyle = '#cfd8ff';
    ctx.fillRect((x / 2000) * w, (y / 2000) * h, st.z * 3, st.z * 3);
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (w / 2 - cx * scale) * dpr, (h / 2 - cy * scale) * dpr);
  // The edge of space.
  ctx.strokeStyle = 'rgba(255, 95, 162, 0.6)';
  ctx.lineWidth = 6 / scale;
  ctx.setLineDash([30, 20]);
  ctx.strokeRect(0, 0, size, size);
  ctx.setLineDash([]);
  // Faint grid.
  ctx.strokeStyle = 'rgba(80, 110, 255, 0.08)';
  ctx.lineWidth = 1 / scale;
  const g = 250;
  const viewW = w / scale / 2 + g;
  const viewH = h / scale / 2 + g;
  ctx.beginPath();
  for (let x = Math.floor((cx - viewW) / g) * g; x < cx + viewW; x += g) {
    ctx.moveTo(x, cy - viewH);
    ctx.lineTo(x, cy + viewH);
  }
  for (let y = Math.floor((cy - viewH) / g) * g; y < cy + viewH; y += g) {
    ctx.moveTo(cx - viewW, y);
    ctx.lineTo(cx + viewW, y);
  }
  ctx.stroke();

  // Planets: gravity halo, body, ring.
  for (const p of planets) {
    if (Math.abs(p.x - cx) > viewW + p.r * 5 || Math.abs(p.y - cy) > viewH + p.r * 5) continue;
    const halo = ctx.createRadialGradient(p.x, p.y, p.r, p.x, p.y, p.r * 5);
    halo.addColorStop(0, `hsla(${p.hue}, 80%, 60%, 0.12)`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
    body.addColorStop(0, `hsl(${p.hue}, 70%, 70%)`);
    body.addColorStop(1, `hsl(${p.hue}, 60%, 25%)`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    if (p.ring) {
      ctx.strokeStyle = `hsla(${(p.hue + 40) % 360}, 80%, 75%, 0.7)`;
      ctx.lineWidth = p.r * 0.12;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.7, p.r * 0.45, -0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Particles.
  for (const [k, x, y] of curr.p as [string, number, number][]) {
    if (k === 'm') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const col = k === 'd' ? '179, 136, 255' : '0, 229, 255';
      const pulse = 4 + Math.sin(nowMs / 250 + x) * 1.2;
      ctx.fillStyle = `rgba(${col}, 0.25)`;
      ctx.beginPath();
      ctx.arc(x, y, pulse * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${col})`;
      ctx.beginPath();
      ctx.arc(x, y, pulse * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Asteroids (interpolated).
  const prevRocks = new Map((prev?.a ?? []).map(a => [a[0] as number, a]));
  for (const a of curr.a as number[][]) {
    const [id, x, y, r, rot, seed] = a;
    const pa = prevRocks.get(id);
    const ax = pa ? lerp(pa[1], x, alpha) : x;
    const ay = pa ? lerp(pa[2], y, alpha) : y;
    const ar = pa ? lerpAngle(pa[4], rot, alpha) : rot;
    let shape = shapes.get(seed);
    if (!shape) shapes.set(seed, (shape = rockShape(seed)));
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ar);
    ctx.beginPath();
    shape.forEach((v, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, Math.cos(v.a) * r * v.k, Math.sin(v.a) * r * v.k));
    ctx.closePath();
    ctx.fillStyle = '#2b2e3b';
    ctx.fill();
    ctx.strokeStyle = '#9aa3c7';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // Gamma-ray beams.
  for (const [x1, y1, x2, y2, wd] of curr.g as number[][]) {
    ctx.strokeStyle = 'rgba(105, 240, 174, 0.35)';
    ctx.lineWidth = wd * 2.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = '#eaffef';
    ctx.lineWidth = wd * 0.6;
    ctx.stroke();
  }

  // Bullets.
  for (const [kind, x, y, mine] of curr.b as number[][]) {
    if (kind === 1) {
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 159, 28, 0.3)';
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = mine ? '#d0ff00' : '#ff5f5f';
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ships (interpolated).
  const prevShips = new Map((prev?.s ?? []).map(s => [s[0] as string, s]));
  for (const s of curr.s as (string | number)[][]) {
    const [id, x, y, r, dir, color, name, flags, level] = s as [string, number, number, number, number, string, string, number, number];
    const ps = prevShips.get(id) as typeof s | undefined;
    const sx = ps ? lerp(ps[1] as number, x, alpha) : x;
    const sy = ps ? lerp(ps[2] as number, y, alpha) : y;
    const sr = ps ? lerp(ps[3] as number, r, alpha) : r;
    const sd = ps ? lerpAngle(ps[4] as number, dir, alpha) : dir;
    drawShip(ctx, sx, sy, sr, sd, color, name, flags, level, nowMs, scale);
  }
}

function drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dir: number, color: string, name: string, flags: number, level: number, t: number, scale: number) {
  const boost = flags & 1;
  const shield = flags & 2;
  const hole = flags & 4;
  const light = flags & 8;
  const safe = flags & 16;
  if (hole) {
    // A swirling black hole around the ship.
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(179, 136, 255, ${0.5 - i * 0.1})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6 + i * 40 + ((t / 8) % 40), t / 300 + i, t / 300 + i + Math.PI * 1.3);
      ctx.stroke();
    }
  }
  if (light) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(dir) * r + Math.sin(dir) * i * r * 0.3, y - Math.sin(dir) * r - Math.cos(dir) * i * r * 0.3);
      ctx.lineTo(x - Math.cos(dir) * r * 5 + Math.sin(dir) * i * r * 0.3, y - Math.sin(dir) * r * 5 - Math.cos(dir) * i * r * 0.3);
      ctx.stroke();
    }
  }
  if (boost) {
    ctx.fillStyle = 'rgba(255, 159, 28, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(dir) * r * 0.8 + Math.sin(dir) * r * 0.4, y - Math.sin(dir) * r * 0.8 - Math.cos(dir) * r * 0.4);
    ctx.lineTo(x - Math.cos(dir) * r * (1.8 + Math.random() * 0.4), y - Math.sin(dir) * r * (1.8 + Math.random() * 0.4));
    ctx.lineTo(x - Math.cos(dir) * r * 0.8 - Math.sin(dir) * r * 0.4, y - Math.sin(dir) * r * 0.8 + Math.cos(dir) * r * 0.4);
    ctx.fill();
  }
  ctx.globalAlpha = safe && Math.floor(t / 150) % 2 ? 0.4 : 1;
  // A faint ring for the hull's size (what eats and gets eaten), and a retro delta ship inside it.
  ctx.strokeStyle = color;
  ctx.globalAlpha *= 0.35;
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = safe && Math.floor(t / 150) % 2 ? 0.4 : 1;
  const pt = (a: number, d: number): [number, number] => [x + Math.cos(dir + a) * r * d, y + Math.sin(dir + a) * r * d];
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(...pt(0, 1.15));
  ctx.lineTo(...pt(2.45, 1));
  ctx.lineTo(...pt(Math.PI, 0.45));
  ctx.lineTo(...pt(-2.45, 1));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Cockpit.
  ctx.fillStyle = 'rgba(5, 6, 15, 0.7)';
  ctx.beginPath();
  ctx.moveTo(...pt(0, 0.65));
  ctx.lineTo(...pt(2.2, 0.32));
  ctx.lineTo(...pt(-2.2, 0.32));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  if (shield) {
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r + 14 + Math.sin(t / 120) * 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Name and level, kept readable however far out you're zoomed.
  const fs = Math.max(13 / scale, r * 0.45);
  ctx.font = `700 ${fs}px Archivo, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${name}  L${level}`, x, y - r - fs * 0.6);
}

/** The mini-map: everyone's position on the whole map. */
export function drawMini(ctx: CanvasRenderingContext2D, px: number, size: number, mini: (number | string)[][], planets: Planet[], meX: number, meY: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  ctx.fillStyle = 'rgba(5, 6, 15, 0.75)';
  ctx.fillRect(0, 0, px, px);
  const k = px / size;
  for (const p of planets) {
    ctx.fillStyle = `hsl(${p.hue}, 60%, 45%)`;
    ctx.beginPath();
    ctx.arc(p.x * k, p.y * k, Math.max(2, p.r * k), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y, color, r] of mini as [number, number, string, number][]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * k, y * k, Math.max(1.6, r * k * 1.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(meX * k, meY * k, 5, 0, Math.PI * 2);
  ctx.stroke();
}

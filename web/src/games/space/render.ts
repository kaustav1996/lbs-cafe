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

/** Asteroid outline and craters from its seed: the same on every phone. */
function rockShape(seed: number) {
  let s = seed || 1;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = Array.from({ length: 11 }, (_, i) => ({ a: (i / 11) * Math.PI * 2, k: 0.72 + r() * 0.36 }));
  const craters = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({ a: r() * Math.PI * 2, d: r() * 0.45, s: 0.1 + r() * 0.14 }));
  return { pts, craters };
}

/** Everything is lit from the top left; surfaces facing it are brighter. Returns 0 (dark) to 1 (lit). */
const LIGHT = { x: -0.5, y: -0.5, z: 0.707 };
function lit(nx: number, ny: number, tilt = 0.6) {
  const up = Math.sqrt(1 - tilt * tilt);
  return Math.max(0, nx * tilt * LIGHT.x + ny * tilt * LIGHT.y + up * LIGHT.z);
}
/** Paint over a filled path to light or shade it. */
function tone(ctx: CanvasRenderingContext2D, l: number, mid = 0.57) {
  ctx.fillStyle = l > mid ? `rgba(255,255,255,${Math.min(0.55, (l - mid) * 1.1)})` : `rgba(0,0,0,${Math.min(0.7, (mid - l) * 1.3)})`;
  ctx.fill();
}

/** Pre-drawn shaded orbs (matter, dark matter, dark energy, shots), so a screen full of them stays cheap. */
const sprites = new Map<string, HTMLCanvasElement>();
function orb(key: string, core: string, edge: string, glow: string | null) {
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const R = glow ? 14 : 30;
  if (glow) {
    const h = g.createRadialGradient(32, 32, R * 0.6, 32, 32, 32);
    h.addColorStop(0, glow);
    h.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = h;
    g.fillRect(0, 0, 64, 64);
  }
  const b = g.createRadialGradient(32 - R * 0.4, 32 - R * 0.45, R * 0.08, 32, 32, R);
  b.addColorStop(0, '#ffffff');
  b.addColorStop(0.25, core);
  b.addColorStop(1, edge);
  g.fillStyle = b;
  g.beginPath();
  g.arc(32, 32, R, 0, Math.PI * 2);
  g.fill();
  sprites.set(key, c);
  return c;
}
const ORB = {
  m: () => orb('m', '#e8ecff', '#6c7290', null),
  d: () => orb('d', '#c59bff', '#3d1a7a', 'rgba(179,136,255,0.55)'),
  e: () => orb('e', '#7ff6ff', '#00606e', 'rgba(0,229,255,0.5)'),
  mine: () => orb('mine', '#eaff7a', '#4f6600', 'rgba(208,255,0,0.6)'),
  foe: () => orb('foe', '#ff9a9a', '#7a1010', 'rgba(255,95,95,0.6)'),
  missile: () => orb('missile', '#ffc46b', '#8a3c00', 'rgba(255,159,28,0.6)'),
};
const shapes = new Map<number, ReturnType<typeof rockShape>>();

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: Frame, planets: Planet[], size: number, nowMs: number, dpr = 1) {
  const { prev, curr, alpha } = f;
  const me = curr.me;
  const pm = prev?.me;
  const cx = me ? (pm ? lerp(pm.x, me.x, alpha) : me.x) : size / 2;
  const cy = me ? (pm ? lerp(pm.y, me.y, alpha) : me.y) : size / 2;
  const myR = me ? 8 + Math.sqrt(Math.max(me.mass, 1)) * 2.4 : 20;
  // Zoom out as you grow.
  const scale = Math.sqrt(w * h) / (2 * (190 + myR * 4));
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
    // Ring: the far half goes behind the planet, the near half in front.
    const ring = (from: number, to: number) => {
      if (!p.ring) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-0.4);
      ctx.strokeStyle = `hsla(${(p.hue + 40) % 360}, 70%, 72%, 0.75)`;
      ctx.lineWidth = p.r * 0.16;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.75, p.r * 0.45, 0, from, to);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${(p.hue + 40) % 360}, 60%, 40%, 0.6)`;
      ctx.lineWidth = p.r * 0.05;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.5, p.r * 0.38, 0, from, to);
      ctx.stroke();
      ctx.restore();
    };
    ring(Math.PI, Math.PI * 2);
    // Shadow on space below and right, then the lit sphere.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(p.x + p.r * 0.12, p.y + p.r * 0.16, p.r, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.45, p.r * 0.05, p.x, p.y, p.r);
    body.addColorStop(0, `hsl(${p.hue}, 75%, 78%)`);
    body.addColorStop(0.45, `hsl(${p.hue}, 62%, 50%)`);
    body.addColorStop(1, `hsl(${p.hue}, 60%, 22%)`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    // Cloud bands, clipped to the sphere.
    ctx.save();
    ctx.clip();
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.4);
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = `hsla(${(p.hue + (i % 2 ? 20 : -15) + 360) % 360}, 60%, ${i % 2 ? 70 : 30}%, 0.16)`;
      ctx.beginPath();
      ctx.ellipse(0, i * p.r * 0.36, p.r * 1.1, p.r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Night side.
    const night = ctx.createRadialGradient(p.x - p.r * 0.55, p.y - p.r * 0.6, p.r * 0.7, p.x - p.r * 0.2, p.y - p.r * 0.25, p.r * 1.6);
    night.addColorStop(0, 'rgba(0,0,0,0)');
    night.addColorStop(1, 'rgba(0,0,8,0.75)');
    ctx.fillStyle = night;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    // Thin lit atmosphere on the sunny edge.
    ctx.strokeStyle = `hsla(${p.hue}, 90%, 80%, 0.45)`;
    ctx.lineWidth = p.r * 0.05;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.98, Math.PI * 0.85, Math.PI * 1.65);
    ctx.stroke();
    ring(0, Math.PI);
  }

  // Particles: shaded orbs; dark matter and dark energy glow and pulse.
  for (const [k, x, y] of curr.p as [string, number, number][]) {
    if (k === 'm') {
      ctx.drawImage(ORB.m(), x - 3.6, y - 3.6, 7.2, 7.2);
    } else {
      const R = 12 + Math.sin(nowMs / 250 + x) * 2;
      ctx.drawImage(k === 'd' ? ORB.d() : ORB.e(), x - R, y - R, R * 2, R * 2);
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
    const pts = shape.pts.map(v => [Math.cos(v.a) * r * v.k, Math.sin(v.a) * r * v.k]);
    // Drop shadow.
    ctx.save();
    ctx.translate(ax + r * 0.14, ay + r * 0.2);
    ctx.rotate(ar);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ar);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = '#4a4e60';
    ctx.fill();
    // Facets: each slice from the middle to an edge faces outwards; light it by where it faces.
    const top = [0, 0];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const ma = Math.atan2(y1 + y2, x1 + x2) + ar;
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      tone(ctx, lit(Math.cos(ma), Math.sin(ma), 0.75));
    }
    // Craters: dark bowl, lit far rim.
    const lx = Math.cos(-ar) * -0.707 - Math.sin(-ar) * -0.707;
    const ly = Math.sin(-ar) * -0.707 + Math.cos(-ar) * -0.707;
    for (const c of shape.craters) {
      const cx2 = Math.cos(c.a) * c.d * r;
      const cy2 = Math.sin(c.a) * c.d * r;
      const cr = c.s * r;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(cx2, cy2, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(cx2 - lx * cr * 0.35, cy2 - ly * cr * 0.35, cr * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(190, 198, 230, 0.55)';
    ctx.lineWidth = 1.5;
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

  // Bullets: glowing shots, bigger for missiles.
  for (const [kind, x, y, mine] of curr.b as number[][]) {
    const R = kind === 1 ? 16 : 9;
    ctx.drawImage(kind === 1 ? ORB.missile() : mine ? ORB.mine() : ORB.foe(), x - R, y - R, R * 2, R * 2);
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
  ctx.globalAlpha *= 0.2;
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = safe && Math.floor(t / 150) % 2 ? 0.4 : 1;
  // A low-poly hull seen from above, lit from the top left, with a drop shadow so it floats over the map.
  const cos = Math.cos(dir);
  const sin = Math.sin(dir);
  const P = (lx: number, ly: number): [number, number] => [x + (lx * cos - ly * sin) * r, y + (lx * sin + ly * cos) * r];
  const NOSE: [number, number] = [1.2, 0];
  const TAIL: [number, number] = [-0.42, 0];
  const WING_L: [number, number] = [-0.85, -0.98];
  const WING_R: [number, number] = [-0.85, 0.98];
  const BACK_L: [number, number] = [-0.6, -0.34];
  const BACK_R: [number, number] = [-0.6, 0.34];
  const poly = (pts: [number, number][], dx = 0, dy = 0) => {
    ctx.beginPath();
    pts.forEach(([a, b], i) => {
      const [px, py] = P(a, b);
      if (i) ctx.lineTo(px + dx, py + dy);
      else ctx.moveTo(px + dx, py + dy);
    });
    ctx.closePath();
  };
  const outline: [number, number][] = [NOSE, WING_R, BACK_R, TAIL, BACK_L, WING_L];
  poly(outline, r * 0.38, r * 0.5);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  // Engines glow behind.
  for (const side of [-0.3, 0.3]) {
    const [ex, ey] = P(-0.66, side);
    const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * (boost ? 0.7 : 0.4));
    eg.addColorStop(0, boost ? 'rgba(255,200,90,0.95)' : 'rgba(120,230,255,0.8)');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ex, ey, r * (boost ? 0.7 : 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  poly(outline);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  // Two facets either side of the spine, plus darker wing undersides at the tips.
  const shadeLocal = (nx: number, ny: number, tilt: number) => lit(nx * cos - ny * sin, nx * sin + ny * cos, tilt);
  poly([NOSE, WING_L, BACK_L, TAIL]);
  tone(ctx, shadeLocal(0, -1, 0.55));
  poly([NOSE, WING_R, BACK_R, TAIL]);
  tone(ctx, shadeLocal(0, 1, 0.55));
  poly([WING_L, [-0.7, -0.62], BACK_L]);
  tone(ctx, shadeLocal(-0.5, -1, 0.85));
  poly([WING_R, [-0.7, 0.62], BACK_R]);
  tone(ctx, shadeLocal(-0.5, 1, 0.85));
  // Spine highlight.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(...P(1.15, 0));
  ctx.lineTo(...P(-0.4, 0));
  ctx.stroke();
  // Glass cockpit with a highlight towards the light.
  const [kx, ky] = P(0.3, 0);
  const glass = ctx.createRadialGradient(kx - r * 0.1, ky - r * 0.12, r * 0.02, kx, ky, r * 0.3);
  glass.addColorStop(0, '#ffffff');
  glass.addColorStop(0.3, '#8fd8ff');
  glass.addColorStop(1, '#0a1630');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.ellipse(kx, ky, r * 0.34, r * 0.19, dir, 0, Math.PI * 2);
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

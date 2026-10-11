/**
 * Cosmos: LB's space .io game. One big map with matter to absorb, asteroids and planets to avoid, and other
 * players (people and bots) to outgrow. Pure simulation, no I/O: the Cosmos Durable Object runs it for everyone,
 * and the phone runs it on its own for Play solo.
 *
 * - Matter (white) is health, and health is size. Dark matter (purple) is weapon power: shots spend it (or a
 *   little health if you have none) and hit harder the more you hold. Dark energy (cyan) fuels boosts and the
 *   gravity weapons; boosting without it costs health, and small ships boost for free.
 * - Asteroids hurt on contact (shoot big ones and they break into matter); planets pull with gravity and hurt
 *   more. Run into another player: clearly bigger eats smaller; otherwise you bounce and both take damage.
 * - Levels come from everything you've absorbed. They unlock: missiles (2), anti-gravity shield (3), light
 *   speed (4), black hole (5, asteroids can't hurt you from here), gamma-ray beam (6, nor can planets).
 */

export const WORLD = 6000;
export const TICK_MS = 50;
const MATTER_COUNT = 900;
const DARK_MATTER_COUNT = 160;
const DARK_ENERGY_COUNT = 140;
const START_MASS = 22;
const MIN_MASS = 6;
const SMALL = 40; // below this mass, boosting is free
const RESPAWN_MS = 3000;
const SPAWN_SAFE_MS = 3000;

export type ParticleKind = 'm' | 'd' | 'e';
export const WEAPONS = ['blaster', 'missile', 'shield', 'light', 'hole', 'gamma'] as const;
export type Weapon = (typeof WEAPONS)[number];
/** The level each weapon unlocks at. */
export const UNLOCK: Record<Weapon, number> = { blaster: 1, missile: 2, shield: 3, light: 4, hole: 5, gamma: 6 };
export const WEAPON_LABEL: Record<Weapon, string> = {
  blaster: 'Blaster',
  missile: 'Missiles',
  shield: 'Anti-gravity',
  light: 'Light speed',
  hole: 'Black hole',
  gamma: 'Gamma-ray beam',
};
/** Experience needed for each level (index = level - 1). */
export const LEVEL_XP = [0, 70, 180, 360, 620, 980];

export interface Input {
  /** Where the ship is heading: a direction (length 0 to 1; 0 = coast). */
  ax: number;
  ay: number;
  fire: boolean;
  boost: boolean;
  /** The weapon to fire with Fire; specials (shield, light, hole, gamma) trigger once per press. */
  weapon: Weapon;
  /** Increases each time a special is pressed (so a press isn't missed between ticks). */
  special: number;
  /** Which special that press was for (shield, light, hole or gamma). */
  ability: Weapon;
}
export interface Ship {
  id: string;
  name: string;
  table: string | null;
  bot: boolean;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heading for aiming (radians). */
  dir: number;
  mass: number;
  dm: number;
  de: number;
  xp: number;
  level: number;
  kills: number;
  alive: boolean;
  respawnAt: number;
  safeUntil: number;
  shieldUntil: number;
  lightUntil: number;
  holeUntil: number;
  boosting: boolean;
  lastShot: number;
  lastGamma: number;
  specialSeen: number;
  input: Input;
  killedBy: string | null;
}
export interface Particle {
  id: number;
  k: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface Asteroid {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  rot: number;
  spin: number;
  seed: number;
}
export interface Planet {
  id: number;
  x: number;
  y: number;
  r: number;
  hue: number;
  ring: boolean;
}
export interface Bullet {
  id: number;
  owner: string;
  kind: 'shot' | 'missile';
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  until: number;
}
export interface Beam {
  id: number;
  owner: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  power: number;
  until: number;
}
export interface World {
  now: number;
  nextId: number;
  ships: Map<string, Ship>;
  particles: Map<number, Particle>;
  asteroids: Map<number, Asteroid>;
  planets: Planet[];
  bullets: Map<number, Bullet>;
  beams: Beam[];
  /** Things worth telling players about (kills, level ups), drained by the room. */
  events: { to?: string; text: string }[];
}

export type Rng = () => number;
const COLORS = ['#d0ff00', '#00bcc8', '#ff5fa2', '#ff9f1c', '#b388ff', '#69f0ae', '#ffd740', '#40c4ff', '#ff6e40', '#eeff41'];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
export const radius = (mass: number) => 8 + Math.sqrt(mass) * 2.4;
/** Big ships are slow: top speed falls with mass (about 300 at the start, 175 at 300 matter, 110 at 1000). */
const maxSpeed = (s: Ship) => Math.max(70, 330 / Math.sqrt(1 + s.mass / 120));
/** ...and heavy: they take longer to get going and to turn. */
const thrust = (s: Ship) => 900 / Math.sqrt(1 + s.mass / 200);
export const levelFor = (xp: number) => LEVEL_XP.filter(t => xp >= t).length;

export function newWorld(rng: Rng = Math.random, now = 0): World {
  const w: World = { now, nextId: 1, ships: new Map(), particles: new Map(), asteroids: new Map(), planets: [], bullets: new Map(), beams: [], events: [] };
  // Planets, spread out, none near the middle.
  for (let i = 0; i < 7; i++) {
    for (let tries = 0; tries < 50; tries++) {
      const r = 90 + rng() * 140;
      const x = 400 + rng() * (WORLD - 800);
      const y = 400 + rng() * (WORLD - 800);
      if (w.planets.every(p => dist2(p.x, p.y, x, y) > (p.r + r + 700) ** 2)) {
        w.planets.push({ id: w.nextId++, x, y, r, hue: Math.floor(rng() * 360), ring: rng() < 0.45 });
        break;
      }
    }
  }
  // An asteroid belt around one planet, and loose asteroids.
  const belt = w.planets[0];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
    const d = belt.r + 260 + rng() * 120;
    addAsteroid(w, rng, belt.x + Math.cos(a) * d, belt.y + Math.sin(a) * d, 18 + rng() * 26, -Math.sin(a) * 30, Math.cos(a) * 30);
  }
  for (let i = 0; i < 34; i++) addAsteroid(w, rng);
  topUp(w, rng);
  return w;
}

function addAsteroid(w: World, rng: Rng, x?: number, y?: number, r?: number, vx?: number, vy?: number) {
  const ar = r ?? 16 + rng() * 54;
  const a: Asteroid = {
    id: w.nextId++,
    x: x ?? rng() * WORLD,
    y: y ?? rng() * WORLD,
    vx: vx ?? (rng() - 0.5) * 60,
    vy: vy ?? (rng() - 0.5) * 60,
    r: ar,
    hp: ar * 2,
    rot: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 0.8,
    seed: Math.floor(rng() * 1e6),
  };
  w.asteroids.set(a.id, a);
}

function addParticle(w: World, rng: Rng, k: ParticleKind, x?: number, y?: number, spread = 0) {
  const p: Particle = {
    id: w.nextId++,
    k,
    x: clamp(x !== undefined ? x + (rng() - 0.5) * spread : rng() * WORLD, 0, WORLD),
    y: clamp(y !== undefined ? y + (rng() - 0.5) * spread : rng() * WORLD, 0, WORLD),
    vx: spread ? (rng() - 0.5) * 120 : 0,
    vy: spread ? (rng() - 0.5) * 120 : 0,
  };
  // Not inside a planet.
  if (w.planets.some(pl => dist2(pl.x, pl.y, p.x, p.y) < (pl.r + 20) ** 2)) return;
  w.particles.set(p.id, p);
}

/** Keeps the map stocked with particles and asteroids. */
function topUp(w: World, rng: Rng) {
  const count = { m: 0, d: 0, e: 0 };
  for (const p of w.particles.values()) count[p.k]++;
  for (let i = count.m; i < MATTER_COUNT; i++) addParticle(w, rng, 'm');
  for (let i = count.d; i < DARK_MATTER_COUNT; i++) addParticle(w, rng, 'd');
  for (let i = count.e; i < DARK_ENERGY_COUNT; i++) addParticle(w, rng, 'e');
  while (w.asteroids.size < 55) addAsteroid(w, rng);
}

function spawnPoint(w: World, rng: Rng) {
  for (let tries = 0; tries < 40; tries++) {
    const x = 300 + rng() * (WORLD - 600);
    const y = 300 + rng() * (WORLD - 600);
    const clear =
      w.planets.every(p => dist2(p.x, p.y, x, y) > (p.r + 300) ** 2) &&
      [...w.asteroids.values()].every(a => dist2(a.x, a.y, x, y) > (a.r + 120) ** 2) &&
      [...w.ships.values()].every(s => !s.alive || dist2(s.x, s.y, x, y) > (radius(s.mass) + 300) ** 2);
    if (clear) return { x, y };
  }
  return { x: rng() * WORLD, y: rng() * WORLD };
}

export function addShip(w: World, s: { id: string; name: string; table: string | null; bot: boolean }, rng: Rng = Math.random): Ship {
  const at = spawnPoint(w, rng);
  const ship: Ship = {
    ...s,
    color: COLORS[w.ships.size % COLORS.length],
    x: at.x,
    y: at.y,
    vx: 0,
    vy: 0,
    dir: 0,
    mass: START_MASS,
    dm: 5,
    de: 5,
    xp: 0,
    level: 1,
    kills: 0,
    alive: true,
    respawnAt: 0,
    safeUntil: w.now + SPAWN_SAFE_MS,
    shieldUntil: 0,
    lightUntil: 0,
    holeUntil: 0,
    boosting: false,
    lastShot: 0,
    lastGamma: -1e9,
    specialSeen: 0,
    input: { ax: 0, ay: 0, fire: false, boost: false, weapon: 'blaster', special: 0, ability: 'shield' },
    killedBy: null,
  };
  w.ships.set(ship.id, ship);
  return ship;
}

export function respawn(w: World, id: string, rng: Rng = Math.random) {
  const s = w.ships.get(id);
  if (!s || s.alive) return;
  const at = spawnPoint(w, rng);
  Object.assign(s, { x: at.x, y: at.y, vx: 0, vy: 0, mass: START_MASS, dm: 5, de: 5, xp: 0, level: 1, alive: true, safeUntil: w.now + SPAWN_SAFE_MS, killedBy: null });
}

export function setInput(w: World, id: string, input: Partial<Input>) {
  const s = w.ships.get(id);
  if (!s) return;
  const n = { ...s.input, ...input };
  const len = Math.hypot(n.ax, n.ay);
  if (len > 1) {
    n.ax /= len;
    n.ay /= len;
  }
  if (n.weapon !== 'blaster' && n.weapon !== 'missile') n.weapon = 'blaster';
  if (!WEAPONS.includes(n.ability)) n.ability = 'shield';
  s.input = n;
}

function absorb(s: Ship, k: ParticleKind, amount = 1) {
  if (k === 'm') {
    s.mass += 1.6 * amount;
    s.xp += 1 * amount;
  } else if (k === 'd') {
    s.dm += 1 * amount;
    s.xp += 2 * amount;
  } else {
    s.de += 1 * amount;
    s.xp += 2 * amount;
  }
}

/** Damage to a ship; dies below the minimum, scattering what it carried. */
function hurt(w: World, s: Ship, dmg: number, by: string | null, rng: Rng) {
  if (!s.alive || w.now < s.safeUntil || dmg <= 0) return;
  s.mass -= dmg;
  if (s.mass < MIN_MASS) kill(w, s, by, rng);
}
function kill(w: World, s: Ship, by: string | null, rng: Rng) {
  s.alive = false;
  s.respawnAt = w.now + RESPAWN_MS;
  s.killedBy = by;
  // Scatter some of what it carried for others to absorb.
  const drop = (k: ParticleKind, n: number) => {
    for (let i = 0; i < Math.min(60, n); i++) addParticle(w, rng, k, s.x, s.y, radius(s.mass) * 3 + 60);
  };
  drop('m', Math.floor(Math.max(s.mass, 0) / 3));
  drop('d', Math.floor(s.dm / 3));
  drop('e', Math.floor(s.de / 3));
  const killer = by ? w.ships.get(by) : null;
  if (killer && killer.id !== s.id) {
    killer.kills++;
    killer.xp += 20;
    w.events.push({ text: `${killer.name} took down ${s.name}` });
  }
}

/** Spend dark matter on a shot, or health if there's none (barely noticeable when you're big). */
function payAttack(s: Ship, dm: number) {
  if (s.dm >= dm) {
    s.dm -= dm;
    return true;
  }
  const fromHealth = (dm - s.dm) * 1.5;
  if (s.mass - fromHealth < MIN_MASS + 2) return false;
  s.dm = 0;
  s.mass -= fromHealth;
  return true;
}
function payEnergy(s: Ship, de: number) {
  if (s.de < de) return false;
  s.de -= de;
  return true;
}

function fire(w: World, s: Ship) {
  const r = radius(s.mass);
  const cos = Math.cos(s.dir);
  const sin = Math.sin(s.dir);
  const power = 1 + Math.min(s.dm, 300) / 60;
  if (s.input.weapon === 'missile' && s.level >= UNLOCK.missile) {
    if (w.now - s.lastShot < 600 || !payAttack(s, 4)) return;
    const b: Bullet = { id: w.nextId++, owner: s.id, kind: 'missile', x: s.x + cos * (r + 8), y: s.y + sin * (r + 8), vx: s.vx + cos * 420, vy: s.vy + sin * 420, dmg: 9 * power, until: w.now + 3000 };
    w.bullets.set(b.id, b);
  } else {
    if (w.now - s.lastShot < 180 || !payAttack(s, 1)) return;
    const b: Bullet = { id: w.nextId++, owner: s.id, kind: 'shot', x: s.x + cos * (r + 6), y: s.y + sin * (r + 6), vx: s.vx + cos * 720, vy: s.vy + sin * 720, dmg: 3 * power, until: w.now + 1100 };
    w.bullets.set(b.id, b);
  }
  s.lastShot = w.now;
}

/** Specials: one per press of the special button. */
function special(w: World, s: Ship, rng: Rng) {
  const wpn = s.input.ability;
  if (s.level < UNLOCK[wpn]) return;
  if (wpn === 'shield' && payEnergy(s, 15)) {
    s.shieldUntil = w.now + 3000;
  } else if (wpn === 'light' && payEnergy(s, 22)) {
    s.lightUntil = w.now + 1200;
  } else if (wpn === 'hole' && s.de >= 28 && s.dm >= 8) {
    s.de -= 28;
    s.dm -= 8;
    s.holeUntil = w.now + 4000;
  } else if (wpn === 'gamma' && w.now - s.lastGamma > 6000 && s.dm >= 25 && s.de >= 10) {
    s.dm -= 25;
    s.de -= 10;
    s.lastGamma = w.now;
    gamma(w, s, rng);
  }
}

/**
 * The gamma-ray beam: a straight line to the edge of the map. Matter and dark matter it passes through make it
 * stronger; dark energy makes it faster (wider here). It damages every ship and asteroid on the line.
 */
function gamma(w: World, s: Ship, rng: Rng) {
  const cos = Math.cos(s.dir);
  const sin = Math.sin(s.dir);
  // Length to the edge of the map.
  const tx = cos > 0 ? (WORLD - s.x) / cos : cos < 0 ? -s.x / cos : Infinity;
  const ty = sin > 0 ? (WORLD - s.y) / sin : sin < 0 ? -s.y / sin : Infinity;
  const len = Math.min(tx, ty);
  let power = 30 + Math.min(s.dm, 400) * 0.4;
  let width = 26;
  const along = (x: number, y: number) => {
    const t = (x - s.x) * cos + (y - s.y) * sin;
    if (t < 0 || t > len) return null;
    const off = Math.abs((x - s.x) * -sin + (y - s.y) * cos);
    return { t, off };
  };
  for (const p of [...w.particles.values()]) {
    const h = along(p.x, p.y);
    if (h && h.off < width) {
      if (p.k === 'e') width += 0.6;
      else power += p.k === 'd' ? 2 : 0.6;
      w.particles.delete(p.id);
    }
  }
  for (const a of [...w.asteroids.values()]) {
    const h = along(a.x, a.y);
    if (h && h.off < width + a.r) breakAsteroid(w, a, rng, s);
  }
  for (const o of w.ships.values()) {
    if (o.id === s.id || !o.alive) continue;
    const h = along(o.x, o.y);
    if (h && h.off < width + radius(o.mass)) hurt(w, o, power, s.id, rng);
  }
  w.beams.push({ id: w.nextId++, owner: s.id, x1: s.x, y1: s.y, x2: s.x + cos * len, y2: s.y + sin * len, power: width, until: w.now + 500 });
}

function breakAsteroid(w: World, a: Asteroid, rng: Rng, by?: Ship) {
  w.asteroids.delete(a.id);
  if (a.r > 34) {
    for (let i = 0; i < 2; i++) addAsteroid(w, rng, a.x + (rng() - 0.5) * a.r, a.y + (rng() - 0.5) * a.r, a.r * 0.5, a.vx + (rng() - 0.5) * 80, a.vy + (rng() - 0.5) * 80);
  }
  const n = Math.floor(a.r / 4);
  for (let i = 0; i < n; i++) addParticle(w, rng, rng() < 0.15 ? 'd' : 'm', a.x, a.y, a.r * 2);
  if (by) by.xp += 3;
}

/** A simple grid for nearby lookups. */
class Grid<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}
  private key(cx: number, cy: number) {
    return cx * 10000 + cy;
  }
  add(t: T) {
    const k = this.key(Math.floor(t.x / this.size), Math.floor(t.y / this.size));
    const c = this.cells.get(k);
    if (c) c.push(t);
    else this.cells.set(k, [t]);
  }
  near(x: number, y: number, r: number, out: T[] = []) {
    const x0 = Math.floor((x - r) / this.size);
    const x1 = Math.floor((x + r) / this.size);
    const y0 = Math.floor((y - r) / this.size);
    const y1 = Math.floor((y + r) / this.size);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const c = this.cells.get(this.key(cx, cy));
      if (c) out.push(...c);
    }
    return out;
  }
}

/** Advances the world by dt milliseconds. */
export function step(w: World, dt: number, rng: Rng = Math.random) {
  w.now += dt;
  const t = dt / 1000;
  const ships = [...w.ships.values()];
  for (const s of ships) if (!s.alive && s.bot && w.now >= s.respawnAt) respawn(w, s.id, rng);

  for (const b of ships) if (b.bot && b.alive) botThink(w, b);

  const pgrid = new Grid<Particle>(200);
  for (const p of w.particles.values()) pgrid.add(p);

  // Ships: steer, boost, gravity, fire.
  for (const s of ships) {
    if (!s.alive) continue;
    s.level = levelFor(s.xp);
    const inp = s.input;
    const r = radius(s.mass);
    if (Math.hypot(inp.ax, inp.ay) > 0.05) s.dir = Math.atan2(inp.ay, inp.ax);
    let top = maxSpeed(s);
    s.boosting = false;
    if (inp.boost) {
      // Free for small ships; otherwise dark energy, or health when that's gone (you shrink a little).
      if (s.mass < SMALL) s.boosting = true;
      else if (s.de > 0) {
        s.de = Math.max(0, s.de - 7 * t);
        s.boosting = true;
      } else if (s.mass > SMALL) {
        s.mass -= 4 * t;
        s.boosting = true;
      }
    }
    if (s.boosting) top *= 1.8;
    if (w.now < s.lightUntil) top *= 4.5;
    const accel = thrust(s);
    s.vx += inp.ax * accel * t * (w.now < s.lightUntil ? 3 : 1);
    s.vy += inp.ay * accel * t * (w.now < s.lightUntil ? 3 : 1);
    // Planet gravity (not on ships that are past it).
    if (s.level < 6) {
      for (const p of w.planets) {
        const d2 = dist2(p.x, p.y, s.x, s.y);
        const reach = p.r * 5;
        if (d2 < reach * reach) {
          const d = Math.sqrt(d2) || 1;
          const g = (p.r * p.r * 9) / Math.max(d2, p.r * p.r);
          s.vx += ((p.x - s.x) / d) * g * t;
          s.vy += ((p.y - s.y) / d) * g * t;
        }
      }
    }
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > top) {
      s.vx *= top / sp;
      s.vy *= top / sp;
    }
    // A little drag so you drift to a stop.
    const drag = Math.pow(0.35, t);
    s.vx *= drag;
    s.vy *= drag;
    s.x = clamp(s.x + s.vx * t, r, WORLD - r);
    s.y = clamp(s.y + s.vy * t, r, WORLD - r);
    if (s.x <= r || s.x >= WORLD - r) s.vx *= -0.5;
    if (s.y <= r || s.y >= WORLD - r) s.vy *= -0.5;

    if (inp.fire && (inp.weapon === 'blaster' || inp.weapon === 'missile')) fire(w, s);
    if (inp.special !== s.specialSeen) {
      s.specialSeen = inp.special;
      special(w, s, rng);
    }

    // Absorb particles (a black hole pulls them in from far away).
    const hole = w.now < s.holeUntil;
    const reach = hole ? 420 + r : r + 6;
    for (const p of pgrid.near(s.x, s.y, reach)) {
      if (!w.particles.has(p.id)) continue;
      const d2 = dist2(p.x, p.y, s.x, s.y);
      if (d2 < (r + 4) ** 2) {
        absorb(s, p.k);
        w.particles.delete(p.id);
      } else if (hole && d2 < reach * reach) {
        const d = Math.sqrt(d2);
        p.vx += ((s.x - p.x) / d) * 900 * t;
        p.vy += ((s.y - p.y) / d) * 900 * t;
      }
    }
    // Dark energy slowly drains only while boosting; light speed etc. are paid up front.
    s.mass = Math.min(s.mass, 6000);
  }

  // Particles drift (only the ones a black hole set moving).
  for (const p of w.particles.values()) {
    if (p.vx || p.vy) {
      p.x = clamp(p.x + p.vx * t, 0, WORLD);
      p.y = clamp(p.y + p.vy * t, 0, WORLD);
      p.vx *= Math.pow(0.2, t);
      p.vy *= Math.pow(0.2, t);
      if (Math.abs(p.vx) < 1 && Math.abs(p.vy) < 1) p.vx = p.vy = 0;
    }
  }

  // Asteroids drift and spin; black holes pull them; they hurt ships below level 5.
  for (const a of w.asteroids.values()) {
    for (const s of ships) {
      if (!s.alive || w.now >= s.holeUntil) continue;
      const d2 = dist2(a.x, a.y, s.x, s.y);
      if (d2 < 500 * 500) {
        const d = Math.sqrt(d2) || 1;
        a.vx += ((s.x - a.x) / d) * 300 * t;
        a.vy += ((s.y - a.y) / d) * 300 * t;
        if (d < radius(s.mass) + a.r) {
          // Swallowed whole.
          s.mass += a.r / 3;
          s.xp += 4;
          breakAsteroid(w, a, rng);
        }
      }
    }
    a.x += a.vx * t;
    a.y += a.vy * t;
    a.rot += a.spin * t;
    if (a.x < a.r || a.x > WORLD - a.r) a.vx *= -1;
    if (a.y < a.r || a.y > WORLD - a.r) a.vy *= -1;
    a.x = clamp(a.x, a.r, WORLD - a.r);
    a.y = clamp(a.y, a.r, WORLD - a.r);
    for (const p of w.planets) {
      const d2 = dist2(p.x, p.y, a.x, a.y);
      if (d2 < (p.r + a.r) ** 2) {
        const d = Math.sqrt(d2) || 1;
        const nx = (a.x - p.x) / d;
        const ny = (a.y - p.y) / d;
        const dot = a.vx * nx + a.vy * ny;
        if (dot < 0) {
          a.vx -= 2 * dot * nx;
          a.vy -= 2 * dot * ny;
        }
        a.x = p.x + nx * (p.r + a.r + 1);
        a.y = p.y + ny * (p.r + a.r + 1);
      }
    }
  }

  // Ships against asteroids and planets.
  for (const s of ships) {
    if (!s.alive) continue;
    const r = radius(s.mass);
    if (s.level < UNLOCK.hole) {
      for (const a of w.asteroids.values()) {
        const d2 = dist2(a.x, a.y, s.x, s.y);
        if (d2 < (r + a.r) ** 2) {
          const d = Math.sqrt(d2) || 1;
          const nx = (s.x - a.x) / d;
          const ny = (s.y - a.y) / d;
          const rel = Math.max(40, (s.vx - a.vx) * -nx + (s.vy - a.vy) * -ny);
          hurt(w, s, 2 + (rel / 60) * (a.r / 30), null, rng);
          s.vx = nx * 220;
          s.vy = ny * 220;
          s.x = a.x + nx * (r + a.r + 1);
          s.y = a.y + ny * (r + a.r + 1);
        }
      }
    }
    if (s.level < UNLOCK.gamma) {
      for (const p of w.planets) {
        const d2 = dist2(p.x, p.y, s.x, s.y);
        if (d2 < (r + p.r) ** 2) {
          const d = Math.sqrt(d2) || 1;
          const nx = (s.x - p.x) / d;
          const ny = (s.y - p.y) / d;
          hurt(w, s, 6 + s.mass * 0.06, null, rng);
          s.vx = nx * 320;
          s.vy = ny * 320;
          s.x = p.x + nx * (r + p.r + 2);
          s.y = p.y + ny * (r + p.r + 2);
        }
      }
    }
  }

  // Ship against ship: clearly bigger eats; otherwise both bounce and take a knock. Anti-gravity pushes away.
  const alive = ships.filter(s => s.alive);
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      if (!a.alive || !b.alive) continue;
      const ra = radius(a.mass);
      const rb = radius(b.mass);
      const d2 = dist2(a.x, a.y, b.x, b.y);
      // Black holes pull smaller ships in.
      for (const [h, o] of [
        [a, b],
        [b, a],
      ] as const) {
        if (w.now < h.holeUntil && h.mass > o.mass && d2 < 450 * 450 && w.now >= o.safeUntil) {
          const d = Math.sqrt(d2) || 1;
          o.vx += ((h.x - o.x) / d) * 500 * t;
          o.vy += ((h.y - o.y) / d) * 500 * t;
        }
      }
      if (d2 >= (ra + rb) ** 2) continue;
      const d = Math.sqrt(d2) || 1;
      const nx = (b.x - a.x) / d;
      const ny = (b.y - a.y) / d;
      const [big, small] = a.mass >= b.mass ? [a, b] : [b, a];
      const shielded = w.now < small.shieldUntil;
      if (big.mass > small.mass * 1.15 && !shielded && w.now >= small.safeUntil && d < radius(big.mass) - radius(small.mass) * 0.3) {
        big.mass += small.mass * 0.8;
        big.dm += small.dm * 0.5;
        big.de += small.de * 0.5;
        big.xp += 10 + small.mass * 0.3;
        big.kills++;
        w.events.push({ text: `${big.name} consumed ${small.name}` });
        small.alive = false;
        small.respawnAt = w.now + RESPAWN_MS;
        small.killedBy = big.id;
        small.mass = 0;
        continue;
      }
      // Bounce apart.
      const push = (ra + rb - d) / 2 + 1;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const kick = 160;
      a.vx -= nx * kick;
      a.vy -= ny * kick;
      b.vx += nx * kick;
      b.vy += ny * kick;
      if (!shielded) {
        hurt(w, a, 1.5, b.id, rng);
        hurt(w, b, 1.5, a.id, rng);
      }
    }

  // Bullets.
  for (const b of [...w.bullets.values()]) {
    if (w.now > b.until) {
      w.bullets.delete(b.id);
      continue;
    }
    if (b.kind === 'missile') {
      // Home in on the nearest other ship ahead.
      let best: Ship | null = null;
      let bd = 700 * 700;
      for (const s of alive) {
        if (s.id === b.owner || !s.alive) continue;
        const d2 = dist2(s.x, s.y, b.x, b.y);
        if (d2 < bd) {
          bd = d2;
          best = s;
        }
      }
      if (best) {
        const d = Math.sqrt(bd) || 1;
        b.vx += ((best.x - b.x) / d) * 900 * t;
        b.vy += ((best.y - b.y) / d) * 900 * t;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 520) {
          b.vx *= 520 / sp;
          b.vy *= 520 / sp;
        }
      }
    }
    b.x += b.vx * t;
    b.y += b.vy * t;
    if (b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD) {
      w.bullets.delete(b.id);
      continue;
    }
    let hit = false;
    for (const s of alive) {
      if (!s.alive || s.id === b.owner) continue;
      const r = radius(s.mass);
      if (dist2(s.x, s.y, b.x, b.y) < (r + 4) ** 2) {
        if (w.now < s.shieldUntil) {
          // Anti-gravity turns it around: it now belongs to the shielded ship.
          b.vx *= -1;
          b.vy *= -1;
          b.owner = s.id;
          b.x += b.vx * t * 2;
          b.y += b.vy * t * 2;
        } else {
          hurt(w, s, b.dmg, b.owner, rng);
          hit = true;
        }
        break;
      }
    }
    if (!hit)
      for (const a of w.asteroids.values()) {
        if (dist2(a.x, a.y, b.x, b.y) < (a.r + 3) ** 2) {
          a.hp -= b.dmg;
          if (a.hp <= 0) breakAsteroid(w, a, rng, w.ships.get(b.owner));
          hit = true;
          break;
        }
      }
    if (!hit)
      for (const p of w.planets)
        if (dist2(p.x, p.y, b.x, b.y) < p.r * p.r) {
          hit = true;
          break;
        }
    if (hit) w.bullets.delete(b.id);
  }

  // Anti-gravity also shoves nearby asteroids away.
  for (const s of alive) {
    if (w.now >= s.shieldUntil) continue;
    for (const a of w.asteroids.values()) {
      const d2 = dist2(a.x, a.y, s.x, s.y);
      if (d2 < 260 * 260) {
        const d = Math.sqrt(d2) || 1;
        a.vx += ((a.x - s.x) / d) * 600 * t;
        a.vy += ((a.y - s.y) / d) * 600 * t;
      }
    }
  }

  w.beams = w.beams.filter(b => b.until > w.now);
  // Level-ups.
  for (const s of ships) {
    const lv = levelFor(s.xp);
    if (s.alive && lv > s.level) {
      s.level = lv;
      const unlocked = WEAPONS.find(x => UNLOCK[x] === lv);
      w.events.push({ to: s.id, text: `Level ${lv}!${unlocked ? ` ${WEAPON_LABEL[unlocked]} unlocked.` : ''}` });
    }
  }
  if (Math.floor(w.now / 1000) !== Math.floor((w.now - dt) / 1000)) topUp(w, rng);
}

/**
 * Bots: head for the nearest particle (preferring dark matter and energy when low), steer clear of planets,
 * chase and shoot smaller ships nearby, run from bigger ones.
 */
function botThink(w: World, b: Ship) {
  const r = radius(b.mass);
  let tx = b.x;
  let ty = b.y;
  let fireAt: Ship | null = null;
  let flee: Ship | null = null;
  let best = Infinity;
  for (const s of w.ships.values()) {
    if (s.id === b.id || !s.alive) continue;
    const d2 = dist2(s.x, s.y, b.x, b.y);
    if (d2 > 700 * 700) continue;
    if (s.mass > b.mass * 1.15 && d2 < 380 * 380) flee = s;
    else if (s.mass * 1.15 < b.mass && d2 < best) {
      best = d2;
      fireAt = s;
    }
  }
  if (flee) {
    tx = b.x - (flee.x - b.x);
    ty = b.y - (flee.y - b.y);
  } else if (fireAt) {
    tx = fireAt.x;
    ty = fireAt.y;
  } else {
    let pd = Infinity;
    for (const p of w.particles.values()) {
      const d2 = dist2(p.x, p.y, b.x, b.y);
      const bias = p.k === 'm' ? 1 : 0.7;
      if (d2 * bias < pd) {
        pd = d2 * bias;
        tx = p.x;
        ty = p.y;
      }
    }
  }
  let dx = tx - b.x;
  let dy = ty - b.y;
  // Steer away from planets and big asteroids close by.
  for (const p of w.planets) {
    const d2 = dist2(p.x, p.y, b.x, b.y);
    if (d2 < (p.r + r + 220) ** 2) {
      const d = Math.sqrt(d2) || 1;
      dx += ((b.x - p.x) / d) * 400;
      dy += ((b.y - p.y) / d) * 400;
    }
  }
  for (const a of w.asteroids.values()) {
    const d2 = dist2(a.x, a.y, b.x, b.y);
    if (d2 < (a.r + r + 90) ** 2) {
      const d = Math.sqrt(d2) || 1;
      dx += ((b.x - a.x) / d) * 200;
      dy += ((b.y - a.y) / d) * 200;
    }
  }
  const len = Math.hypot(dx, dy) || 1;
  b.input = {
    ...b.input,
    ax: dx / len,
    ay: dy / len,
    fire: !!fireAt && b.dm > 3 && best < 500 * 500,
    boost: !!flee,
    weapon: b.level >= UNLOCK.missile && b.dm > 20 ? 'missile' : 'blaster',
  };
}

/** The leaderboard: biggest first. */
export function leaderboard(w: World, n = 8) {
  return [...w.ships.values()]
    .filter(s => s.alive)
    .sort((a, b) => b.mass - a.mass)
    .slice(0, n)
    .map(s => ({ id: s.id, name: s.name, score: Math.round(s.mass), level: s.level, bot: s.bot }));
}

/**
 * What one player sees: their own ship in full, and everything within their view. Compact arrays keep the
 * message small (it goes out 20 times a second).
 */
export function snapshot(w: World, id: string) {
  const me = w.ships.get(id);
  const cx = me ? me.x : WORLD / 2;
  const cy = me ? me.y : WORLD / 2;
  const view = 900 + (me ? radius(me.mass) * 9 : 600);
  const near = (x: number, y: number, pad = 0) => Math.abs(x - cx) < view + pad && Math.abs(y - cy) < view + pad;
  const r1 = (v: number) => Math.round(v);
  return {
    now: w.now,
    me: me
      ? {
          x: me.x,
          y: me.y,
          vx: me.vx,
          vy: me.vy,
          dir: me.dir,
          mass: me.mass,
          dm: me.dm,
          de: me.de,
          xp: me.xp,
          level: me.level,
          kills: me.kills,
          alive: me.alive,
          respawnAt: me.respawnAt,
          killedBy: me.killedBy ? (w.ships.get(me.killedBy)?.name ?? null) : null,
          shield: me.shieldUntil > w.now,
          light: me.lightUntil > w.now,
          hole: me.holeUntil > w.now,
          gammaReadyIn: Math.max(0, 6000 - (w.now - me.lastGamma)),
          weapon: me.input.weapon,
        }
      : null,
    // [id, x, y, r, dir, color, name, flags(1 boost, 2 shield, 4 hole, 8 light, 16 safe, 32 bot), level]
    s: [...w.ships.values()]
      .filter(s => s.alive && near(s.x, s.y, 200))
      .map(s => [
        s.id,
        r1(s.x),
        r1(s.y),
        Math.round(radius(s.mass) * 10) / 10,
        Math.round(s.dir * 100) / 100,
        s.color,
        s.name,
        (s.boosting ? 1 : 0) | (s.shieldUntil > w.now ? 2 : 0) | (s.holeUntil > w.now ? 4 : 0) | (s.lightUntil > w.now ? 8 : 0) | (s.safeUntil > w.now ? 16 : 0) | (s.bot ? 32 : 0),
        s.level,
      ]),
    // [kind, x, y]
    p: [...w.particles.values()].filter(p => near(p.x, p.y)).map(p => [p.k, r1(p.x), r1(p.y)]),
    // [id, x, y, r, rot, seed]
    a: [...w.asteroids.values()].filter(a => near(a.x, a.y, a.r)).map(a => [a.id, r1(a.x), r1(a.y), r1(a.r), Math.round(a.rot * 100) / 100, a.seed]),
    // [kind(0 shot, 1 missile), x, y, owner is me]
    b: [...w.bullets.values()].filter(b => near(b.x, b.y)).map(b => [b.kind === 'missile' ? 1 : 0, r1(b.x), r1(b.y), b.owner === id ? 1 : 0]),
    g: w.beams.map(b => [r1(b.x1), r1(b.y1), r1(b.x2), r1(b.y2), r1(b.power)]),
  };
}
export type Snapshot = ReturnType<typeof snapshot>;

/** The parts of the map that never move, sent once on joining. */
export const staticMap = (w: World) => ({ size: WORLD, planets: w.planets });
/** Everyone's position for the mini-map. */
export const minimap = (w: World) => [...w.ships.values()].filter(s => s.alive).map(s => [Math.round(s.x), Math.round(s.y), s.color, Math.round(radius(s.mass))]);

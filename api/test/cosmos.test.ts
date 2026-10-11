import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addShip, levelFor, newWorld, radius, respawn, setInput, snapshot, step, TICK_MS, UNLOCK, WORLD } from '../src/games/cosmos.js';

const seeded = (s: number) => () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

test('space: the map is stocked, a ship absorbs matter, dark matter and dark energy', () => {
  const rng = seeded(1);
  const w = newWorld(rng);
  assert.ok(w.particles.size > 1000 && w.asteroids.size > 40 && w.planets.length >= 4);
  const s = addShip(w, { id: 'a', name: 'A', table: '1', bot: false }, rng);
  const before = { mass: s.mass, dm: s.dm, de: s.de };
  // Drop one of each right on the ship.
  for (const k of ['m', 'd', 'e'] as const) w.particles.set(9e6 + k.charCodeAt(0), { id: 9e6 + k.charCodeAt(0), k, x: s.x, y: s.y, vx: 0, vy: 0 });
  step(w, TICK_MS, rng);
  assert.ok(s.mass > before.mass && s.dm > before.dm && s.de > before.de);
});

test('space: shooting spends dark matter (or health when there is none) and hurts what it hits', () => {
  const rng = seeded(2);
  const w = newWorld(rng);
  w.asteroids.clear();
  w.planets = [];
  const a = addShip(w, { id: 'a', name: 'A', table: null, bot: false }, rng);
  const b = addShip(w, { id: 'b', name: 'B', table: null, bot: false }, rng);
  Object.assign(a, { x: 1000, y: 1000, dm: 10, safeUntil: 0 });
  Object.assign(b, { x: 1150, y: 1000, mass: 60, safeUntil: 0 });
  setInput(w, 'a', { ax: 1, ay: 0, fire: true });
  for (let i = 0; i < 10; i++) step(w, TICK_MS, rng);
  assert.ok(a.dm < 10, 'dark matter spent');
  assert.ok(b.mass < 60, 'the shots landed');
  // No dark matter: shots cost a little health instead.
  a.dm = 0;
  const m = a.mass;
  w.now += 1000;
  step(w, TICK_MS, rng);
  assert.ok(a.mass < m);
});

test('space: a clearly bigger ship consumes a smaller one; boosting costs dark energy, free when small', () => {
  const rng = seeded(3);
  const w = newWorld(rng);
  w.asteroids.clear();
  w.planets = [];
  const big = addShip(w, { id: 'big', name: 'Big', table: null, bot: false }, rng);
  const small = addShip(w, { id: 'small', name: 'Small', table: null, bot: false }, rng);
  Object.assign(big, { x: 2000, y: 2000, mass: 200, safeUntil: 0 });
  Object.assign(small, { x: 2005, y: 2000, mass: 30, safeUntil: 0 });
  step(w, TICK_MS, rng);
  assert.equal(small.alive, false);
  assert.ok(big.mass > 200 + 20);
  assert.ok(w.events.some(e => e.text.includes('consumed')));
  respawn(w, 'small', rng);
  assert.equal(small.alive, true);
  // Boost: big ships burn dark energy, small ones don't.
  big.de = 10;
  setInput(w, 'big', { boost: true, ax: 1, ay: 0 });
  setInput(w, 'small', { boost: true, ax: 1, ay: 0 });
  const de0 = small.de;
  for (let i = 0; i < 10; i++) step(w, TICK_MS, rng);
  assert.ok(big.de < 10);
  assert.equal(small.de >= de0, true);
});

test('space: levels unlock weapons; the gamma beam reaches the edge and black holes pull matter in', () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(1000), 6);
  const rng = seeded(4);
  const w = newWorld(rng);
  w.planets = [];
  w.asteroids.clear();
  const s = addShip(w, { id: 'g', name: 'G', table: null, bot: false }, rng);
  const v = addShip(w, { id: 'v', name: 'V', table: null, bot: false }, rng);
  Object.assign(s, { x: 500, y: 3000, xp: 1000, dm: 100, de: 100, mass: 120, safeUntil: 0 });
  Object.assign(v, { x: 2500, y: 3000, mass: 50, safeUntil: 0 });
  // Weapons above your level don't fire.
  const low = addShip(w, { id: 'low', name: 'Low', table: null, bot: false }, rng);
  Object.assign(low, { dm: 100, de: 100 });
  setInput(w, 'low', { ability: 'gamma', special: 1 });
  step(w, TICK_MS, rng);
  assert.equal(w.beams.length, 0);
  setInput(w, 'g', { ax: 1, ay: 0, ability: 'gamma', special: 1 });
  step(w, TICK_MS, rng);
  assert.equal(w.beams.length, 1);
  assert.equal(Math.round(w.beams[0].x2), WORLD, 'to the edge of the map');
  assert.ok(v.mass < 50, 'the ship in its path was hit');
  // Black hole.
  s.level = UNLOCK.hole;
  setInput(w, 'g', { ability: 'hole', special: 2, ax: 0, ay: 0 });
  w.particles.clear();
  w.particles.set(1, { id: 1, k: 'm', x: s.x + 300, y: s.y, vx: 0, vy: 0 });
  step(w, TICK_MS, rng);
  assert.ok(s.holeUntil > w.now);
  for (let i = 0; i < 20; i++) step(w, TICK_MS, rng);
  assert.ok(!w.particles.has(1) || w.particles.get(1)!.x < s.x + 300, 'pulled toward the ship');
});

test('space: a busy map with 40 ships keeps up (each tick well under the 50 ms budget)', () => {
  const rng = seeded(5);
  const w = newWorld(rng);
  for (let i = 0; i < 40; i++) addShip(w, { id: `b${i}`, name: `Bot ${i}`, table: null, bot: true }, rng);
  const t0 = performance.now();
  const ticks = 200;
  for (let i = 0; i < ticks; i++) step(w, TICK_MS, rng);
  const per = (performance.now() - t0) / ticks;
  assert.ok(per < 15, `${per.toFixed(2)} ms per tick`);
  for (const s of w.ships.values()) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.mass));
    assert.ok(s.x >= 0 && s.x <= WORLD && radius(s.mass) > 0);
  }
  const snap = snapshot(w, 'b0');
  assert.ok(JSON.stringify(snap).length < 40_000, `snapshot ${JSON.stringify(snap).length} bytes`);
  console.log(`  ${per.toFixed(2)} ms per tick, snapshot ${JSON.stringify(snap).length} bytes`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botMove, deckCounts, INGREDIENTS, newGame, play, points, tick, view, type Card, type Game } from '../src/games/brew.js';

/** A repeatable random source. */
const seeded = (s: number) => () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, table: String(i + 1), bot: false }));
const give = (g: Game, id: string, kinds: Card['kind'][]) => {
  const p = g.players.find(x => x.id === id)!;
  for (const k of kinds) p.hand.push({ id: g.nextId++, kind: k });
};
const whoseTurn = (g: Game) => g.players[g.turn].id;

test('brew: the deck grows with the room, and everyone starts with five cards', () => {
  assert.equal(deckCounts(2).espresso, 10);
  assert.equal(deckCounts(10).espresso, 26);
  assert.ok(deckCounts(10).bandit > deckCounts(2).bandit);
  for (const n of [2, 6, 10]) {
    const g = newGame(people(n), 0, seeded(n));
    const cur = whoseTurn(g);
    for (const p of g.players) assert.equal(p.hand.length, p.id === cur ? 7 : 5, 'the first player has drawn two');
  }
  assert.throws(() => newGame(people(1), 0));
  assert.throws(() => newGame(people(11), 0));
});

test('brew: one of each ingredient brews a cup; others only see counts', () => {
  const rng = seeded(7);
  const g = newGame(people(3), 0, rng);
  const me = whoseTurn(g);
  give(g, me, [...INGREDIENTS]);
  assert.equal(play(g, me, { a: 'brew' }, 1, rng), null);
  const p = g.players.find(x => x.id === me)!;
  assert.equal(p.cups.length, 1);
  assert.equal(g.actionsLeft, 2);
  const other = g.players.find(x => x.id !== me)!.id;
  const seen = view(g, other).players.find(x => x.id === me)!;
  assert.equal(seen.hand, undefined);
  assert.equal(seen.cups[0].points, undefined, 'cup values are hidden from others');
  assert.equal(view(g, me).players.find(x => x.id === me)!.cups[0].points, p.cups[0].points);
  // Not on someone else's turn.
  assert.match(play(g, other, { a: 'brew' }, 2, rng)!, /turn/);
});

test('brew: a Bandit spoils a cup; the target chases it off with a chappal, or shoos it on with a newspaper', () => {
  const rng = seeded(3);
  const g = newGame(people(3), 0, rng);
  const [a, b, c] = [g.players[g.turn], g.players[(g.turn + 1) % 3], g.players[(g.turn + 2) % 3]];
  b.cups.push({ id: 900, points: 2, bandit: false });
  c.cups.push({ id: 901, points: 1, bandit: false });
  give(g, a.id, ['bandit', 'bandit']);
  give(g, b.id, ['newspaper']);
  give(g, c.id, ['chappal']);
  assert.match(play(g, a.id, { a: 'bandit', target: a.id }, 1, rng)!, /another player/);
  assert.equal(play(g, a.id, { a: 'bandit', target: b.id }, 1, rng), null);
  assert.equal(b.cups[0].bandit, true);
  assert.equal(points(b), 0);
  // While it's pending, the turn waits.
  assert.match(play(g, a.id, { a: 'brew' }, 2, rng)!, /Wait/);
  // b shoos it to c; c chases it off.
  assert.equal(play(g, b.id, { a: 'react', with: 'newspaper', target: c.id }, 2, rng), null);
  assert.equal(b.cups[0].bandit, false);
  assert.equal(c.cups[0].bandit, true);
  assert.equal(play(g, c.id, { a: 'react', with: 'chappal' }, 3, rng), null);
  assert.equal(c.cups[0].bandit, false);
  assert.equal(g.pending, null);
  // Unanswered: it stays when the time runs out.
  assert.equal(play(g, a.id, { a: 'bandit', target: b.id }, 4, rng), null);
  tick(g, 4 + 9_000, rng);
  assert.equal(g.pending, null);
  assert.equal(b.cups[0].bandit, true);
});

test('brew: trades swap cards when accepted; asking for what they lack is refused', () => {
  const rng = seeded(11);
  const g = newGame(people(2), 0, rng);
  const a = g.players[g.turn];
  const b = g.players.find(p => p.id !== a.id)!;
  give(g, a.id, ['gur']);
  give(g, b.id, ['elaichi']);
  const gur = a.hand.find(c => c.kind === 'gur')!.id;
  assert.equal(play(g, a.id, { a: 'trade', to: b.id, give: [gur], want: ['elaichi'] }, 1, rng), null);
  const before = g.actionsLeft;
  assert.equal(play(g, b.id, { a: 'trade-reply', accept: true }, 2, rng), null);
  assert.ok(a.hand.some(c => c.kind === 'elaichi'));
  assert.ok(b.hand.some(c => c.id === gur));
  assert.equal(g.actionsLeft, before - 1);
});

test('brew: 5 points of clean cups wins', () => {
  const rng = seeded(5);
  const g = newGame(people(2), 0, rng);
  const me = g.players[g.turn];
  me.cups.push({ id: 800, points: 2, bandit: false }, { id: 801, points: 2, bandit: false });
  give(g, me.id, [...INGREDIENTS]);
  // Force the next cup to be worth at least 1: any cup takes them to 5 or more.
  assert.equal(play(g, me.id, { a: 'brew' }, 1, rng), null);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, me.id);
});

test('brew: bots finish a game at every room size from 2 to 10', () => {
  for (let n = 2; n <= 10; n++) {
    const rng = seeded(100 + n);
    const g = newGame(people(n).map(p => ({ ...p, bot: true })), 0, rng);
    let now = 0;
    let moves = 0;
    while (g.phase === 'playing' && moves < 20_000) {
      now += 500;
      const actor = g.pending ? (g.pending.kind === 'bandit' ? g.pending.target : g.pending.to) : whoseTurn(g);
      const m = botMove(g, actor, rng);
      if (m) {
        const err = play(g, actor, m, now, rng);
        assert.equal(err, null, `${n} players: ${JSON.stringify(m)} -> ${err}`);
      } else tick(g, now + 100_000, rng);
      moves++;
    }
    assert.equal(g.phase, 'over', `${n}-player game finished`);
    // Cards are neither lost nor made up: deck + discards + hands = everything dealt.
    const total = Object.values(deckCounts(n)).reduce((a, b) => a + b, 0);
    const counted = g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0);
    assert.equal(counted, total);
  }
});

test('brew: a Masala stands in for one missing ingredient; Jugaad takes two actions', async () => {
  const { brewPlan } = await import('../src/games/brew.js');
  const rng = seeded(21);
  const g = newGame(people(2), 0, rng);
  const me = g.players[g.turn];
  me.hand = [];
  give(g, me.id, ['espresso', 'milk', 'gur', 'elaichi', 'masala']);
  assert.ok(brewPlan(me.hand, 5));
  assert.equal(play(g, me.id, { a: 'brew' }, 1, rng), null);
  assert.equal(me.hand.length, 0, 'the Masala was used for the hemp seeds');
  // Jugaad: card + three ingredients = 2 actions; with only 1 left it's refused.
  give(g, me.id, ['jugaad', 'espresso', 'gur', 'masala']);
  assert.equal(g.actionsLeft, 2);
  assert.equal(play(g, me.id, { a: 'jugaad' }, 2, rng), null);
  assert.equal(g.actionsLeft, 0);
  assert.equal(me.cups.length, 2);
  give(g, me.id, ['jugaad', 'espresso', 'gur', 'milk']);
  assert.match(play(g, me.id, { a: 'jugaad' }, 3, rng)!, /No actions left/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorOf, botMove, deckCounts, INGREDIENTS, newGame, play, points, tick, view, type Card, type Game } from '../src/games/brew.js';

/** A repeatable random source. */
const seeded = (s: number) => () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, table: String(i + 1), bot: false }));
const give = (g: Game, id: string, kinds: Card['kind'][]) => {
  const p = g.players.find(x => x.id === id)!;
  for (const k of kinds) p.hand.push({ id: g.nextId++, kind: k });
};
const whoseTurn = (g: Game) => g.players[g.turn].id;

test('brew: the deck grows with the room, and everyone starts with seven cards', () => {
  assert.equal(deckCounts(2).espresso, 10);
  assert.equal(deckCounts(5).bandit, 5);
  assert.equal(deckCounts(10).espresso, 20);
  assert.ok(deckCounts(10).bandit > deckCounts(2).bandit);
  for (const n of [2, 6, 10]) {
    const g = newGame(people(n), 0, seeded(n));
    const cur = whoseTurn(g);
    for (const p of g.players) assert.equal(p.hand.length, p.id === cur ? 9 : 7, 'the first player has drawn two');
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
  tick(g, 4 + 16_000, rng);
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
  g.crows = [];
  give(g, me.id, [...INGREDIENTS]);
  // Force the next cup to be worth at least 1: any cup takes them to 5 or more.
  assert.equal(play(g, me.id, { a: 'brew' }, 1, rng), null);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, me.id);
});

test('brew: bots finish a game at every room size from 2 to 10', () => {
  for (let n = 2; n <= 10; n++) {
    const rng = seeded(100 + n);
    const g = newGame(people(n).map(p => ({ ...p, bot: true })), 0, rng, { extended: n % 2 === 0 });
    let now = 0;
    let moves = 0;
    while (g.phase === 'playing' && moves < 20_000) {
      now += 500;
      const actor = actorOf(g)!;
      const m = botMove(g, actor, rng);
      if (m) {
        const err = play(g, actor, m, now, rng);
        assert.equal(err, null, `${n} players: ${JSON.stringify(m)} -> ${err}`);
      } else tick(g, now + 100_000, rng);
      moves++;
    }
    assert.equal(g.phase, 'over', `${n}-player game finished`);
    // Cards are neither lost nor made up: deck + discards + hands = everything dealt.
    const total = Object.values(deckCounts(n, n % 2 === 0)).reduce((a, b) => a + b, 0);
    const counted = g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0) + g.crows.reduce((a, c) => a + c.stash.length, 0);
    assert.equal(counted, total);
  }
});

test('brew: a Masala stands in for one missing ingredient; Jugaad takes two actions', async () => {
  const { brewPlan } = await import('../src/games/brew.js');
  const rng = seeded(21);
  const g = newGame(people(2), 0, rng);
  const me = g.players[g.turn];
  me.hand = [];
  g.crows = [];
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

test('brew: Havaldar searches a hand and takes two; Chor steals from everyone; Kirana and Mandi', () => {
  const rng = seeded(31);
  const g = newGame(people(3), 0, rng);
  const a = g.players[g.turn];
  const [b, c] = g.players.filter(p => p.id !== a.id);
  a.hand = [];
  b.hand = [];
  c.hand = [];
  give(g, a.id, ['havaldar', 'chor', 'kirana']);
  give(g, b.id, ['gur', 'gur', 'masala', 'bandit']);
  give(g, c.id, ['gur', 'seeds']);
  // Havaldar: the searcher sees b's whole hand, nobody else does; picks two.
  assert.equal(play(g, a.id, { a: 'havaldar', target: b.id }, 1, rng), null);
  assert.equal(view(g, a.id).peek?.length, 4);
  assert.equal(view(g, c.id).peek, null);
  const masala = b.hand.find(x => x.kind === 'masala')!.id;
  const bandit = b.hand.find(x => x.kind === 'bandit')!.id;
  assert.match(play(g, a.id, { a: 'havaldar-take', cards: [masala] }, 2, rng)!, /Pick 2/);
  assert.equal(play(g, a.id, { a: 'havaldar-take', cards: [masala, bandit] }, 2, rng), null);
  assert.ok(a.hand.some(x => x.id === masala) && a.hand.some(x => x.id === bandit));
  // Chor: one random card from each other player.
  const before = [b.hand.length, c.hand.length];
  assert.equal(play(g, a.id, { a: 'chor' }, 3, rng), null);
  assert.deepEqual([b.hand.length, c.hand.length], [before[0] - 1, before[1] - 1]);
  // Kirana on the next turn: everyone hands over all their Gur.
  g.actionsLeft = 3;
  const gurElsewhere = [...b.hand, ...c.hand].filter(x => x.kind === 'gur').length;
  const mine = a.hand.filter(x => x.kind === 'gur').length;
  assert.equal(play(g, a.id, { a: 'kirana', ing: 'gur' }, 4, rng), null);
  assert.equal(a.hand.filter(x => x.kind === 'gur').length, mine + gurElsewhere);
  assert.equal([...b.hand, ...c.hand].filter(x => x.kind === 'gur').length, 0);
  // Mandi keeps only ingredients from the top three.
  give(g, a.id, ['mandi']);
  g.deck.push({ id: 9001, kind: 'bandit' }, { id: 9002, kind: 'milk' }, { id: 9003, kind: 'masala' });
  assert.equal(play(g, a.id, { a: 'mandi' }, 5, rng), null);
  assert.ok(a.hand.some(x => x.id === 9002) && a.hand.some(x => x.id === 9003) && !a.hand.some(x => x.id === 9001));
});

test('brew: a Kauwa lands on whoever brews next, blocks brewing until fed and sent on; Sheru catches it', () => {
  const rng = seeded(41);
  const g = newGame(people(4), 0, rng, { extended: true });
  assert.equal(g.crows.length, 2);
  const a = g.players[g.turn];
  const b = g.players[(g.turn + 1) % 4];
  a.hand = [];
  give(g, a.id, [...INGREDIENTS, ...INGREDIENTS, 'sheru']);
  assert.equal(play(g, a.id, { a: 'brew' }, 1, rng), null);
  assert.equal(g.crows.filter(c => c.holder === a.id).length, 1, 'the first brew brings a Kauwa');
  assert.match(play(g, a.id, { a: 'brew' }, 2, rng)!, /Kauwa/);
  const food = a.hand.find(x => x.kind === 'gur')!.id;
  assert.equal(play(g, a.id, { a: 'feed', card: food, target: b.id }, 3, rng), null);
  const crow = g.crows.find(c => c.holder === b.id)!;
  assert.equal(crow.stash.length, 1);
  // Now a can brew again (the second Kauwa waits for the next brew, which is this one).
  g.actionsLeft = 3;
  give(g, a.id, ['gur']);
  assert.equal(play(g, a.id, { a: 'brew' }, 4, rng), null);
  assert.ok(g.crows.some(c => c.holder === a.id), 'the second Kauwa arrives');
  // Sheru catches b's Kauwa and keeps what it carried.
  const handBefore = a.hand.length;
  assert.equal(play(g, a.id, { a: 'sheru', crow: crow.id }, 5, rng), null);
  assert.equal(crow.holder, null);
  assert.equal(a.hand.length, handBefore - 1 + 1);
});

test('brew: when the cups run out, the most points wins', () => {
  const rng = seeded(51);
  const g = newGame(people(2), 0, rng);
  const me = g.players[g.turn];
  const other = g.players.find(p => p.id !== me.id)!;
  g.crows = [];
  g.cupPile = [{ id: 7000, points: 1, bandit: false }];
  other.cups.push({ id: 7001, points: 2, bandit: false }, { id: 7002, points: 1, bandit: true });
  give(g, me.id, [...INGREDIENTS]);
  assert.equal(play(g, me.id, { a: 'brew' }, 1, rng), null);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, other.id, '2 clean points beats 1');
});

test('brew: without the extension there is no Kauwa, Sheru or Monsoon', () => {
  const g = newGame(people(5), 0, seeded(61));
  assert.equal(g.crows.length, 0);
  assert.equal(g.extended, false);
  const all = [...g.deck, ...g.players.flatMap(p => p.hand)];
  assert.ok(!all.some(c => c.kind === 'sheru' || c.kind === 'monsoon'));
  const ext = newGame(people(5), 0, seeded(61), { extended: true });
  assert.equal(ext.crows.length, 2);
  assert.ok([...ext.deck, ...ext.players.flatMap(p => p.hand)].some(c => c.kind === 'sheru'));
});

test('brew: only ingredients can be traded', () => {
  const rng = seeded(71);
  const g = newGame(people(2), 0, rng);
  const a = g.players[g.turn];
  const b = g.players.find(p => p.id !== a.id)!;
  give(g, a.id, ['chappal', 'masala']);
  const chappal = a.hand.find(c => c.kind === 'chappal')!.id;
  assert.match(play(g, a.id, { a: 'trade', to: b.id, give: [chappal], want: [] }, 1, rng)!, /only ingredients/);
  assert.match(play(g, a.id, { a: 'trade', to: b.id, give: [], want: ['masala'] }, 1, rng)!, /only trade ingredients/);
});

test('brew: no brewing while a Bandit is on one of your cups', () => {
  const rng = seeded(81);
  const g = newGame(people(2), 0, rng);
  const me = g.players[g.turn];
  me.cups.push({ id: 6000, points: 1, bandit: true });
  give(g, me.id, [...INGREDIENTS, 'jugaad', 'chappal']);
  assert.match(play(g, me.id, { a: 'brew' }, 1, rng)!, /Bandit/);
  assert.match(play(g, me.id, { a: 'jugaad' }, 1, rng)!, /Bandit/);
  assert.equal(play(g, me.id, { a: 'chappal' }, 1, rng), null);
  assert.equal(play(g, me.id, { a: 'brew' }, 2, rng), null);
});

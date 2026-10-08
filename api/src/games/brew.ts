/**
 * Brew Bandits: LB's take on the race-to-make-a-dish card game. Players are baristas racing to brew hemp
 * coffees. A turn is up to 3 actions: each brew, trade or special card is one; Jugaad (brew with any three
 * ingredients) is two, the card and the brew. The Masala wildcard stands in for any one ingredient.
 * One of each of the five ingredients brews a cup worth 1 or 2 points,
 * kept face-down. A Bandit raids a cup and spoils it until it's chased off with a chappal or shooed onto someone
 * else's cup with a newspaper; the player it lands on gets a few seconds to react. First to 5 points of clean cups
 * wins. The deck grows with the number of players (2 to 10). Pure functions, no I/O: the GameRoom runs it.
 */

export const INGREDIENTS = ['espresso', 'milk', 'gur', 'elaichi', 'seeds'] as const;
export type Ing = (typeof INGREDIENTS)[number];
export const ACTIONS = ['bandit', 'chappal', 'newspaper', 'jugaad', 'chor', 'monsoon'] as const;
export type ActionKind = (typeof ACTIONS)[number];
/** The wildcard: Masala stands in for any one ingredient when brewing. */
export const WILD = 'masala' as const;
export type CardKind = Ing | ActionKind | typeof WILD;
export interface Card {
  id: number;
  kind: CardKind;
}
export interface Cup {
  id: number;
  points: 1 | 2;
  bandit: boolean;
}
export interface Player {
  id: string;
  name: string;
  table: string | null;
  bot: boolean;
  hand: Card[];
  cups: Cup[];
}
export type Pending =
  | { kind: 'bandit'; from: string; target: string; cupId: number; deadline: number; flicks: number }
  | { kind: 'trade'; from: string; to: string; give: number[]; want: Ing[]; deadline: number };

export interface Game {
  phase: 'playing' | 'over';
  players: Player[];
  turn: number;
  actionsLeft: number;
  deck: Card[];
  discard: Card[];
  cupPile: Cup[];
  pending: Pending | null;
  winner: string | null;
  log: string[];
  turnDeadline: number;
  nextId: number;
  seq: number;
}

export type Move =
  | { a: 'brew' }
  | { a: 'jugaad' }
  | { a: 'bandit'; target: string }
  | { a: 'chappal' }
  | { a: 'newspaper'; target: string }
  | { a: 'chor'; target: string }
  | { a: 'monsoon' }
  | { a: 'trade'; to: string; give: number[]; want: Ing[] }
  | { a: 'trade-reply'; accept: boolean }
  | { a: 'react'; with: 'chappal' | 'newspaper' | 'none'; target?: string }
  | { a: 'end'; discard?: number[] };

export const WIN_POINTS = 5;
export const HAND_LIMIT = 8;
export const START_HAND = 5;
export const ACTIONS_PER_TURN = 3;
export const TURN_MS = 75_000;
export const REACT_MS = 8_000;
export const TRADE_MS = 20_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export const LABEL: Record<CardKind, string> = {
  espresso: 'Espresso shot',
  milk: 'Hemp milk',
  gur: 'Gur',
  elaichi: 'Elaichi',
  seeds: 'Hemp seeds',
  bandit: 'Bandit',
  chappal: 'Chappal',
  newspaper: 'Newspaper',
  jugaad: 'Jugaad',
  chor: 'Chor',
  monsoon: 'Monsoon',
  masala: 'Masala (wild)',
};

export type Rng = () => number;
const shuffle = <T>(a: T[], rng: Rng) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** How many of each card for n players: enough ingredients and trouble for everyone. */
export function deckCounts(n: number): Record<CardKind, number> {
  const half = Math.ceil(n / 2);
  return {
    espresso: 6 + 2 * n,
    milk: 6 + 2 * n,
    gur: 6 + 2 * n,
    elaichi: 6 + 2 * n,
    seeds: 6 + 2 * n,
    bandit: n + 2,
    chappal: half + 1,
    newspaper: half + 1,
    jugaad: 1 + Math.floor(n / 3),
    chor: n,
    monsoon: 1 + Math.floor(n / 5),
    masala: 2 + Math.floor(n / 2),
  };
}

export function newGame(players: { id: string; name: string; table: string | null; bot: boolean }[], now: number, rng: Rng = Math.random): Game {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error('bad player count');
  let id = 1;
  const deck: Card[] = [];
  for (const [kind, count] of Object.entries(deckCounts(players.length)) as [CardKind, number][])
    for (let i = 0; i < count; i++) deck.push({ id: id++, kind });
  shuffle(deck, rng);
  const g: Game = {
    phase: 'playing',
    players: players.map(p => ({ ...p, hand: [], cups: [] })),
    turn: Math.floor(rng() * players.length),
    actionsLeft: 0,
    deck,
    discard: [],
    cupPile: [],
    pending: null,
    winner: null,
    log: [],
    turnDeadline: 0,
    nextId: id,
    seq: 0,
  };
  for (const p of g.players) for (let i = 0; i < START_HAND; i++) draw(g, p, rng);
  startTurn(g, now, rng);
  return g;
}

function draw(g: Game, p: Player, rng: Rng) {
  if (!g.deck.length) {
    if (!g.discard.length) return;
    g.deck = shuffle(g.discard, rng);
    g.discard = [];
    say(g, 'The deck ran out, so the discards were shuffled in.');
  }
  p.hand.push(g.deck.pop()!);
}
function newCup(g: Game, rng: Rng): Cup {
  // A third of cups are worth 2.
  return { id: g.nextId++, points: rng() < 1 / 3 ? 2 : 1, bandit: false };
}
function say(g: Game, line: string) {
  g.log.push(line);
  if (g.log.length > 30) g.log.shift();
}
const current = (g: Game) => g.players[g.turn];
const find = (g: Game, id: string) => g.players.find(p => p.id === id);
const take = (p: Player, cardId: number) => {
  const i = p.hand.findIndex(c => c.id === cardId);
  return i < 0 ? null : p.hand.splice(i, 1)[0];
};
const takeKind = (p: Player, kind: CardKind) => {
  const c = p.hand.find(x => x.kind === kind);
  return c ? take(p, c.id) : null;
};
/** Which ingredients a brew would use (with Masala wildcards filling gaps), or null if it can't be done. `need` is 5 or 3. */
export function brewPlan(hand: Card[], need: 5 | 3): { kinds: Ing[]; wild: number } | null {
  const held = INGREDIENTS.filter(k => hand.some(c => c.kind === k));
  const wild = hand.filter(c => c.kind === WILD).length;
  if (need === 5) {
    const missing = 5 - held.length;
    return missing <= wild ? { kinds: held, wild: missing } : null;
  }
  // Jugaad: three different ingredients, the ones held most first, bandits for the rest.
  const use = [...held].sort((a, b) => hand.filter(c => c.kind === b).length - hand.filter(c => c.kind === a).length).slice(0, 3);
  const short = 3 - use.length;
  return short <= wild ? { kinds: use, wild: short } : null;
}
export const points = (p: Player) => p.cups.reduce((a, c) => a + (c.bandit ? 0 : c.points), 0);
const cleanCup = (p: Player, rng: Rng) => {
  const clean = p.cups.filter(c => !c.bandit);
  return clean.length ? clean[Math.floor(rng() * clean.length)] : null;
};

function startTurn(g: Game, now: number, rng: Rng) {
  const p = current(g);
  draw(g, p, rng);
  draw(g, p, rng);
  g.actionsLeft = ACTIONS_PER_TURN;
  g.turnDeadline = now + TURN_MS;
}
function checkWin(g: Game) {
  const w = g.players.find(p => points(p) >= WIN_POINTS);
  if (w && g.phase === 'playing') {
    g.phase = 'over';
    g.winner = w.id;
    g.pending = null;
    say(g, `${w.name} wins with ${points(w)} points!`);
  }
}
function spend(g: Game, now: number) {
  g.actionsLeft -= 1;
  g.turnDeadline = Math.max(g.turnDeadline, now + 15_000);
}
function endTurn(g: Game, now: number, rng: Rng) {
  const p = current(g);
  while (p.hand.length > HAND_LIMIT) g.discard.push(p.hand.splice(Math.floor(rng() * p.hand.length), 1)[0]);
  g.turn = (g.turn + 1) % g.players.length;
  startTurn(g, now, rng);
}

/** Applies one move by one player. Returns an error message, or null when it worked. */
export function play(g: Game, by: string, m: Move, now: number, rng: Rng = Math.random): string | null {
  if (g.phase !== 'playing') return 'The game is over.';
  const me = find(g, by);
  if (!me) return 'You’re not in this game.';
  const r = playInner(g, me, m, now, rng);
  if (!r) {
    g.seq++;
    checkWin(g);
  }
  return r;
}

function playInner(g: Game, me: Player, m: Move, now: number, rng: Rng): string | null {
  // Answers to a Bandit or a trade come from whoever they're waiting on.
  if (m.a === 'react') {
    const pd = g.pending;
    if (pd?.kind !== 'bandit' || pd.target !== me.id) return 'Nothing to react to.';
    return react(g, me, pd, m, now, rng);
  }
  if (m.a === 'trade-reply') {
    const pd = g.pending;
    if (pd?.kind !== 'trade' || pd.to !== me.id) return 'No trade waiting for you.';
    return tradeReply(g, me, pd, m.accept);
  }
  if (current(g).id !== me.id) return 'Wait for your turn.';
  if (g.pending) return g.pending.kind === 'bandit' ? 'Wait while they deal with the Bandit.' : 'Wait for the answer to your trade.';
  if (m.a === 'end') {
    if (me.hand.length > HAND_LIMIT) {
      const drop = m.discard ?? [];
      if (me.hand.length - drop.length > HAND_LIMIT) return `Discard down to ${HAND_LIMIT} cards first.`;
      for (const id of drop) {
        const c = take(me, id);
        if (c) g.discard.push(c);
      }
    }
    endTurn(g, now, rng);
    return null;
  }
  if (g.actionsLeft <= 0) return 'No actions left this turn. End your turn.';

  switch (m.a) {
    case 'brew': {
      const plan = brewPlan(me.hand, 5);
      if (!plan) return 'You need one of each of the five ingredients (a Masala can stand in for one).';
      for (const k of plan.kinds) g.discard.push(takeKind(me, k)!);
      for (let i = 0; i < plan.wild; i++) g.discard.push(takeKind(me, WILD)!);
      me.cups.push(newCup(g, rng));
      say(g, `${me.name} brewed a cup${plan.wild ? ` with ${plan.wild === 1 ? 'a Masala' : `${plan.wild} Masalas`}` : ''}.`);
      spend(g, now);
      return null;
    }
    case 'jugaad': {
      if (!me.hand.some(c => c.kind === 'jugaad')) return 'You don’t have Jugaad.';
      if (g.actionsLeft < 2) return 'Jugaad takes two actions: the card and the brew.';
      const plan = brewPlan(me.hand, 3);
      if (!plan) return 'Jugaad needs three different ingredients (a Masala can stand in).';
      g.discard.push(takeKind(me, 'jugaad')!);
      for (const k of plan.kinds) g.discard.push(takeKind(me, k)!);
      for (let i = 0; i < plan.wild; i++) g.discard.push(takeKind(me, WILD)!);
      me.cups.push(newCup(g, rng));
      say(g, `${me.name} used Jugaad and brewed a cup with three ingredients.`);
      spend(g, now);
      spend(g, now);
      return null;
    }
    case 'bandit': {
      const t = find(g, m.target);
      if (!t || t.id === me.id) return 'Pick another player.';
      if (!me.hand.some(c => c.kind === 'bandit')) return 'You don’t have a Bandit.';
      const cup = cleanCup(t, rng);
      if (!cup) return `${t.name} has no clean cup to spoil yet.`;
      g.discard.push(takeKind(me, 'bandit')!);
      cup.bandit = true;
      g.pending = { kind: 'bandit', from: me.id, target: t.id, cupId: cup.id, deadline: now + REACT_MS, flicks: 0 };
      say(g, `${me.name} sent a Bandit to raid ${t.name}’s cup!`);
      spend(g, now);
      return null;
    }
    case 'chappal': {
      const cup = me.cups.find(c => c.bandit);
      if (!cup) return 'No Bandit on your cups.';
      if (!me.hand.some(c => c.kind === 'chappal')) return 'You don’t have a chappal.';
      g.discard.push(takeKind(me, 'chappal')!);
      cup.bandit = false;
      say(g, `${me.name} threw a chappal and chased off a Bandit.`);
      spend(g, now);
      return null;
    }
    case 'newspaper': {
      const cup = me.cups.find(c => c.bandit);
      if (!cup) return 'No Bandit on your cups.';
      if (!me.hand.some(c => c.kind === 'newspaper')) return 'You don’t have a newspaper.';
      const t = find(g, m.target);
      if (!t || t.id === me.id) return 'Pick another player.';
      const to = cleanCup(t, rng);
      if (!to) return `${t.name} has no clean cup to shoo it onto.`;
      g.discard.push(takeKind(me, 'newspaper')!);
      cup.bandit = false;
      to.bandit = true;
      g.pending = { kind: 'bandit', from: me.id, target: t.id, cupId: to.id, deadline: now + REACT_MS, flicks: 1 };
      say(g, `${me.name} shooed a Bandit onto ${t.name}’s cup with a newspaper!`);
      spend(g, now);
      return null;
    }
    case 'chor': {
      const t = find(g, m.target);
      if (!t || t.id === me.id) return 'Pick another player.';
      if (!me.hand.some(c => c.kind === 'chor')) return 'You don’t have Chor.';
      if (!t.hand.length) return `${t.name} has no cards to steal.`;
      g.discard.push(takeKind(me, 'chor')!);
      me.hand.push(t.hand.splice(Math.floor(rng() * t.hand.length), 1)[0]);
      say(g, `${me.name} stole a card from ${t.name}.`);
      spend(g, now);
      return null;
    }
    case 'monsoon': {
      if (!me.hand.some(c => c.kind === 'monsoon')) return 'You don’t have Monsoon.';
      g.discard.push(takeKind(me, 'monsoon')!);
      // Everyone passes two random cards to the player on their left.
      const passing = g.players.map(p => shuffle([...p.hand], rng).slice(0, 2));
      g.players.forEach((p, i) => {
        for (const c of passing[i]) take(p, c.id);
        g.players[(i + 1) % g.players.length].hand.push(...passing[i]);
      });
      say(g, `${me.name} called Monsoon: everyone passed two cards to the left.`);
      spend(g, now);
      return null;
    }
    case 'trade': {
      const t = find(g, m.to);
      if (!t || t.id === me.id) return 'Pick another player.';
      if (!m.give.length && !m.want.length) return 'Offer something or ask for something.';
      if (m.give.length > 5 || m.want.length > 5) return 'Up to five cards each way.';
      if (!m.give.every(id => me.hand.some(c => c.id === id))) return 'You can only offer cards in your hand.';
      g.pending = { kind: 'trade', from: me.id, to: t.id, give: m.give, want: m.want, deadline: now + TRADE_MS };
      say(g, `${me.name} offered ${t.name} a trade.`);
      return null;
    }
    default:
      return 'Unknown move.';
  }
}

function react(g: Game, me: Player, pd: Extract<Pending, { kind: 'bandit' }>, m: Extract<Move, { a: 'react' }>, now: number, rng: Rng): string | null {
  const cup = me.cups.find(c => c.id === pd.cupId);
  if (m.with === 'none' || !cup) {
    g.pending = null;
    return null;
  }
  if (m.with === 'chappal') {
    if (!me.hand.some(c => c.kind === 'chappal')) return 'You don’t have a chappal.';
    g.discard.push(takeKind(me, 'chappal')!);
    cup.bandit = false;
    g.pending = null;
    say(g, `${me.name} chased it off with a chappal!`);
    return null;
  }
  if (!me.hand.some(c => c.kind === 'newspaper')) return 'You don’t have a newspaper.';
  const t = find(g, m.target ?? '');
  if (!t || t.id === me.id) return 'Pick whose cup to shoo it onto.';
  const to = cleanCup(t, rng);
  if (!to) return `${t.name} has no clean cup to shoo it onto.`;
  g.discard.push(takeKind(me, 'newspaper')!);
  cup.bandit = false;
  to.bandit = true;
  g.pending = { kind: 'bandit', from: me.id, target: t.id, cupId: to.id, deadline: now + REACT_MS, flicks: pd.flicks + 1 };
  say(g, `${me.name} shooed it onto ${t.name}’s cup with a newspaper!`);
  return null;
}

function tradeReply(g: Game, me: Player, pd: Extract<Pending, { kind: 'trade' }>, accept: boolean): string | null {
  const from = find(g, pd.from)!;
  g.pending = null;
  if (!accept) {
    say(g, `${me.name} said no to ${from.name}’s trade.`);
    return null;
  }
  // The asked-for cards must be in the hand of whoever accepts; the offered ones still in the proposer's.
  const want: Card[] = [];
  const pool = [...me.hand];
  for (const k of pd.want) {
    const i = pool.findIndex(c => c.kind === k);
    if (i < 0) {
      g.pending = pd;
      return `You don’t have ${LABEL[k]} to give.`;
    }
    want.push(pool.splice(i, 1)[0]);
  }
  const give = pd.give.map(id => from.hand.find(c => c.id === id)).filter(Boolean) as Card[];
  for (const c of want) take(me, c.id);
  for (const c of give) take(from, c.id);
  from.hand.push(...want);
  me.hand.push(...give);
  if (current(g).id === from.id) g.actionsLeft = Math.max(0, g.actionsLeft - 1);
  say(g, `${me.name} and ${from.name} traded.`);
  return null;
}

/** Things that happen on their own: an unanswered Bandit stays, an unanswered trade lapses, a slow turn ends. */
export function tick(g: Game, now: number, rng: Rng = Math.random): boolean {
  if (g.phase !== 'playing') return false;
  if (g.pending && now >= g.pending.deadline) {
    if (g.pending.kind === 'trade') say(g, 'The trade offer ran out.');
    g.pending = null;
    g.seq++;
    return true;
  }
  if (!g.pending && now >= g.turnDeadline) {
    say(g, `${current(g).name} ran out of time.`);
    endTurn(g, now, rng);
    g.seq++;
    return true;
  }
  return false;
}

/** When something next happens on its own. */
export const nextDeadline = (g: Game) => (g.phase !== 'playing' ? null : g.pending ? g.pending.deadline : g.turnDeadline);

/** What one player may see: their own hand and cup values; for others, only counts and Bandits. */
export function view(g: Game, me: string) {
  return {
    phase: g.phase,
    me,
    turn: current(g).id,
    actionsLeft: g.actionsLeft,
    turnDeadline: g.turnDeadline,
    deck: g.deck.length,
    winner: g.winner,
    winPoints: WIN_POINTS,
    handLimit: HAND_LIMIT,
    pending: g.pending,
    log: g.log.slice(-8),
    seq: g.seq,
    players: g.players.map(p => ({
      id: p.id,
      name: p.name,
      table: p.table,
      bot: p.bot,
      handCount: p.hand.length,
      hand: p.id === me || g.phase === 'over' ? p.hand : undefined,
      cups: p.cups.map(c => ({ id: c.id, bandit: c.bandit, points: p.id === me || g.phase === 'over' ? c.points : undefined })),
      points: p.id === me || g.phase === 'over' ? points(p) : undefined,
    })),
  };
}
export type GameView = ReturnType<typeof view>;

/**
 * A simple bot: answers Bandits and trades, brews when it can, then makes trouble for whoever looks
 * closest to winning (most clean cups), and ends its turn.
 */
export function botMove(g: Game, botId: string, rng: Rng = Math.random): Move | null {
  const me = find(g, botId);
  if (!me || g.phase !== 'playing') return null;
  const has = (k: CardKind) => me.hand.some(c => c.kind === k);
  const others = g.players.filter(p => p.id !== me.id);
  const leader = (pool = others) => [...pool].sort((a, b) => b.cups.filter(c => !c.bandit).length - a.cups.filter(c => !c.bandit).length)[0];
  const pd = g.pending;
  if (pd?.kind === 'bandit' && pd.target === me.id) {
    if (has('chappal')) return { a: 'react', with: 'chappal' };
    const t = leader(others.filter(p => p.cups.some(c => !c.bandit)));
    if (has('newspaper') && t) return { a: 'react', with: 'newspaper', target: t.id };
    return { a: 'react', with: 'none' };
  }
  if (pd?.kind === 'trade' && pd.to === me.id) {
    const can = pd.want.every((k, i) => me.hand.filter(c => c.kind === k).length >= pd.want.slice(0, i + 1).filter(x => x === k).length);
    return { a: 'trade-reply', accept: can && pd.give.length >= pd.want.length && rng() < 0.7 };
  }
  if (pd || current(g).id !== me.id) return null;
  if (g.actionsLeft > 0) {
    if (brewPlan(me.hand, 5)) return { a: 'brew' };
    if (has('jugaad') && g.actionsLeft >= 2 && brewPlan(me.hand, 3)) return { a: 'jugaad' };
    if (has('chappal') && me.cups.some(c => c.bandit)) return { a: 'chappal' };
    const spoilable = others.filter(p => p.cups.some(c => !c.bandit));
    if (has('newspaper') && me.cups.some(c => c.bandit) && spoilable.length) return { a: 'newspaper', target: leader(spoilable).id };
    if (has('bandit') && spoilable.length) return { a: 'bandit', target: leader(spoilable).id };
    const withCards = others.filter(p => p.hand.length);
    if (has('chor') && withCards.length && rng() < 0.6) return { a: 'chor', target: leader(withCards).id };
  }
  const drop = me.hand.length > HAND_LIMIT ? botDiscards(me) : undefined;
  return { a: 'end', discard: drop };
}
/** Keeps what's useful: drops duplicate ingredients first. */
function botDiscards(me: Player) {
  const extra = me.hand.length - HAND_LIMIT;
  const counts = new Map<CardKind, number>();
  for (const c of me.hand) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return [...me.hand]
    .sort((a, b) => (counts.get(b.kind) ?? 0) - (counts.get(a.kind) ?? 0))
    .slice(0, extra)
    .map(c => c.id);
}

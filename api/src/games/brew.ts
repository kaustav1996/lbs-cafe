/**
 * Brew Bandits: LB's version of the Malaysian card game Nasi Lemak (Faculty of Fun), with hemp coffee.
 *
 * Baristas race to brew cups. One each of Espresso shot, Hemp milk, Gur, Elaichi and Hemp seeds (Masala is wild)
 * brews a face-down cup worth 1 or 2 points. Each turn: draw 2, then up to 3 actions in any mix: brew, trade, or
 * play a trick card (Jugaad, brew with any 3 different ingredients, is 2 actions). First to 5 points of clean
 * cups wins; if the cups run out first, the most points wins.
 *
 * The tricks, after the original's: Havaldar (Officer) looks at a player's hand and takes 2; Chor (Thief) steals
 * a card from everyone; Kirana (Supplier) names an ingredient and everyone hands theirs over; Mandi (Wholesaler)
 * turns up the top 3 and keeps the ingredients; Bandit (Fly) raids a cup, Chappal (Swatter) chases it off,
 * Newspaper (Fan) shoos it onto someone else's (also the moment you're raided). While a Bandit is on any of your
 * cups you can't brew. From the Rendang expansion: a
 * Kauwa (Crow) lands on whoever brews next and stops them brewing until they feed it an ingredient to send it
 * on; Sheru (Si Oyen) catches a Kauwa and keeps what it collected. Monsoon is LB's own: all pass 2 cards left.
 * The Kauwa, Sheru and Monsoon are the extension, chosen when a room is made. The deck grows with the room (2 to 10). Pure functions, no I/O: the Arcade room runs it.
 */

export const INGREDIENTS = ['espresso', 'milk', 'gur', 'elaichi', 'seeds'] as const;
export type Ing = (typeof INGREDIENTS)[number];
export const TRICKS = ['bandit', 'chappal', 'newspaper', 'jugaad', 'chor', 'havaldar', 'kirana', 'mandi', 'sheru', 'monsoon'] as const;
export type Trick = (typeof TRICKS)[number];
/** The wildcard: Masala stands in for any one ingredient. */
export const WILD = 'masala' as const;
export type CardKind = Ing | Trick | typeof WILD;
/** Only the five ingredients can change hands in a trade; special cards (and Masala) can't. */
export const TRADEABLE: CardKind[] = [...INGREDIENTS];

export interface Card {
  id: number;
  kind: CardKind;
}
export interface Cup {
  id: number;
  points: 1 | 2;
  bandit: boolean;
}
export interface Crow {
  id: number;
  /** Whose stall it's at; null while it waits for the next brew. */
  holder: string | null;
  stash: Card[];
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
  | { kind: 'trade'; from: string; to: string; give: number[]; want: CardKind[]; deadline: number }
  | { kind: 'havaldar'; from: string; target: string; deadline: number };

export interface Game {
  phase: 'playing' | 'over';
  players: Player[];
  turn: number;
  actionsLeft: number;
  deck: Card[];
  discard: Card[];
  cupPile: Cup[];
  crows: Crow[];
  /** Playing with the extension (Kauwa, Sheru, Monsoon). */
  extended: boolean;
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
  | { a: 'chor' }
  | { a: 'havaldar'; target: string }
  | { a: 'havaldar-take'; cards: number[] }
  | { a: 'kirana'; ing: Ing }
  | { a: 'mandi' }
  | { a: 'sheru'; crow: number }
  | { a: 'feed'; card: number; target: string }
  | { a: 'monsoon' }
  | { a: 'trade'; to: string; give: number[]; want: CardKind[] }
  | { a: 'trade-reply'; accept: boolean }
  | { a: 'react'; with: 'chappal' | 'newspaper' | 'none'; target?: string }
  | { a: 'end' };

export const WIN_POINTS = 5;
export const START_HAND = 7;
export const ACTIONS_PER_TURN = 3;
export const TURN_MS = 90_000;
export const REACT_MS = 15_000;
export const TRADE_MS = 20_000;
export const PEEK_MS = 20_000;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export const LABEL: Record<CardKind, string> = {
  espresso: 'Espresso shot',
  milk: 'Hemp milk',
  gur: 'Gur',
  elaichi: 'Elaichi',
  seeds: 'Hemp seeds',
  masala: 'Masala',
  bandit: 'Bandit',
  chappal: 'Chappal',
  newspaper: 'Newspaper',
  jugaad: 'Jugaad',
  chor: 'Chor',
  havaldar: 'Havaldar',
  kirana: 'Kirana',
  mandi: 'Mandi',
  sheru: 'Sheru',
  monsoon: 'Monsoon',
};

export type Rng = () => number;
const shuffle = <T>(a: T[], rng: Rng) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export const isIng = (k: CardKind): k is Ing => (INGREDIENTS as readonly string[]).includes(k);

/** Game options: the extension adds the Kauwa (crows), Sheru and Monsoon. */
export interface GameOptions {
  extended: boolean;
}

/** The original's counts (for up to 5 players), scaled up for bigger rooms. Without the extension there's no Sheru or Monsoon. */
export function deckCounts(n: number, extended = true): Record<CardKind, number> {
  const f = Math.max(1, n / 5);
  const r = (x: number) => Math.max(1, Math.round(x * f));
  return {
    espresso: r(10),
    milk: r(10),
    gur: r(10),
    elaichi: r(10),
    seeds: r(10),
    masala: r(4),
    bandit: r(5),
    // A raided cup blocks brewing, so there are enough cures to go round.
    chappal: r(4),
    newspaper: r(3),
    jugaad: r(3),
    chor: r(3),
    havaldar: r(3),
    kirana: r(3),
    mandi: r(3),
    sheru: extended ? r(2) : 0,
    monsoon: extended ? 1 + Math.floor(n / 5) : 0,
  };
}
/** How many cups there are to brew: the original has 15 cards; more for big rooms. */
export const cupCount = (n: number) => Math.max(15, 3 * n + 3);
export const crowCount = (n: number, extended = true) => (!extended ? 0 : n < 4 ? 1 : 2);

export function newGame(
  players: { id: string; name: string; table: string | null; bot: boolean }[],
  now: number,
  rng: Rng = Math.random,
  opts: GameOptions = { extended: false },
): Game {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error('bad player count');
  let id = 1;
  const deck: Card[] = [];
  for (const [kind, count] of Object.entries(deckCounts(players.length, opts.extended)) as [CardKind, number][])
    for (let i = 0; i < count; i++) deck.push({ id: id++, kind });
  shuffle(deck, rng);
  const total = cupCount(players.length);
  const cupPile: Cup[] = Array.from({ length: total }, (_, i) => ({ id: id++, points: i < Math.round(total / 3) ? 2 : 1, bandit: false }));
  shuffle(cupPile, rng);
  const g: Game = {
    phase: 'playing',
    players: players.map(p => ({ ...p, hand: [], cups: [] })),
    turn: Math.floor(rng() * players.length),
    actionsLeft: 0,
    deck,
    discard: [],
    cupPile,
    crows: Array.from({ length: crowCount(players.length, opts.extended) }, () => ({ id: id++, holder: null, stash: [] })),
    extended: opts.extended,
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

function draw(g: Game, p: Player, rng: Rng): Card | null {
  if (!g.deck.length) {
    if (!g.discard.length) return null;
    g.deck = shuffle(g.discard, rng);
    g.discard = [];
    say(g, 'The deck ran out, so the discards were shuffled in.');
  }
  const c = g.deck.pop()!;
  p.hand.push(c);
  return c;
}
function say(g: Game, line: string) {
  g.log.push(line);
  if (g.log.length > 40) g.log.shift();
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
const hasKind = (p: Player, kind: CardKind) => p.hand.some(c => c.kind === kind);
export const points = (p: Player) => p.cups.reduce((a, c) => a + (c.bandit ? 0 : c.points), 0);
const cleanCup = (p: Player, rng: Rng) => {
  const clean = p.cups.filter(c => !c.bandit);
  return clean.length ? clean[Math.floor(rng() * clean.length)] : null;
};
export const crowOf = (g: Game, id: string) => g.crows.find(c => c.holder === id) ?? null;

/** Which ingredients a brew would use (Masala filling gaps), or null if it can't be done. `need` is 5 or 3. */
export function brewPlan(hand: Card[], need: 5 | 3): { kinds: Ing[]; wild: number } | null {
  const held = INGREDIENTS.filter(k => hand.some(c => c.kind === k));
  const wild = hand.filter(c => c.kind === WILD).length;
  if (need === 5) {
    const missing = 5 - held.length;
    return missing <= wild ? { kinds: held, wild: missing } : null;
  }
  const use = [...held].sort((a, b) => hand.filter(c => c.kind === b).length - hand.filter(c => c.kind === a).length).slice(0, 3);
  const short = 3 - use.length;
  return short <= wild ? { kinds: use, wild: short } : null;
}

function startTurn(g: Game, now: number, rng: Rng) {
  const p = current(g);
  draw(g, p, rng);
  draw(g, p, rng);
  g.actionsLeft = ACTIONS_PER_TURN;
  g.turnDeadline = now + TURN_MS;
}
function checkWin(g: Game) {
  if (g.phase !== 'playing') return;
  const w = g.players.find(p => points(p) >= WIN_POINTS);
  if (w) return finish(g, w, `${w.name} wins with ${points(w)} points!`);
  if (!g.cupPile.length) {
    // The cups ran out: most points wins; a tie goes to whoever brewed more cups.
    const best = [...g.players].sort((a, b) => points(b) - points(a) || b.cups.length - a.cups.length)[0];
    finish(g, best, `The cups ran out. ${best.name} wins with ${points(best)} points!`);
  }
}
function finish(g: Game, w: Player, line: string) {
  g.phase = 'over';
  g.winner = w.id;
  g.pending = null;
  say(g, line);
}
function spend(g: Game, now: number, n = 1) {
  g.actionsLeft -= n;
  g.turnDeadline = Math.max(g.turnDeadline, now + 20_000);
}
function endTurn(g: Game, now: number, rng: Rng) {
  g.turn = (g.turn + 1) % g.players.length;
  startTurn(g, now, rng);
}
/** A brewed cup: off the pile, and a waiting Kauwa lands on whoever brewed. */
function brewCup(g: Game, me: Player) {
  const c = g.cupPile.pop();
  if (c) me.cups.push(c);
  const crow = g.crows.find(x => x.holder === null);
  if (crow && !crowOf(g, me.id)) {
    crow.holder = me.id;
    say(g, `A Kauwa smelled the coffee and landed at ${me.name}’s stall. No brewing until it’s fed and sent on.`);
  }
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
  // Answers come from whoever the game is waiting on.
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
  if (m.a === 'havaldar-take') {
    const pd = g.pending;
    if (pd?.kind !== 'havaldar' || pd.from !== me.id) return 'Nothing to take.';
    return havaldarTake(g, me, pd, m.cards, rng);
  }
  if (current(g).id !== me.id) return 'Wait for your turn.';
  if (g.pending) return 'Wait for the answer first.';
  if (m.a === 'end') {
    endTurn(g, now, rng);
    return null;
  }
  if (g.actionsLeft <= 0) return 'No actions left this turn. End your turn.';
  const needCard = (k: CardKind) => (hasKind(me, k) ? null : `You don’t have ${LABEL[k]}.`);
  const others = g.players.filter(p => p.id !== me.id);

  switch (m.a) {
    case 'brew': {
      if (me.cups.some(c => c.bandit)) return 'A Bandit is on your cup. Chase it off with a Chappal or shoo it on with a Newspaper before you brew.';
      if (crowOf(g, me.id)) return 'A Kauwa is at your stall. Feed it an ingredient to send it on, or catch it with Sheru.';
      const plan = brewPlan(me.hand, 5);
      if (!plan) return 'You need one of each of the five ingredients (Masala can stand in).';
      for (const k of plan.kinds) g.discard.push(takeKind(me, k)!);
      for (let i = 0; i < plan.wild; i++) g.discard.push(takeKind(me, WILD)!);
      say(g, `${me.name} brewed a cup.`);
      brewCup(g, me);
      spend(g, now);
      return null;
    }
    case 'jugaad': {
      const e = needCard('jugaad');
      if (e) return e;
      if (me.cups.some(c => c.bandit)) return 'A Bandit is on your cup. Get rid of it before you brew.';
      if (crowOf(g, me.id)) return 'A Kauwa is at your stall. Send it on first.';
      if (g.actionsLeft < 2) return 'Jugaad takes two actions: the card and the brew.';
      const plan = brewPlan(me.hand, 3);
      if (!plan) return 'Jugaad needs three different ingredients (Masala can stand in).';
      g.discard.push(takeKind(me, 'jugaad')!);
      for (const k of plan.kinds) g.discard.push(takeKind(me, k)!);
      for (let i = 0; i < plan.wild; i++) g.discard.push(takeKind(me, WILD)!);
      say(g, `${me.name} used Jugaad and brewed a cup with three ingredients.`);
      brewCup(g, me);
      spend(g, now, 2);
      return null;
    }
    case 'bandit': {
      const e = needCard('bandit');
      if (e) return e;
      const t = find(g, m.target);
      if (!t || t.id === me.id) return 'Pick another player.';
      const cup = cleanCup(t, rng);
      if (!cup) return `${t.name} has no clean cup to raid.`;
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
      const e = needCard('chappal');
      if (e) return e;
      g.discard.push(takeKind(me, 'chappal')!);
      cup.bandit = false;
      say(g, `${me.name} threw a chappal and chased off a Bandit.`);
      spend(g, now);
      return null;
    }
    case 'newspaper': {
      const cup = me.cups.find(c => c.bandit);
      if (!cup) return 'No Bandit on your cups.';
      const e = needCard('newspaper');
      if (e) return e;
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
      const e = needCard('chor');
      if (e) return e;
      const victims = others.filter(p => p.hand.length);
      if (!victims.length) return 'Nobody has cards to steal.';
      g.discard.push(takeKind(me, 'chor')!);
      for (const p of victims) me.hand.push(p.hand.splice(Math.floor(rng() * p.hand.length), 1)[0]);
      say(g, `${me.name}’s Chor stole a card from ${victims.length === 1 ? victims[0].name : 'everyone'}.`);
      spend(g, now);
      return null;
    }
    case 'havaldar': {
      const e = needCard('havaldar');
      if (e) return e;
      const t = find(g, m.target);
      if (!t || t.id === me.id) return 'Pick another player.';
      if (!t.hand.length) return `${t.name} has no cards.`;
      g.discard.push(takeKind(me, 'havaldar')!);
      g.pending = { kind: 'havaldar', from: me.id, target: t.id, deadline: now + PEEK_MS };
      say(g, `${me.name}’s Havaldar is searching ${t.name}’s cards…`);
      spend(g, now);
      return null;
    }
    case 'kirana': {
      const e = needCard('kirana');
      if (e) return e;
      if (!isIng(m.ing)) return 'Name an ingredient.';
      g.discard.push(takeKind(me, 'kirana')!);
      let got = 0;
      for (const p of others)
        for (const c of p.hand.filter(x => x.kind === m.ing)) {
          me.hand.push(take(p, c.id)!);
          got++;
        }
      say(g, `${me.name} called the Kirana for ${LABEL[m.ing]}: ${got ? `everyone handed over ${got}` : 'nobody had any'}.`);
      spend(g, now);
      return null;
    }
    case 'mandi': {
      const e = needCard('mandi');
      if (e) return e;
      g.discard.push(takeKind(me, 'mandi')!);
      const shown: Card[] = [];
      for (let i = 0; i < 3; i++) {
        if (!g.deck.length) {
          if (!g.discard.length) break;
          g.deck = shuffle(g.discard, rng);
          g.discard = [];
        }
        shown.push(g.deck.pop()!);
      }
      const keep = shown.filter(c => isIng(c.kind) || c.kind === WILD);
      me.hand.push(...keep);
      g.discard.push(...shown.filter(c => !keep.includes(c)));
      say(g, `${me.name} went to the Mandi: ${shown.map(c => LABEL[c.kind]).join(', ') || 'nothing'}. Kept ${keep.length}.`);
      spend(g, now);
      return null;
    }
    case 'sheru': {
      const e = needCard('sheru');
      if (e) return e;
      const crow = g.crows.find(c => c.id === m.crow && c.holder);
      if (!crow) return 'Pick a Kauwa sitting at a stall.';
      g.discard.push(takeKind(me, 'sheru')!);
      const from = find(g, crow.holder!)!;
      me.hand.push(...crow.stash);
      say(g, `${me.name}’s Sheru chased off the Kauwa at ${from.name}’s stall${crow.stash.length ? ` and fetched ${crow.stash.length} ${crow.stash.length === 1 ? 'card' : 'cards'}` : ''}!`);
      crow.stash = [];
      crow.holder = null;
      spend(g, now);
      return null;
    }
    case 'feed': {
      const crow = crowOf(g, me.id);
      if (!crow) return 'There’s no Kauwa at your stall.';
      const c = me.hand.find(x => x.id === m.card);
      if (!c || !(isIng(c.kind) || c.kind === WILD)) return 'Feed the Kauwa an ingredient.';
      const t = find(g, m.target);
      if (!t || t.id === me.id) return 'Pick another player.';
      if (crowOf(g, t.id)) return `${t.name} already has a Kauwa.`;
      crow.stash.push(take(me, c.id)!);
      crow.holder = t.id;
      say(g, `${me.name} fed the Kauwa and it flew to ${t.name}’s stall (it’s carrying ${crow.stash.length}).`);
      spend(g, now);
      return null;
    }
    case 'monsoon': {
      const e = needCard('monsoon');
      if (e) return e;
      g.discard.push(takeKind(me, 'monsoon')!);
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
      if (m.give.length > 6 || m.want.length > 6) return 'Up to six cards each way.';
      for (const id of m.give) {
        const c = me.hand.find(x => x.id === id);
        if (!c) return 'You can only offer cards in your hand.';
        if (!TRADEABLE.includes(c.kind)) return `${LABEL[c.kind]} can’t be traded: only ingredients can.`;
      }
      if (!m.want.every(k => TRADEABLE.includes(k))) return 'You can only trade ingredients.';
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
    if (!hasKind(me, 'chappal')) return 'You don’t have a Chappal.';
    g.discard.push(takeKind(me, 'chappal')!);
    cup.bandit = false;
    g.pending = null;
    say(g, `${me.name} chased it off with a chappal!`);
    return null;
  }
  if (!hasKind(me, 'newspaper')) return 'You don’t have a Newspaper.';
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
  if (!accept) {
    g.pending = null;
    say(g, `${me.name} said no to ${from.name}’s trade.`);
    return null;
  }
  const want: Card[] = [];
  const pool = [...me.hand];
  for (const k of pd.want) {
    const i = pool.findIndex(c => c.kind === k);
    if (i < 0) return `You don’t have ${LABEL[k]} to give.`;
    want.push(pool.splice(i, 1)[0]);
  }
  g.pending = null;
  const give = pd.give.map(id => from.hand.find(c => c.id === id)).filter(Boolean) as Card[];
  for (const c of want) take(me, c.id);
  for (const c of give) take(from, c.id);
  from.hand.push(...want);
  me.hand.push(...give);
  // A successful trade is one of the proposer's actions.
  if (current(g).id === from.id) g.actionsLeft = Math.max(0, g.actionsLeft - 1);
  say(g, `${me.name} and ${from.name} traded.`);
  return null;
}

function havaldarTake(g: Game, me: Player, pd: Extract<Pending, { kind: 'havaldar' }>, cards: number[], rng: Rng): string | null {
  const t = find(g, pd.target)!;
  const pick = [...new Set(cards)].filter(id => t.hand.some(c => c.id === id)).slice(0, 2);
  const need = Math.min(2, t.hand.length);
  if (pick.length < need) return `Pick ${need} of ${t.name}’s cards.`;
  for (const id of pick) me.hand.push(take(t, id)!);
  g.pending = null;
  say(g, `${me.name}’s Havaldar took ${pick.length} ${pick.length === 1 ? 'card' : 'cards'} from ${t.name}.`);
  void rng;
  return null;
}

/** Things that happen on their own: answers run out, the Havaldar grabs two at random, a slow turn ends. */
export function tick(g: Game, now: number, rng: Rng = Math.random): boolean {
  if (g.phase !== 'playing') return false;
  const pd = g.pending;
  if (pd && now >= pd.deadline) {
    if (pd.kind === 'trade') say(g, 'The trade offer ran out.');
    if (pd.kind === 'havaldar') {
      const t = find(g, pd.target)!;
      const me = find(g, pd.from)!;
      const pick = shuffle([...t.hand], rng).slice(0, 2);
      for (const c of pick) me.hand.push(take(t, c.id)!);
      say(g, `${me.name}’s Havaldar grabbed ${pick.length} at random.`);
    }
    g.pending = null;
    g.seq++;
    return true;
  }
  if (!pd && now >= g.turnDeadline) {
    say(g, `${current(g).name} ran out of time.`);
    endTurn(g, now, rng);
    g.seq++;
    return true;
  }
  return false;
}

export const nextDeadline = (g: Game) => (g.phase !== 'playing' ? null : g.pending ? g.pending.deadline : g.turnDeadline);

/** Who the game is waiting on. */
export function actorOf(g: Game): string | null {
  if (g.phase !== 'playing') return null;
  const pd = g.pending;
  if (pd) return pd.kind === 'bandit' ? pd.target : pd.kind === 'trade' ? pd.to : pd.from;
  return g.players[g.turn].id;
}

/** What one player may see: their own hand and cup values; for others, only counts and Bandits. */
export function view(g: Game, me: string) {
  const pd = g.pending;
  return {
    phase: g.phase,
    me,
    turn: current(g).id,
    actionsLeft: g.actionsLeft,
    turnDeadline: g.turnDeadline,
    deck: g.deck.length,
    cupsLeft: g.cupPile.length,
    discardTop: g.discard.length ? g.discard[g.discard.length - 1].kind : null,
    winner: g.winner,
    winPoints: WIN_POINTS,
    extended: g.extended,
    pending: pd,
    /** The Havaldar's search: the target's whole hand, shown only to whoever played it. */
    peek: pd?.kind === 'havaldar' && pd.from === me ? find(g, pd.target)!.hand : null,
    crows: g.crows.map(c => ({ id: c.id, holder: c.holder, stash: c.stash.length })),
    log: g.log.slice(-10),
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
 * A simple bot: answers raids, trades and searches; deals with a Kauwa; brews when it can; then makes trouble
 * for whoever looks closest to winning (most clean cups), and ends its turn.
 */
export function botMove(g: Game, botId: string, rng: Rng = Math.random): Move | null {
  const me = find(g, botId);
  if (!me || g.phase !== 'playing') return null;
  const has = (k: CardKind) => hasKind(me, k);
  const others = g.players.filter(p => p.id !== me.id);
  const leader = (pool: Player[]) => [...pool].sort((a, b) => b.cups.filter(c => !c.bandit).length - a.cups.filter(c => !c.bandit).length || b.hand.length - a.hand.length)[0];
  const missing = INGREDIENTS.filter(k => !has(k));
  const pd = g.pending;
  if (pd?.kind === 'bandit' && pd.target === me.id) {
    if (has('chappal')) return { a: 'react', with: 'chappal' };
    const t = others.filter(p => p.cups.some(c => !c.bandit));
    if (has('newspaper') && t.length) return { a: 'react', with: 'newspaper', target: leader(t).id };
    return { a: 'react', with: 'none' };
  }
  if (pd?.kind === 'trade' && pd.to === me.id) {
    const pool = [...me.hand];
    const can = pd.want.every(k => {
      const i = pool.findIndex(c => c.kind === k);
      return i >= 0 && pool.splice(i, 1).length;
    });
    return { a: 'trade-reply', accept: can && pd.give.length >= pd.want.length && rng() < 0.7 };
  }
  if (pd?.kind === 'havaldar' && pd.from === me.id) {
    const t = find(g, pd.target)!;
    const want = [...t.hand].sort((a, b) => score(b) - score(a)).slice(0, 2);
    return { a: 'havaldar-take', cards: want.map(c => c.id) };
  }
  if (pd || current(g).id !== me.id) return null;
  function score(c: Card) {
    if (missing.includes(c.kind as Ing)) return 5;
    if (c.kind === WILD) return 4;
    if (c.kind === 'chappal' || c.kind === 'jugaad') return 3;
    return isIng(c.kind) ? 1 : 2;
  }
  if (g.actionsLeft > 0) {
    const crow = crowOf(g, me.id);
    if (crow) {
      if (has('sheru')) return { a: 'sheru', crow: crow.id };
      const food = [...me.hand].filter(c => isIng(c.kind)).sort((a, b) => me.hand.filter(x => x.kind === b.kind).length - me.hand.filter(x => x.kind === a.kind).length)[0];
      const to = others.filter(p => !crowOf(g, p.id));
      if (food && to.length) return { a: 'feed', card: food.id, target: leader(to).id };
    }
    // A Bandit on a cup stops brewing, so deal with it first.
    const raided = me.cups.some(c => c.bandit);
    const raidable = others.filter(p => p.cups.some(c => !c.bandit));
    if (raided && has('chappal')) return { a: 'chappal' };
    if (raided && has('newspaper') && raidable.length) return { a: 'newspaper', target: leader(raidable).id };
    if (!crow && !raided && brewPlan(me.hand, 5)) return { a: 'brew' };
    if (!crow && !raided && has('jugaad') && g.actionsLeft >= 2 && brewPlan(me.hand, 3)) return { a: 'jugaad' };
    // Raid someone who can still brew (a second Bandit on a blocked player does little).
    const open = raidable.filter(p => !p.cups.some(c => c.bandit));
    if (has('bandit') && open.length) return { a: 'bandit', target: leader(open).id };
    if (has('mandi')) return { a: 'mandi' };
    if (has('kirana') && missing.length) return { a: 'kirana', ing: missing[0] };
    const withCards = others.filter(p => p.hand.length);
    if (has('havaldar') && withCards.length) return { a: 'havaldar', target: leader(withCards).id };
    if (has('chor') && withCards.length && rng() < 0.7) return { a: 'chor' };
    const loaded = g.crows.find(c => c.holder && c.holder !== me.id && c.stash.length >= 2);
    if (has('sheru') && loaded) return { a: 'sheru', crow: loaded.id };
  }
  return { a: 'end' };
}

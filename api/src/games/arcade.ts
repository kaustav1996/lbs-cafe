import { DurableObject } from 'cloudflare:workers';
import { botMove, MAX_PLAYERS, MIN_PLAYERS, newGame, nextDeadline, play, tick, view, type Game, type Move } from './brew.js';

/**
 * The game rooms, for every table at once (a cafe has a handful of games going at a time). Phones hold a
 * hibernating WebSocket here. A player creates a room (2 to 10 seats), others from any table with games open
 * join it, the host can fill seats with bots and starts. The room runs the rules (brew.ts), the bots and the
 * timers, and sends each phone only what that player may see.
 */
interface Seat {
  id: string;
  name: string;
  table: string | null;
  bot: boolean;
}
interface Room {
  code: string;
  game: 'brew';
  host: string;
  max: number;
  status: 'waiting' | 'playing' | 'over';
  seats: Seat[];
  g: Game | null;
  botAt: number | null;
  active: number;
}
interface Who {
  id?: string;
  name?: string;
  table: string | null;
  room?: string;
}
type In =
  | { t: 'hello'; id: string; name: string }
  | { t: 'create'; max: number }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'bot'; add: boolean }
  | { t: 'start' }
  | { t: 'again' }
  | { t: 'move'; move: Move };

const IDLE_MS = 30 * 60_000;
const BOT_MS = 1100;
const BOT_NAMES = ['Chai Bot', 'Masala Bot', 'Filter Bot', 'Kulhad Bot', 'Bandit Bot', 'Lemon Bot', 'Gur Bot', 'Elaichi Bot', 'Biscuit Bot'];
const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export class Arcade extends DurableObject {
  private rooms = new Map<string, Room>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Room[]>('rooms');
      for (const r of saved ?? []) this.rooms.set(r.code, r);
    });
  }

  /** The Worker has already checked the table has games open; its label comes in X-LBS-Table. */
  async fetch(req: Request) {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ table: req.headers.get('x-lbs-table') } satisfies Who);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let m: In;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const who = ws.deserializeAttachment() as Who;
    const err = this.handle(ws, who, m);
    if (err) ws.send(JSON.stringify({ t: 'error', message: err }));
    await this.save();
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private handle(ws: WebSocket, who: Who, m: In): string | null {
    const now = Date.now();
    if (m.t === 'hello') {
      who.id = clean(m.id, 40);
      who.name = clean(m.name, 24) || 'Guest';
      if (!who.id) return 'Missing player id.';
      // Back in a room they're seated in (a phone that slept, or a reload).
      const mine = [...this.rooms.values()].find(r => r.seats.some(s => s.id === who.id && !s.bot));
      who.room = mine?.code;
      ws.serializeAttachment(who);
      if (mine) this.sendRoom(mine);
      else this.sendLobby(ws);
      return null;
    }
    if (!who.id) return 'Say hello first.';
    const room = who.room ? this.rooms.get(who.room) : undefined;

    switch (m.t) {
      case 'create': {
        if (room) return 'Leave your room first.';
        const max = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(Number(m.max) || 4)));
        const code = this.newCode();
        const r: Room = { code, game: 'brew', host: who.id, max, status: 'waiting', seats: [{ id: who.id, name: who.name!, table: who.table, bot: false }], g: null, botAt: null, active: now };
        this.rooms.set(code, r);
        who.room = code;
        ws.serializeAttachment(who);
        this.changed(r);
        return null;
      }
      case 'join': {
        if (room) return 'Leave your room first.';
        const r = this.rooms.get(clean(m.code, 8).toUpperCase());
        if (!r) return 'That room has closed.';
        if (r.status !== 'waiting') return 'That game has already started.';
        if (r.seats.length >= r.max) return 'That room is full.';
        r.seats.push({ id: who.id, name: who.name!, table: who.table, bot: false });
        who.room = r.code;
        ws.serializeAttachment(who);
        this.changed(r);
        return null;
      }
      case 'leave': {
        if (!room) return null;
        who.room = undefined;
        ws.serializeAttachment(who);
        this.leave(room, who.id);
        this.sendLobby(ws);
        return null;
      }
      case 'bot': {
        if (!room || room.host !== who.id) return 'Only the host can add bots.';
        if (room.status !== 'waiting') return 'The game has started.';
        if (m.add) {
          if (room.seats.length >= room.max) return 'The room is full.';
          const used = new Set(room.seats.map(s => s.name));
          const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot ${room.seats.length + 1}`;
          room.seats.push({ id: `bot-${crypto.randomUUID().slice(0, 8)}`, name, table: null, bot: true });
        } else {
          const i = room.seats.map(s => s.bot).lastIndexOf(true);
          if (i >= 0) room.seats.splice(i, 1);
        }
        this.changed(room);
        return null;
      }
      case 'start':
      case 'again': {
        if (!room || room.host !== who.id) return 'Only the host can start the game.';
        if (m.t === 'start' && room.status !== 'waiting') return 'The game has started.';
        if (room.seats.length < MIN_PLAYERS) return 'Add at least one more player or a bot.';
        room.g = newGame(room.seats, now);
        room.status = 'playing';
        this.changed(room);
        return null;
      }
      case 'move': {
        if (!room?.g) return 'No game here yet.';
        const e = play(room.g, who.id, m.move, now);
        if (e) return e;
        if (room.g.phase === 'over') room.status = 'over';
        this.changed(room);
        return null;
      }
    }
    return 'Unknown message.';
  }

  /** A player leaves: in a waiting room their seat goes; mid-game a bot takes it over. */
  private leave(r: Room, id: string) {
    if (r.status === 'waiting') r.seats = r.seats.filter(s => s.id !== id);
    else {
      for (const s of r.seats) if (s.id === id) s.bot = true;
      for (const p of r.g?.players ?? []) if (p.id === id) (p.bot = true), (p.name = `${p.name} (bot)`);
    }
    const humans = r.seats.filter(s => !s.bot);
    if (!humans.length) {
      this.rooms.delete(r.code);
      this.lobbyChanged();
      return;
    }
    if (r.host === id) r.host = humans[0].id;
    this.changed(r);
  }

  private newCode() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    for (;;) {
      const c = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
      if (!this.rooms.has(c)) return c;
    }
  }

  /** After any change: queue a bot if one is to move, tell the room and the lobby, and set the next wake-up. */
  private changed(r: Room) {
    r.active = Date.now();
    const actor = this.actor(r);
    r.botAt = actor && r.g?.players.find(p => p.id === actor)?.bot ? Date.now() + BOT_MS : null;
    this.sendRoom(r);
    this.lobbyChanged();
    void this.arm();
  }
  /** Who the game is waiting on. */
  private actor(r: Room): string | null {
    const g = r.g;
    if (!g || g.phase !== 'playing') return null;
    if (g.pending) return g.pending.kind === 'bandit' ? g.pending.target : g.pending.to;
    return g.players[g.turn].id;
  }

  async alarm() {
    const now = Date.now();
    for (const r of [...this.rooms.values()]) {
      if (now - r.active > IDLE_MS) {
        this.rooms.delete(r.code);
        continue;
      }
      if (!r.g || r.status !== 'playing') continue;
      let moved = false;
      if (r.botAt && now >= r.botAt) {
        const actor = this.actor(r);
        const mv = actor ? botMove(r.g, actor) : null;
        if (actor && mv && !play(r.g, actor, mv, now)) moved = true;
      }
      if (tick(r.g, now)) moved = true;
      if (r.g.phase === 'over') r.status = 'over';
      if (moved) this.changed(r);
    }
    this.lobbyChanged();
    await this.save();
    await this.arm();
  }

  private async arm() {
    let next: number | null = null;
    const now = Date.now();
    for (const r of this.rooms.values()) {
      const times = [r.botAt, r.g ? nextDeadline(r.g) : null, r.active + IDLE_MS].filter((t): t is number => t !== null);
      for (const t of times) if (next === null || t < next) next = t;
    }
    if (next === null) return this.ctx.storage.deleteAlarm();
    await this.ctx.storage.setAlarm(Math.max(next, now + 200));
  }

  private async save() {
    await this.ctx.storage.put('rooms', [...this.rooms.values()]);
  }

  private sockets(code?: string) {
    return this.ctx.getWebSockets().filter(ws => {
      const w = ws.deserializeAttachment() as Who;
      return code === undefined ? !w.room : w.room === code;
    });
  }
  private send(ws: WebSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
  private roomInfo(r: Room) {
    return { code: r.code, host: r.host, max: r.max, status: r.status, seats: r.seats.map(s => ({ id: s.id, name: s.name, table: s.table, bot: s.bot })) };
  }
  private sendRoom(r: Room) {
    for (const ws of this.sockets(r.code)) {
      const w = ws.deserializeAttachment() as Who;
      this.send(ws, { t: 'room', room: this.roomInfo(r), game: r.g ? view(r.g, w.id!) : null });
    }
  }
  private lobby() {
    return [...this.rooms.values()]
      .filter(r => r.status === 'waiting')
      .map(r => ({ code: r.code, hostName: r.seats.find(s => s.id === r.host)?.name ?? '', table: r.seats.find(s => s.id === r.host)?.table ?? null, players: r.seats.length, max: r.max }));
  }
  private sendLobby(ws: WebSocket) {
    this.send(ws, { t: 'lobby', rooms: this.lobby() });
  }
  private lobbyChanged() {
    const rooms = this.lobby();
    for (const ws of this.sockets(undefined)) this.send(ws, { t: 'lobby', rooms });
  }
}

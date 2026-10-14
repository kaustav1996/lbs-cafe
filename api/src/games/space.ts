import { DurableObject } from 'cloudflare:workers';
import { addShip, leaderboard, minimap, newWorld, respawn, setInput, snapshot, staticMap, step, TICK_MS, WEAPONS, type Weapon, type World } from './cosmos.js';

/**
 * LB's Space: one map for everyone at a table with games open. Phones hold a WebSocket here; while anyone is
 * connected the world runs 20 times a second and each phone gets what's around it. With nobody connected the
 * loop stops and the object can sleep; the world starts fresh next time. A few bots always fly around.
 */
interface Who {
  id?: string;
  name?: string;
  table: string | null;
}
type In =
  | { t: 'join'; id: string; name: string }
  | { t: 'in'; ax: number; ay: number; fire: boolean; boost: boolean; weapon: Weapon; special: number; ability: Weapon }
  | { t: 'respawn' };

const BOTS = ['Comet', 'Nebula', 'Quasar', 'Pulsar', 'Meteor', 'Nova'];
const MAX_PLAYERS = 40;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

export class Space extends DurableObject {
  private world: World | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** The Worker has checked the table has games open; its label comes in X-LBS-Table. */
  async fetch(req: Request) {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ table: req.headers.get('x-lbs-table') } satisfies Who);
    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureWorld() {
    if (this.world) return this.world;
    const w = newWorld();
    // Bots on the shared map are small, harmless prey, so people only fight people.
    w.weakBots = true;
    for (const name of BOTS) addShip(w, { id: `bot-${name}`, name, table: null, bot: true });
    this.world = w;
    return w;
  }
  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let m: In;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const who = ws.deserializeAttachment() as Who;
    const w = this.ensureWorld();
    if (m.t === 'join') {
      who.id = clean(m.id, 40);
      who.name = clean(m.name, 18) || 'Pilot';
      if (!who.id) return;
      ws.serializeAttachment(who);
      const humans = [...w.ships.values()].filter(s => !s.bot).length;
      if (!w.ships.has(who.id)) {
        if (humans >= MAX_PLAYERS) return ws.send(JSON.stringify({ t: 'full', message: 'Space is full right now. Try again in a minute.' }));
        addShip(w, { id: who.id, name: who.name, table: who.table, bot: false });
      }
      ws.send(JSON.stringify({ t: 'map', map: staticMap(w), me: who.id }));
      this.startLoop();
      return;
    }
    if (!who.id) return;
    if (m.t === 'in') {
      const weapon = m.weapon === 'missile' ? 'missile' : 'blaster';
      const ability = WEAPONS.includes(m.ability) ? m.ability : 'shield';
      setInput(w, who.id, { ax: num(m.ax), ay: num(m.ay), fire: !!m.fire, boost: !!m.boost, weapon, special: Number(m.special) || 0, ability });
      // A restart (a deploy) loses the loop; the next input brings it back.
      if (!w.ships.has(who.id)) addShip(w, { id: who.id, name: who.name ?? 'Pilot', table: who.table, bot: false });
      this.startLoop();
    } else if (m.t === 'respawn') {
      const s = w.ships.get(who.id);
      if (s && !s.alive && w.now >= s.respawnAt) respawn(w, who.id);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const who = ws.deserializeAttachment() as Who;
    // Leaving takes the ship off the map (unless the same player is still connected on another socket).
    if (who.id && this.world && !this.sockets().some(s => s !== ws && (s.deserializeAttachment() as Who).id === who.id)) this.world.ships.delete(who.id);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    if (!this.sockets().some(s => s !== ws)) this.stop();
  }

  private stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.world = null;
  }
  private sockets() {
    return this.ctx.getWebSockets();
  }

  private tick() {
    const w = this.world;
    const socks = this.sockets();
    if (!w || !socks.length) return this.stop();
    step(w, TICK_MS);
    this.ticks++;
    const events = w.events.splice(0);
    const everySecond = this.ticks % 20 === 0;
    const board = everySecond ? JSON.stringify({ t: 'board', top: leaderboard(w), mini: minimap(w) }) : null;
    for (const ws of socks) {
      const who = ws.deserializeAttachment() as Who;
      if (!who.id) continue;
      try {
        ws.send(JSON.stringify({ t: 's', ...snapshot(w, who.id) }));
        for (const e of events) if (!e.to || e.to === who.id) ws.send(JSON.stringify({ t: 'ev', text: e.text }));
        if (board) ws.send(board);
      } catch {
        /* closing */
      }
    }
  }
}

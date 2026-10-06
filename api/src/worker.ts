import { DurableObject } from 'cloudflare:workers';
import postgres from 'postgres';
import { buildApp } from './app.js';
import { withRuntime, type Runtime } from './context.js';
import { PG_OPTIONS } from './db.js';
import type { CafeEvent } from './events.js';

export interface Env {
  HYPERDRIVE: Hyperdrive;
  LIVE: DurableObjectNamespace<LiveHub>;
  JWT_SECRET: string;
  CORS_ORIGINS: string;
}

const app = buildApp();

/**
 * One Worker serves the site and admin (static assets, see wrangler.jsonc) and the API. Requests
 * for /api/* and /health reach this handler; everything else is served from web/dist.
 */
export default {
  async fetch(req, env, ctx) {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 24) return new Response('JWT_SECRET is missing or too short. Set it with `wrangler secret put JWT_SECRET`.', { status: 500 });
    // A client per request: Workers can't share sockets between requests. Hyperdrive pools the real connections.
    const sql = postgres(env.HYPERDRIVE.connectionString, { ...PG_OPTIONS, max: 5, fetch_types: false });
    const hub = env.LIVE.get(env.LIVE.idFromName('cafe'));
    const rt: Runtime = {
      sql,
      jwtSecret: env.JWT_SECRET,
      corsOrigins: env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
      publish: e => ctx.waitUntil(hub.publish(e).catch(err => console.error('live feed publish failed', err))),
      allow: (key, max, windowMs) => hub.allow(key, max, windowMs),
      openStream: r => hub.fetch(r),
    };
    try {
      return await withRuntime(rt, () => app.fetch(req, env, ctx));
    } finally {
      ctx.waitUntil(sql.end());
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * The cafe's single live hub. Admin screens hold a hibernating WebSocket here, so an idle
 * connection costs nothing; the Worker calls publish() after each change. It also keeps the
 * per-IP rate-limit counters, which (like the old in-process limiter) reset if it restarts.
 */
export class LiveHub extends DurableObject<Env> {
  private hits = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The admin pings every 30 s to keep proxies from closing the socket; answer without waking up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(_req: Request) {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'hello' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  publish(e: CafeEvent) {
    const msg = JSON.stringify(e);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // Already closing; the admin reconnects on its own.
      }
    }
  }

  allow(key: string, max: number, windowMs: number) {
    const now = Date.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v[v.length - 1] <= now - windowMs) this.hits.delete(k);
    const recent = (this.hits.get(key) ?? []).filter(t => t > now - windowMs);
    const ok = recent.length < max;
    if (ok) recent.push(now);
    this.hits.set(key, recent);
    return ok;
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    // 1005/1006 mean "no code given" / "dropped" and can't be sent back; close plainly then.
    try {
      if (code === 1000 || (code >= 3000 && code <= 4999)) ws.close(code, reason);
      else ws.close();
    } catch {
      // Already closed.
    }
  }
}

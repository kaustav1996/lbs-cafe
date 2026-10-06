import { AsyncLocalStorage } from 'node:async_hooks';
import type postgres from 'postgres';
import type { CafeEvent } from './events.js';

/** Public documents (licences). R2 on Workers, in memory in tests. */
export interface StoredFile {
  body: ReadableStream | ArrayBuffer;
  type: string;
  size: number;
}
export interface FileStore {
  put(key: string, body: ArrayBuffer, type: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}

/**
 * Everything a request needs from its runtime. On Workers a database client can't be shared
 * between requests, so each request gets its own (through Hyperdrive) and code reaches it via
 * `sql` in db.ts. Tests and scripts on Node supply the same shape (see node.ts).
 */
export interface Runtime {
  sql: postgres.Sql;
  jwtSecret: string;
  corsOrigins: string[];
  /** Sends an event to every admin screen that's open. Never throws. */
  publish(e: CafeEvent): void;
  /** Counts a hit against `key`; false once `max` hits land inside `windowMs`. */
  allow(key: string, max: number, windowMs: number): Promise<boolean>;
  /** Hands a signed-in WebSocket upgrade to the live feed. Missing where there's no feed (tests). */
  openStream?(req: Request): Promise<Response>;
  /** The deployed Worker version, reported by /health. Missing outside Cloudflare. */
  version?: string;
  /** Document storage. Missing where no bucket is bound. */
  files?: FileStore;
}

const store = new AsyncLocalStorage<Runtime>();

export const withRuntime = <T>(rt: Runtime, fn: () => T) => store.run(rt, fn);

export function runtime(): Runtime {
  const rt = store.getStore();
  if (!rt) throw new Error('No runtime for this request');
  return rt;
}

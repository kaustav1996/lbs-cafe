import type { CafeEvent } from './events.js';
import type { Role } from './auth.js';

/**
 * Web push to staff phones: new orders, tables calling, orders ready, booking requests. Works with the admin
 * added to the home screen (iPhone 16.4+, Android Chrome), with the phone's own notification sound, even when
 * the admin isn't open. Messages are encrypted for each phone (RFC 8291, aes128gcm) and signed with LB's
 * VAPID key (RFC 8292), all with WebCrypto so it runs on Workers.
 */

export interface Vapid {
  /** Uncompressed P-256 public key, base64url (65 bytes). Public: the browser needs it to subscribe. */
  publicKey: string;
  /** The private scalar d, base64url (32 bytes). A Worker secret. */
  privateKey: string;
  /** Who to contact about this sender (mailto: or https:). */
  subject: string;
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Same tag replaces an earlier notification instead of stacking (and doesn't buzz again). */
  tag: string;
  /** Where tapping it goes. */
  url: string;
  roles: Role[];
}

const FLOOR: Role[] = ['staff', 'server_kitchen', 'manager', 'owner'];
const EVERYONE: Role[] = ['chef', ...FLOOR];

/** What, if anything, an event should push, and to whom. */
export function pushMessage(e: CafeEvent): PushMessage | null {
  const where = (table: string | null, source: string) => (table ? `Table ${table}` : source === 'takeaway' ? 'Takeaway' : 'Counter');
  switch (e.type) {
    case 'order.created':
      return { title: `New order #${e.number}`, body: where(e.table, e.source), tag: `order-${e.orderId}`, url: '/admin', roles: EVERYONE };
    case 'order.updated':
      if (e.status !== 'ready') return null;
      // Every later change to a ready order carries the same tag, so it only buzzes once.
      return { title: `Order #${e.number} is ready`, body: `${where(e.table, e.source)}: take it out`, tag: `ready-${e.orderId}`, url: '/admin', roles: FLOOR };
    case 'service.created': {
      const what = e.kind === 'code' ? 'the table code' : e.kind === 'bill' ? 'the bill' : e.kind === 'water' ? 'water' : 'a server';
      return { title: `Table ${e.table} wants ${what}`, body: e.name ? `${e.name} is asking.` : 'Tap to see it.', tag: `call-${e.id}`, url: '/admin', roles: FLOOR };
    }
    case 'reservation.created':
      return { title: 'New table booking request', body: 'Confirm it or call them back.', tag: `booking-${e.id}`, url: '/admin/bookings', roles: FLOOR };
    default:
      return null;
  }
}

// ---------- encoding ----------
const enc = new TextEncoder();
export function b64u(bytes: ArrayBuffer | Uint8Array) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// ---------- VAPID (RFC 8292) ----------
async function vapidHeader(endpoint: string, v: Vapid) {
  const pub = unb64u(v.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: v.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: v.subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}

// ---------- payload encryption (RFC 8291, aes128gcm) ----------
/** `salt` and `local` are fixed only in tests (RFC 8291's worked example); normally both are fresh per message. */
export async function encrypt(sub: Subscription, plaintext: Uint8Array, salt = crypto.getRandomValues(new Uint8Array(16)), local?: CryptoKeyPair) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  local ??= (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the message, then the 0x02 "last record" delimiter.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/** Sends one push. Returns the push service's HTTP status (201 sent; 404/410 the phone unsubscribed). */
export async function sendPush(sub: Subscription, msg: Omit<PushMessage, 'roles'>, v: Vapid, ttlSeconds = 600): Promise<number> {
  const body = await encrypt(sub, enc.encode(JSON.stringify(msg)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, v),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'high',
      Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
    },
    body,
  });
  return res.status;
}

/** Pushes an event to every active staff member whose role should hear about it. Never throws. */
export async function pushEvent(db: import('postgres').Sql, e: CafeEvent, v: Vapid | undefined) {
  const msg = pushMessage(e);
  if (!msg || !v) return;
  try {
    const subs = await db<(Subscription & { id: number })[]>`
      select p.id, p.endpoint, p.p256dh, p.auth
      from push_subscriptions p join staff s on s.id = p.staff_id
      where s.active and s.role in ${db(msg.roles)}`;
    const { roles: _roles, ...payload } = msg;
    await Promise.all(
      subs.map(async s => {
        try {
          const status = await sendPush(s, payload, v);
          if (status === 404 || status === 410) await db`delete from push_subscriptions where id = ${s.id}`;
          else if (status < 300) await db`update push_subscriptions set last_sent_at = now() where id = ${s.id}`;
          else console.error('push refused', status, new URL(s.endpoint).host);
        } catch (err) {
          console.error('push failed', err);
        }
      }),
    );
  } catch (err) {
    console.error('push lookup failed', err);
  }
}

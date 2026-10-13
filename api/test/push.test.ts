import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, encrypt, pushMessage, sendPush, unb64u, type Vapid } from '../src/push.js';

const enc = new TextEncoder();
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

/** A phone's side: its keys, and decrypting an aes128gcm push the way a browser does (RFC 8291). */
async function phone() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: 'https://push.example.com/send/abc', p256dh: b64u(pub), auth: b64u(auth) };
  const decrypt = async (body: Uint8Array) => {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const sealed = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], keys.privateKey, 256));
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...pub, ...asPublic]);
    const ikm = await hkdf(auth, shared, info, 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
    assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
    return { rs, text: new TextDecoder().decode(plain.slice(0, -1)) };
  };
  return { sub, decrypt };
}

async function vapidKeys(): Promise<Vapid & { verifyKey: CryptoKey }> {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', k.privateKey)) as JsonWebKey;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer);
  return { publicKey: b64u(pub), privateKey: jwk.d!, subject: 'mailto:test@example.com', verifyKey: k.publicKey };
}

test('push payloads decrypt on the phone (aes128gcm)', async () => {
  const p = await phone();
  const msg = JSON.stringify({ title: 'New order #12', body: 'Table 4', tag: 'order-1', url: '/admin' });
  const body = await encrypt(p.sub, enc.encode(msg));
  const out = await p.decrypt(body);
  assert.equal(out.text, msg);
  assert.equal(out.rs, 4096);
});

test('the push request is signed with LB’s VAPID key and carries the encrypted body', async () => {
  const p = await phone();
  const v = await vapidKeys();
  const real = globalThis.fetch;
  let seen: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try {
    const status = await sendPush(p.sub, { title: 'Order #3 is ready', body: 'Table 2: take it out', tag: 'ready-3', url: '/admin' }, v);
    assert.equal(status, 201);
  } finally {
    globalThis.fetch = real;
  }
  const { url, init } = seen!;
  assert.equal(url, p.sub.endpoint);
  const h = init.headers as Record<string, string>;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.equal(h.Urgency, 'high');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);
  assert.ok(m, 'vapid header');
  assert.equal(m![2], v.publicKey);
  const [head, claims, sig] = m![1].split('.');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.verifyKey, unb64u(sig), enc.encode(`${head}.${claims}`));
  assert.ok(ok, 'JWT signature verifies with the public key');
  const c = JSON.parse(new TextDecoder().decode(unb64u(claims)));
  assert.equal(c.aud, 'https://push.example.com');
  assert.equal(c.sub, 'mailto:test@example.com');
  assert.ok(c.exp > Date.now() / 1000 && c.exp <= Date.now() / 1000 + 24 * 3600, 'expires within a day');
  const text = (await p.decrypt(new Uint8Array(init.body as Uint8Array))).text;
  assert.equal(JSON.parse(text).title, 'Order #3 is ready');
});

test('which events push, and to whom', () => {
  const created = pushMessage({ type: 'order.created', orderId: 1, number: 12, source: 'qr', table: '4' })!;
  assert.equal(created.title, 'New order #12');
  assert.equal(created.body, 'Table 4');
  assert.ok(created.roles.includes('chef') && created.roles.includes('staff'));
  const ready = pushMessage({ type: 'order.updated', orderId: 1, number: 12, status: 'ready', source: 'takeaway', table: null })!;
  assert.equal(ready.title, 'Order #12 is ready');
  assert.ok(!ready.roles.includes('chef'), 'the kitchen made it; servers take it out');
  assert.equal(pushMessage({ type: 'order.updated', orderId: 1, number: 12, status: 'preparing', source: 'qr', table: '4' }), null);
  const call = pushMessage({ type: 'service.created', id: 5, table: '7', kind: 'bill' })!;
  assert.equal(call.title, 'Table 7 wants the bill');
  assert.ok(!call.roles.includes('chef'));
  assert.equal(pushMessage({ type: 'menu.updated' }), null);
});

test('matches the worked example in RFC 8291 (Appendix A) byte for byte', async () => {
  const asPublic = unb64u('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPublic.slice(1, 33)), y: b64u(asPublic.slice(33)), ext: true };
  const local = {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  } as CryptoKeyPair;
  const sub = {
    endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  };
  const out = await encrypt(sub, unb64u('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'), unb64u('DGv6ra1nlYgDCS1FRnbzlw'), local);
  const want = new Uint8Array([
    ...unb64u('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
    ...unb64u('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ'),
  ]);
  assert.equal(b64u(out), b64u(want));
});

// Smoke test for a running Worker (wrangler dev or the deployed one). Reads only, plus one table
// order and one waiter call that it cancels/handles again, so it's safe to run against production.
//   BASE=https://lbs-cafe.<you>.workers.dev EMAIL=... PASSWORD=... npx tsx scripts/smoke.ts
import assert from 'node:assert/strict';

const BASE = (process.env.BASE ?? 'http://localhost:8787').replace(/\/$/, '');
const { EMAIL, PASSWORD } = process.env;
const ok = (m: string) => console.log(`ok   ${m}`);

async function call(path: string, init: RequestInit & { json?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { origin: BASE };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(BASE + path, { ...init, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
}

const health = await call('/health');
assert.deepEqual(health.json(), { ok: true });
ok('/health');

const menu = (await call('/api/public/menu')).json().categories;
assert.equal(menu.length, 11);
ok(`menu has ${menu.length} sections, ${menu.flatMap((c: any) => c.items).length} items`);

for (const page of ['/', '/menu', '/admin', '/admin/orders']) {
  const r = await call(page);
  assert.equal(r.status, 200, page);
  assert.match(r.text, /<div id="root">/, page);
}
ok('site and admin pages load (SPA fallback works)');

const head = await call('/');
assert.equal(head.headers.get('x-frame-options'), 'DENY');
ok('security headers from _headers are served');

const missing = await call('/api/nope');
assert.equal(missing.status, 404);
assert.equal(missing.json().error, 'not_found');
ok('unknown API paths get a JSON 404');

if (EMAIL && PASSWORD) {
  const login = await call('/api/auth/login', { method: 'POST', json: { email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 200, login.text);
  const { token, staff } = login.json();
  ok(`signed in as ${staff.name} (${staff.role})`);

  // Open the live feed, then make something happen and wait for it to arrive.
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/auth/stream?token=${encodeURIComponent(token)}`);
  const got: any[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no hello from the live feed')), 10_000);
    ws.onmessage = ev => {
      const m = JSON.parse(String(ev.data));
      got.push(m);
      if (m.type === 'hello') (clearTimeout(t), resolve());
    };
    ws.onerror = () => reject(new Error('live feed connection failed'));
  });
  ok('live feed connected');

  const call1 = await call('/api/public/service-requests', { method: 'POST', json: { table: '12', kind: 'water' } });
  assert.ok([200, 201].includes(call1.status), call1.text);
  const id = call1.json().id;
  for (let i = 0; i < 50 && !got.some(m => m.type === 'service.created' || m.type === 'service.updated'); i++) await new Promise(r => setTimeout(r, 100));
  const done = await call(`/api/admin/service-requests/${id}`, { method: 'PATCH', token, json: {} });
  assert.equal(done.status, 200);
  for (let i = 0; i < 50 && !got.some(m => m.type === 'service.updated'); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(got.some(m => m.type === 'service.updated'), `events seen: ${JSON.stringify(got)}`);
  ok('a waiter call reached the live feed and was marked handled');
  ws.close();

  const fresh = (await call('/api/admin/service-requests', { token })).json().requests;
  assert.ok(!fresh.some((r: any) => r.id === id), 'handled request still listed (stale cache?)');
  ok('admin reads are fresh (no Hyperdrive caching)');
}
console.log('smoke test passed');

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
assert.equal(health.json().ok, true);
ok('/health');

const menu = (await call('/api/public/menu')).json().categories;
assert.equal(menu.length, 11);
ok(`menu has ${menu.length} sections, ${menu.flatMap((c: any) => c.items).length} items`);

for (const page of ['/', '/menu', '/licences', '/admin', '/admin/orders']) {
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

const settings = (await call('/api/public/settings')).json();
assert.ok(Array.isArray(settings.licences), 'public settings have no licences list');
for (const l of settings.licences) if (l.file) assert.equal((await call(`/files/${l.file.key}`)).status, 200, `missing document ${l.file.key}`);
ok(`licences page data: GSTIN ${settings.cafe?.gstin ? 'set' : 'not set'}, ${settings.licences.length} licence(s), documents reachable`);

// Prices an order whose option doesn't belong to its item: runs the real pricing query (a list
// parameter) and is refused before anything is written.
const item = menu[0].items[0];
const wrong = await call('/api/public/orders', {
  method: 'POST',
  json: { mode: 'takeaway', name: 'Smoke test', phone: '9000000000', lines: [{ itemId: item.id, optionId: menu[1].items[0].options[0].id, qty: 1 }] },
});
assert.equal(wrong.status, 409, wrong.text);
assert.equal(wrong.json().error, 'item_gone');
ok('order pricing runs (mismatched item refused, nothing saved)');

const noCode = await call('/api/public/tables/1/verify', { method: 'POST', json: { code: 'smoke' } });
assert.equal(noCode.status, 400, noCode.text);
assert.equal(noCode.json().error, 'bad_code');
ok('table codes are checked (a wrong code for table 1 is refused)');

if (EMAIL && PASSWORD) {
  const login = await call('/api/auth/login', { method: 'POST', json: { email: EMAIL, password: PASSWORD } });
  assert.equal(login.status, 200, login.text);
  const { token, staff } = login.json();
  ok(`signed in as ${staff.name} (${staff.role})`);

  for (const path of ['/api/admin/orders', '/api/admin/orders?view=day', '/api/admin/service-requests', '/api/admin/reservations', '/api/admin/menu', '/api/admin/menu/live', '/api/admin/menus', '/api/admin/customers', '/api/admin/settings', '/api/admin/tables', '/api/admin/staff', `/api/admin/reports/summary?from=2026-01-01&to=2026-12-31`]) {
    const r = await call(path, { token });
    assert.equal(r.status, 200, `${path}: ${r.text}`);
  }
  ok('every admin screen loads its data');

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

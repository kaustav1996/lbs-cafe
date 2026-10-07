// End-to-end flow against a real Postgres. Run with:
// DATABASE_URL=postgres://postgres:postgres@localhost:5433/lbs_test DATABASE_SSL=disable npm test
// The Hono app runs on Node here with an in-memory live feed and rate limiter standing in for the Durable Object.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.OWNER_EMAIL ??= 'owner@lbscafe.test';
process.env.OWNER_PASSWORD ??= 'bandit-owner-pass';

const { buildApp } = await import('../src/app.js');
const { migrate, nodeSql } = await import('../src/migrate.js');
const { withRuntime } = await import('../src/context.js');
const { computeTotals } = await import('../src/money.js');
const { financialYear } = await import('../src/invoices.js');
import type { CafeEvent } from '../src/events.js';

const sql = nodeSql();
const stored = new Map<string, { body: ArrayBuffer; type: string; size: number }>();
const events: CafeEvent[] = [];
const hits = new Map<string, number[]>();
const rt = {
  sql,
  jwtSecret: 'test-secret-at-least-24-characters',
  corsOrigins: ['https://lbscafe.com'],
  publish: (e: CafeEvent) => void events.push(e),
  allow: async (key: string, max: number, windowMs: number) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter(t => t > now - windowMs);
    hits.set(key, recent.length < max ? [...recent, now] : recent);
    return recent.length < max;
  },
  files: {
    put: async (key: string, body: ArrayBuffer, type: string) => void stored.set(key, { body, type, size: body.byteLength }),
    get: async (key: string) => stored.get(key) ?? null,
    delete: async (key: string) => void stored.delete(key),
  },
};

const hono = buildApp();
/** Same shape as Fastify's inject(), so the tests read as before. */
const app = {
  async inject(o: { method: string; url: string; payload?: unknown; form?: FormData; headers?: Record<string, string> }) {
    const headers = { ...o.headers } as Record<string, string>;
    if (o.payload !== undefined) headers['content-type'] = 'application/json';
    const reqBody = o.form ?? (o.payload === undefined ? undefined : JSON.stringify(o.payload));
    const res = await withRuntime(rt, () => hono.request(o.url, { method: o.method, headers, body: reqBody }));
    const body = await res.text();
    return { statusCode: res.status, headers: Object.fromEntries(res.headers), body, json: () => JSON.parse(body) };
  },
};
let token = '';
const auth = () => ({ authorization: `Bearer ${token}` });

before(async () => {
  await sql`drop schema public cascade`;
  await sql`create schema public`;
  await migrate(sql, () => {});
  // Most tests want guest orders on the board straight away; the hold tests switch it on.
  await sql`update settings set value = '0'::jsonb where key = 'hold_seconds'`;
});
after(async () => {
  await sql.end();
});

test('GST maths: 18% split into CGST and SGST, total rounded to the rupee', () => {
  const t = computeTotals(56800, 0, 0.18); // ₹568
  assert.equal(t.cgst, 5112);
  assert.equal(t.sgst, 5112);
  assert.equal(t.total, 67000); // ₹670.24 rounds to ₹670
  assert.equal(t.roundOff, -24);
  const d = computeTotals(56800, 6800, 0.18); // ₹68 discount
  assert.equal(d.taxable, 50000);
  assert.equal(d.total, 59000);
});

let menu: any[] = [];
test('public menu is seeded from the old site', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/public/menu' });
  assert.equal(r.statusCode, 200);
  menu = r.json().categories;
  assert.equal(menu.length, 11);
  const options = menu.flatMap(c => c.items.flatMap((i: any) => i.options));
  assert.equal(options.length, 139);
  const s = (await app.inject({ method: 'GET', url: '/api/public/settings' })).json();
  assert.equal(s.gstRate, 0.18);
  assert.equal(s.hours[1].open, '10:00');
});

const find = (name: string, label = '') => {
  for (const c of menu) for (const i of c.items) if (i.name === name) {
    const o = i.options.find((x: any) => x.label === label) ?? i.options[0];
    return { itemId: i.id, optionId: o.id, price: o.price_paise };
  }
  throw new Error('not on menu: ' + name);
};

/** The table's current code, read straight from the database, and a pass made with it (what a guest's phone holds). */
const codeFor = async (label: string) => (await sql<{ otp: string }[]>`select otp from dining_tables where label = ${label}`)[0].otp;
const passFor = async (label: string) => {
  const r = await app.inject({ method: 'POST', url: `/api/public/tables/${label}/verify`, payload: { code: await codeFor(label) } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().pass as string;
};

let orderToken = '';
let orderId = 0;
test('a table orders from the QR menu; prices come from the server', async () => {
  const affogato = find('Affogato');
  const burritos = find('Burritos', 'Non-veg');
  const r = await app.inject({
    method: 'POST',
    url: '/api/public/orders',
    payload: { mode: 'table', table: '5', pass: await passFor('5'), note: 'less ice', lines: [{ ...affogato, qty: 2 }, { ...burritos, qty: 1 }] },
  });
  assert.equal(r.statusCode, 201, r.body);
  const { token: t, order } = r.json();
  orderToken = t;
  assert.equal(order.totals.subtotal, 2 * 20900 + 35900);
  assert.equal(order.table, '5');
  const st = await app.inject({ method: 'GET', url: `/api/public/orders/${t}` });
  assert.equal(st.json().order.status, 'new');
});

test('unknown tables and takeaway without a phone are refused with a clear message', async () => {
  const x = find('Espresso');
  const bad = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '99', lines: [{ ...x, qty: 1 }] } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().message, /table "99"/);
  const tk = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', lines: [{ ...x, qty: 1 }] } });
  assert.equal(tk.statusCode, 400);
  assert.match(tk.json().message, /mobile number/);
});

test('staff sign in; wrong password is rejected', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@lbscafe.test', password: 'nope' } });
  assert.equal(bad.statusCode, 401);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@lbscafe.test', password: 'bandit-owner-pass' } });
  assert.equal(r.statusCode, 200);
  token = r.json().token;
  const no = await app.inject({ method: 'GET', url: '/api/admin/orders' });
  assert.equal(no.statusCode, 401);
});

test('the order shows on the live board, moves through the kitchen, and is paid by UPI', async () => {
  const open = (await app.inject({ method: 'GET', url: '/api/admin/orders', headers: auth() })).json().orders;
  assert.equal(open.length, 1);
  orderId = open[0].id;
  assert.equal(open[0].lines.length, 2);
  for (const status of ['preparing', 'ready', 'served']) {
    const r = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${orderId}`, headers: auth(), payload: { status } });
    assert.equal(r.json().order.status, status);
  }
  const o = (await app.inject({ method: 'GET', url: `/api/admin/orders/${orderId}`, headers: auth() })).json().order;
  const pay = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/payments`, headers: auth(), payload: { method: 'upi', amountPaise: o.total_paise, reference: 'UPI-628301' } });
  assert.equal(pay.json().order.payment_status, 'paid');
  const done = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${orderId}`, headers: auth(), payload: { status: 'completed' } });
  assert.equal(done.json().order.status, 'completed');
  const st = (await app.inject({ method: 'GET', url: `/api/public/orders/${orderToken}` })).json().order;
  assert.equal(st.status, 'completed');
});

test('counter (POS) order with a discount, split cash + card', async () => {
  const pizza = find('Classic Margherita');
  const r = await app.inject({
    method: 'POST',
    url: '/api/admin/orders',
    headers: auth(),
    payload: { source: 'takeaway', name: 'Ananyo', phone: '98745 63210', lines: [{ ...pizza, qty: 2 }], discountPaise: 4900, discountNote: 'Regular' },
  });
  assert.equal(r.statusCode, 201, r.body);
  const o = r.json().order;
  assert.equal(o.subtotal_paise, 69800);
  assert.equal(o.taxable_paise, 64900);
  await app.inject({ method: 'POST', url: `/api/admin/orders/${o.id}/payments`, headers: auth(), payload: { method: 'cash', amountPaise: 50000 } });
  const p2 = await app.inject({ method: 'POST', url: `/api/admin/orders/${o.id}/payments`, headers: auth(), payload: { method: 'card', amountPaise: o.total_paise - 50000, reference: 'AUTH 004512' } });
  assert.equal(p2.json().order.payment_status, 'paid');
  const cust = (await app.inject({ method: 'GET', url: '/api/admin/customers', headers: auth() })).json().customers;
  assert.equal(cust[0].phone, '+919874563210');
  assert.equal(cust[0].visits, 1);
});

test('sold-out items cannot be ordered online', async () => {
  const x = find('Dirty Matcha');
  await app.inject({ method: 'PATCH', url: `/api/admin/items/${x.itemId}`, headers: auth(), payload: { available: false } });
  const r = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '2', pass: await passFor('2'), lines: [{ itemId: x.itemId, optionId: x.optionId, qty: 1 }] } });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().message, /sold out/);
});

test('call a server, then mark it handled', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/public/service-requests', payload: { table: '5', kind: 'bill' } });
  assert.equal(r.statusCode, 201);
  const list = (await app.inject({ method: 'GET', url: '/api/admin/service-requests', headers: auth() })).json().requests;
  assert.equal(list.length, 1);
  await app.inject({ method: 'PATCH', url: `/api/admin/service-requests/${list[0].id}`, headers: auth(), payload: {} });
  const after = (await app.inject({ method: 'GET', url: '/api/admin/service-requests', headers: auth() })).json().requests;
  assert.equal(after.length, 0);
});

test('online booking lands as pending and staff confirm it', async () => {
  const d = new Date(Date.now() + 2 * 86400000);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  const r = await app.inject({ method: 'POST', url: '/api/public/reservations', payload: { name: 'Shivam', phone: '9876543210', partySize: 4, date, time: '19:30' } });
  assert.equal(r.statusCode, 201, r.body);
  const list = (await app.inject({ method: 'GET', url: `/api/admin/reservations?from=${date}&to=${date}`, headers: auth() })).json();
  assert.equal(list.reservations.length, 1);
  assert.equal(list.pending, 1);
  const c = await app.inject({ method: 'PATCH', url: `/api/admin/reservations/${list.reservations[0].id}`, headers: auth(), payload: { status: 'confirmed', table: '7' } });
  assert.equal(c.json().reservation.status, 'confirmed');
  const late = await app.inject({ method: 'POST', url: '/api/public/reservations', payload: { name: 'X', phone: '9876543210', partySize: 2, date, time: '23:30' } });
  assert.equal(late.statusCode, 400);
});

test('reports: sales summary and GST export add up', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const s = (await app.inject({ method: 'GET', url: `/api/admin/reports/summary?from=${today}&to=${today}`, headers: auth() })).json();
  assert.equal(s.totals.orders, 2);
  assert.equal(Number(s.totals.cgst) , Number(s.totals.sgst));
  const collected = s.byMethod.reduce((a: number, m: any) => a + Number(m.amount), 0);
  assert.equal(collected, Number(s.totals.gross));
  assert.equal(s.topItems.find((i: any) => i.name === 'Affogato').qty, 2);
  const csv = await app.inject({ method: 'GET', url: `/api/admin/reports/gst?from=${today}&to=${today}&format=csv`, headers: auth() });
  assert.equal(csv.statusCode, 200);
  assert.match(csv.headers['content-type'] as string, /text\/csv/);
  assert.equal(csv.body.trim().split('\n').length, 3);
  assert.match(csv.body, /CGST 9%/);
});

test('staff accounts cannot give discounts or cancel', async () => {
  await app.inject({ method: 'POST', url: '/api/admin/staff', headers: auth(), payload: { name: 'Server', email: 'server@lbscafe.test', password: 'server-pass-1', role: 'staff' } });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'server@lbscafe.test', password: 'server-pass-1' } });
  const st = { authorization: `Bearer ${login.json().token}` };
  const r = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${orderId}`, headers: st, payload: { discountPaise: 1000 } });
  assert.equal(r.statusCode, 403);
  const avail = await app.inject({ method: 'PATCH', url: `/api/admin/items/${find('Espresso').itemId}`, headers: st, payload: { available: false } });
  assert.equal(avail.statusCode, 200);
  const edit = await app.inject({ method: 'PATCH', url: `/api/admin/items/${find('Espresso').itemId}`, headers: st, payload: { name: 'Espresso!' } });
  assert.equal(edit.statusCode, 403);
});

test('changes reach the live feed', () => {
  const types = new Set(events.map(e => e.type));
  for (const t of ['order.created', 'order.updated', 'service.created', 'service.updated', 'reservation.created', 'reservation.updated', 'menu.updated'])
    assert.ok(types.has(t as CafeEvent['type']), `no ${t} event`);
});

test('the live feed needs a valid token and a WebSocket', async () => {
  const bad = await app.inject({ method: 'GET', url: '/api/auth/stream?token=nope' });
  assert.equal(bad.statusCode, 401);
  const plain = await app.inject({ method: 'GET', url: `/api/auth/stream?token=${token}` });
  assert.equal(plain.statusCode, 426);
});

test('CORS allows the cafe site and refuses others', async () => {
  const ok = await app.inject({ method: 'GET', url: '/api/public/settings', headers: { origin: 'https://lbscafe.com' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'https://lbscafe.com');
  const no = await app.inject({ method: 'GET', url: '/api/public/settings', headers: { origin: 'https://evil.example' } });
  assert.equal(no.headers['access-control-allow-origin'], undefined);
});

test('repeated wrong passwords are slowed down', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++)
    last = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'cf-connecting-ip': '203.0.113.9' }, payload: { email: 'x@y.in', password: 'nope' } })).statusCode;
  assert.equal(last, 429);
});

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // "%PDF-1.4\n"
const upload = (bytes: Uint8Array, name: string, type: string, headers = auth()) => {
  const form = new FormData();
  form.set('file', new File([bytes], name, { type }));
  return app.inject({ method: 'POST', url: '/api/admin/files', headers, form });
};

test('licences: upload a document, list it publicly, serve it, delete it with the entry', async () => {
  const up = await upload(PDF, 'FSSAI Licence 2026.pdf', 'application/pdf');
  assert.equal(up.statusCode, 201, up.body);
  const file = up.json().file;
  assert.match(file.key, /^licences\/[a-f0-9]{8}-fssai-licence-2026\.pdf$/);

  const save = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: auth(),
    payload: { cafe: { gstin: '19CNLPC1427M1ZS' }, licences: [{ id: 'fssai01', name: 'FSSAI licence', number: '12826999000123', validUntil: '2027-03-31', file }] },
  });
  assert.equal(save.statusCode, 200, save.body);

  const pub = (await app.inject({ method: 'GET', url: '/api/public/settings' })).json();
  assert.equal(pub.cafe.gstin, '19CNLPC1427M1ZS');
  assert.equal(pub.licences[0].name, 'FSSAI licence');
  assert.equal(pub.licences[0].file.key, file.key);

  const got = await app.inject({ method: 'GET', url: `/files/${file.key}` });
  assert.equal(got.statusCode, 200);
  assert.equal(got.headers['content-type'], 'application/pdf');
  assert.equal(got.headers['x-content-type-options'], 'nosniff');

  const cleared = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: auth(), payload: { licences: [] } });
  assert.equal(cleared.statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/files/${file.key}` })).statusCode, 404);
});

test('licences: wrong types, disguised files, empty files and staff uploads are refused', async () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  const disguised = await upload(html, 'licence.pdf', 'application/pdf');
  assert.equal(disguised.statusCode, 400);
  assert.match(disguised.json().message, /PDF or an image/);
  assert.equal((await upload(html, 'page.html', 'text/html')).statusCode, 400);
  assert.equal((await upload(new Uint8Array(0), 'x.pdf', 'application/pdf')).statusCode, 400);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'server@lbscafe.test', password: 'server-pass-1' } });
  assert.equal((await upload(PDF, 'x.pdf', 'application/pdf', { authorization: `Bearer ${login.json().token}` })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/files/../secret' })).statusCode, 404);
  const badRef = await app.inject({
    method: 'PUT', url: '/api/admin/settings', headers: auth(),
    payload: { licences: [{ id: 'evil001', name: 'X', file: { key: '../../etc/passwd', name: 'x', type: 'application/pdf', size: 1 } }] },
  });
  assert.equal(badRef.statusCode, 400);
});

test('table codes: an order needs the table\'s code; wrong codes and other tables\' passes are refused', async () => {
  const x = find('Americano');
  const order = (body: object) => app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '7', lines: [{ ...x, qty: 1 }], ...body } });

  const none = await order({});
  assert.equal(none.statusCode, 403);
  assert.equal(none.json().error, 'table_code');
  assert.match(none.json().message, /table 7's code/);

  const real = await codeFor('7');
  const wrongCode = real === '0000' ? '1111' : '0000';
  const wrong = await app.inject({ method: 'POST', url: '/api/public/tables/7/verify', payload: { code: wrongCode } });
  assert.equal(wrong.statusCode, 400);
  assert.match(wrong.json().message, /doesn't match table 7/);

  assert.equal((await order({ pass: await passFor('8') })).statusCode, 403); // table 8's pass at table 7
  const pass = await passFor('7');
  const ok = await order({ pass });
  assert.equal(ok.statusCode, 201, ok.body);
  // The same phone keeps ordering for the rest of the sitting.
  assert.equal((await order({ pass })).statusCode, 201);

  // A pass is never a staff login.
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/orders', headers: { authorization: `Bearer ${pass}` } })).statusCode, 401);
});

test('table codes: settling the table\'s last order changes the code; the old pass stops working', async () => {
  const pass = await passFor('7');
  const open = (await app.inject({ method: 'GET', url: '/api/admin/orders', headers: auth() })).json().orders.filter((o: any) => o.table_label === '7');
  assert.equal(open.length, 2);
  for (const [i, o] of open.entries()) {
    await app.inject({ method: 'POST', url: `/api/admin/orders/${o.id}/payments`, headers: auth(), payload: { method: 'cash', amountPaise: o.total_paise } });
    await app.inject({ method: 'PATCH', url: `/api/admin/orders/${o.id}`, headers: auth(), payload: { status: 'completed' } });
    const sitting = (await sql<{ sitting: number }[]>`select sitting from dining_tables where label = '7'`)[0].sitting;
    // Still busy after the first order closes; free (new sitting) only after the last.
    assert.equal(sitting, i === 0 ? 1 : 2);
  }
  const x = find('Americano');
  const stale = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '7', pass, lines: [{ ...x, qty: 1 }] } });
  assert.equal(stale.statusCode, 403);
  assert.equal(events.some(e => e.type === 'table.updated'), true);
});

test('table codes: any staff member sees the codes and can reset one', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'server@lbscafe.test', password: 'server-pass-1' } });
  const st = { authorization: `Bearer ${login.json().token}` };
  const tables = (await app.inject({ method: 'GET', url: '/api/admin/tables', headers: st })).json().tables;
  const t3 = tables.find((t: any) => t.label === '3');
  assert.match(t3.otp, /^\d{4}$/);
  const pass = await passFor('3');
  const reset = await app.inject({ method: 'POST', url: `/api/admin/tables/${t3.id}/new-code`, headers: st });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().table.sitting, t3.sitting + 1);
  const x = find('Americano');
  const stale = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '3', pass, lines: [{ ...x, qty: 1 }] } });
  assert.equal(stale.statusCode, 403);
  // Seats stay manager-only.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/tables/${t3.id}`, headers: st, payload: { seats: 6 } })).statusCode, 403);
});

test('table codes: wrong guesses are limited per table, not for the whole room', async () => {
  const guess = (label: string) =>
    app.inject({ method: 'POST', url: `/api/public/tables/${label}/verify`, headers: { 'cf-connecting-ip': '198.51.100.7' }, payload: { code: 'zzzz' } });
  for (let i = 0; i < 5; i++) assert.equal((await guess('9')).statusCode, 400);
  assert.equal((await guess('9')).statusCode, 429);
  assert.equal((await guess('10')).statusCode, 400); // same Wi-Fi, another table: not locked out
});

test('menus: a Puja menu copied from Regular, with fewer dishes and its own price, goes live', async () => {
  const menus = (await app.inject({ method: 'GET', url: '/api/admin/menus', headers: auth() })).json().menus;
  const regular = menus.find((m: any) => m.live);
  assert.equal(regular.name, 'Regular');
  assert.equal(regular.items, 126);

  const made = await app.inject({ method: 'POST', url: '/api/admin/menus', headers: auth(), payload: { name: 'Durga Puja', copyFrom: regular.id } });
  assert.equal(made.statusCode, 201, made.body);
  const puja = made.json().menu;
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/menus', headers: auth(), payload: { name: 'Durga Puja' } })).statusCode, 409);

  const latte = find('Cafe Latte');
  const mocha = find('Mocha');
  // Take Mocha off the Puja menu; Cafe Latte costs ₹159 there instead of ₹189.
  assert.equal((await app.inject({ method: 'PUT', url: `/api/admin/menus/${puja.id}/items/${mocha.itemId}`, headers: auth(), payload: { on: false } })).statusCode, 200);
  const priced = await app.inject({ method: 'PUT', url: `/api/admin/menus/${puja.id}/items/${latte.itemId}`, headers: auth(), payload: { on: true, prices: { [latte.optionId]: 15900 } } });
  assert.equal(priced.statusCode, 200, priced.body);
  // A price for another dish's option is refused.
  assert.equal((await app.inject({ method: 'PUT', url: `/api/admin/menus/${puja.id}/items/${latte.itemId}`, headers: auth(), payload: { on: true, prices: { [mocha.optionId]: 100 } } })).statusCode, 400);

  // Not live yet: guests still see Regular.
  const names = (cats: any[]) => cats.flatMap(c => c.items.map((i: any) => i.name));
  assert.ok(names((await app.inject({ method: 'GET', url: '/api/public/menu' })).json().categories).includes('Mocha'));

  assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/menus/${puja.id}`, headers: auth(), payload: { live: true } })).statusCode, 200);
  const live = (await app.inject({ method: 'GET', url: '/api/public/menu' })).json().categories;
  assert.ok(!names(live).includes('Mocha'));
  const liveLatte = live.flatMap((c: any) => c.items).find((i: any) => i.name === 'Cafe Latte');
  assert.equal(liveLatte.options[0].price_paise, 15900);
  assert.ok(events.some(e => e.type === 'menu.updated'));

  // Orders are priced from the live menu, and dishes not on it are refused.
  const takeaway = (lines: object[]) => app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', phone: '9876500000', lines } });
  const gone = await takeaway([{ ...mocha, qty: 1 }]);
  assert.equal(gone.statusCode, 409);
  assert.equal(gone.json().error, 'item_gone');
  const ok = await takeaway([{ ...latte, qty: 2 }]);
  assert.equal(ok.statusCode, 201, ok.body);
  assert.equal(ok.json().order.totals.subtotal, 2 * 15900);

  // The staff picker sees the live menu at live prices, sold-out dishes included (Espresso was sold out earlier).
  const picker = (await app.inject({ method: 'GET', url: '/api/admin/menu/live', headers: auth() })).json().categories;
  assert.ok(!names(picker).includes('Mocha'));
  assert.ok(names(picker).includes('Espresso'));
  // The editor still sees the whole master list at normal prices.
  const master = (await app.inject({ method: 'GET', url: '/api/admin/menu', headers: auth() })).json().categories;
  assert.ok(names(master).includes('Mocha'));
  assert.equal(master.flatMap((c: any) => c.items).find((i: any) => i.name === 'Cafe Latte').options[0].price_paise, 18900);

  // Only one menu is live, and the live one can't be deleted.
  const after = (await app.inject({ method: 'GET', url: '/api/admin/menus', headers: auth() })).json().menus;
  assert.equal(after.filter((m: any) => m.live).length, 1);
  const del = await app.inject({ method: 'DELETE', url: `/api/admin/menus/${puja.id}`, headers: auth() });
  assert.equal(del.statusCode, 409);
  assert.match(del.json().message, /another menu live/);

  // A new dish added while editing the Puja menu lands on it.
  const cat = master[0].id;
  const added = await app.inject({ method: 'POST', url: '/api/admin/items', headers: auth(), payload: { categoryId: cat, name: 'Puja Bhog Thali', menuId: puja.id, options: [{ label: '', diet: 'veg', pricePaise: 29900 }] } });
  assert.equal(added.statusCode, 201, added.body);
  const pujaDetail = (await app.inject({ method: 'GET', url: `/api/admin/menus/${puja.id}`, headers: auth() })).json();
  assert.ok(pujaDetail.itemIds.includes(added.json().id));
  assert.ok(!(await app.inject({ method: 'GET', url: `/api/admin/menus/${regular.id}`, headers: auth() })).json().itemIds.includes(added.json().id));

  // Switch back; Puja can now be deleted.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/menus/${regular.id}`, headers: auth(), payload: { live: true } })).statusCode, 200);
  assert.ok(names((await app.inject({ method: 'GET', url: '/api/public/menu' })).json().categories).includes('Mocha'));
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/menus/${puja.id}`, headers: auth() })).statusCode, 200);
});

test('menus: staff can view menus but not change them', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'server@lbscafe.test', password: 'server-pass-1' } });
  const st = { authorization: `Bearer ${login.json().token}` };
  const menus = await app.inject({ method: 'GET', url: '/api/admin/menus', headers: st });
  assert.equal(menus.statusCode, 200);
  const id = menus.json().menus[0].id;
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/menus', headers: st, payload: { name: 'Sneaky' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/menus/${id}`, headers: st, payload: { live: true } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url: `/api/admin/menus/${id}/items/${find('Mocha').itemId}`, headers: st, payload: { on: false } })).statusCode, 403);
});

test('hold: a guest order waits, out of sight of staff, and can be changed', async () => {
  assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: auth(), payload: { hold_seconds: 1 } })).statusCode, 200);
  const latte = find('Cafe Latte');
  const placed = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', name: 'Riya', phone: '9123400001', lines: [{ ...latte, qty: 2 }] } });
  assert.equal(placed.statusCode, 201, placed.body);
  const { token, order } = placed.json();
  assert.equal(order.status, 'held');
  assert.equal(order.number, null);
  assert.ok(order.holdSecondsLeft >= 1 && order.holdSecondsLeft <= 2);

  const [{ id }] = await sql<{ id: number }[]>`select id from orders where token = ${token}`;
  const board = (await app.inject({ method: 'GET', url: '/api/admin/orders', headers: auth() })).json().orders;
  assert.ok(!board.some((o: any) => o.id === id), 'held order is on the board');
  assert.equal((await app.inject({ method: 'GET', url: `/api/admin/orders/${id}`, headers: auth() })).statusCode, 404);
  const pay = await app.inject({ method: 'POST', url: `/api/admin/orders/${id}/payments`, headers: auth(), payload: { method: 'cash', amountPaise: 100 } });
  assert.equal(pay.statusCode, 409);
  assert.match(pay.json().message, /hasn't reached the kitchen/);

  // Change order: the order goes, its lines come back, and nothing is left behind.
  const w = await app.inject({ method: 'POST', url: `/api/public/orders/${token}/withdraw` });
  assert.equal(w.statusCode, 200, w.body);
  assert.deepEqual(w.json().lines, [{ itemId: latte.itemId, optionId: latte.optionId, qty: 2 }]);
  assert.equal((await app.inject({ method: 'GET', url: `/api/public/orders/${token}` })).statusCode, 404);
  assert.equal((await sql`select 1 from customers where phone = '+919123400001'`).length, 0);
});

test('hold: after the minute the order reaches the kitchen with the next number; then it can\'t be withdrawn', async () => {
  const [{ max }] = await sql<{ max: number }[]>`select max(number)::int as max from orders`;
  const latte = find('Cafe Latte');
  // A withdrawn order in between must not use up a number.
  const gone = (await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', phone: '9123400002', lines: [{ ...latte, qty: 1 }] } })).json();
  assert.equal((await app.inject({ method: 'POST', url: `/api/public/orders/${gone.token}/withdraw` })).statusCode, 200);

  const kept = (await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', name: 'Arko', phone: '9123400003', lines: [{ ...latte, qty: 1 }] } })).json();
  const before = events.length;
  await new Promise(r => setTimeout(r, 1300));
  const now = (await app.inject({ method: 'GET', url: `/api/public/orders/${kept.token}` })).json().order;
  assert.equal(now.status, 'new');
  assert.equal(now.number, max + 1);
  assert.equal(now.holdSecondsLeft, null);
  assert.ok(events.slice(before).some(e => e.type === 'order.created' && e.number === max + 1));
  assert.equal((await sql`select 1 from customers where phone = '+919123400003'`).length, 1);
  const board = (await app.inject({ method: 'GET', url: '/api/admin/orders', headers: auth() })).json().orders;
  assert.ok(board.some((o: any) => o.number === max + 1));

  const late = await app.inject({ method: 'POST', url: `/api/public/orders/${kept.token}/withdraw` });
  assert.equal(late.statusCode, 409);
  assert.equal(late.json().error, 'too_late');
});

test('hold: the admin board releases overdue orders itself, and staff orders are never held', async () => {
  const latte = find('Cafe Latte');
  const placed = (await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', phone: '9123400004', lines: [{ ...latte, qty: 1 }] } })).json();
  await new Promise(r => setTimeout(r, 1300));
  // Nobody opened the guest page; the board's own check releases it (backstop for a late alarm).
  const board = (await app.inject({ method: 'GET', url: '/api/admin/orders', headers: auth() })).json().orders;
  assert.ok(board.some((o: any) => o.token === placed.token && o.status === 'new'));

  const counter = await app.inject({ method: 'POST', url: '/api/admin/orders', headers: auth(), payload: { source: 'counter', lines: [{ ...latte, qty: 1 }] } });
  assert.equal(counter.statusCode, 201, counter.body);
  assert.equal(counter.json().order.status, 'new');
  assert.ok(counter.json().order.number > 0);

  // Reports never count a held order.
  const held = (await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', phone: '9123400005', lines: [{ ...latte, qty: 50 }] } })).json();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const gst = (await app.inject({ method: 'GET', url: `/api/admin/reports/gst?from=${day}&to=${day}`, headers: auth() })).json().rows;
  assert.ok(!gst.some((r: any) => r.number === null));
  assert.equal((await app.inject({ method: 'POST', url: `/api/public/orders/${held.token}/withdraw` })).statusCode, 200);
  await sql`update settings set value = '0'::jsonb where key = 'hold_seconds'`;
});

// ---------- Invoices ----------
const placeAt = async (table: string, lines: object[]) => {
  const r = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table, pass: await passFor(table), lines } });
  assert.equal(r.statusCode, 201, r.body);
  return (await sql<{ id: number }[]>`select id from orders where token = ${r.json().token}`)[0].id;
};
const invoiceFor = async (orderId: number) => {
  const r = await app.inject({ method: 'POST', url: '/api/admin/invoices', headers: auth(), payload: { orderId } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().invoice;
};
const payInv = (id: number, payload: object) => app.inject({ method: 'POST', url: `/api/admin/invoices/${id}/payments`, headers: auth(), payload });

test('invoices: financial year and numbering', () => {
  // 31 March 23:30 in Kolkata is still 2025-26; 1 April 01:30 is 2026-27.
  assert.equal(financialYear(new Date('2026-03-31T18:00:00Z')), '25-26');
  assert.equal(financialYear(new Date('2026-03-31T20:00:00Z')), '26-27');
});

let tableInvoice: any;
test('invoices: one bill per table visit; later orders join it, held ones don\'t', async () => {
  const latte = find('Cafe Latte');
  const americano = find('Americano');
  const first = await placeAt('11', [{ ...latte, qty: 1 }]);
  await placeAt('11', [{ ...latte, qty: 2 }, { ...americano, qty: 1 }]);
  tableInvoice = await invoiceFor(first);
  assert.match(tableInvoice.number, new RegExp(`^LB/${financialYear()}/00001$`));
  assert.equal(tableInvoice.orders.length, 2);
  assert.equal(tableInvoice.table, '11');
  assert.equal(tableInvoice.status, 'open');
  const latteLine = tableInvoice.lines.find((l: any) => l.name === 'Cafe Latte');
  assert.equal(latteLine.qty, 3); // merged across the two orders
  assert.equal(tableInvoice.cafe.name, "LB's Hemp Cafe & Lounge");
  assert.equal(tableInvoice.totals.due, tableInvoice.totals.total);

  // Asking again gives the same bill.
  assert.equal((await invoiceFor(first)).number, tableInvoice.number);
  // A later order at the same table and visit joins it.
  await placeAt('11', [{ ...americano, qty: 1 }]);
  // A held one doesn't (until it reaches the kitchen).
  await sql`update settings set value = '1'::jsonb where key = 'hold_seconds'`;
  const held = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '11', pass: await passFor('11'), lines: [{ ...latte, qty: 1 }] } });
  await sql`update settings set value = '0'::jsonb where key = 'hold_seconds'`;
  const now = (await app.inject({ method: 'GET', url: `/api/admin/invoices/${tableInvoice.id}`, headers: auth() })).json().invoice;
  assert.equal(now.orders.length, 3);
  assert.equal((await app.inject({ method: 'POST', url: `/api/public/orders/${held.json().token}/withdraw` })).statusCode, 200);
  tableInvoice = now;
  assert.ok(events.some(e => e.type === 'invoice.updated' && e.id === tableInvoice.id));
});

test('invoices: payments need a transaction ID for card/UPI, can\'t overpay, and split oldest first', async () => {
  const id = tableInvoice.id;
  const noRef = await payInv(id, { method: 'card', amountPaise: 10000 });
  assert.equal(noRef.statusCode, 400);
  assert.equal(noRef.json().error, 'no_reference');
  const over = await payInv(id, { method: 'cash', amountPaise: tableInvoice.totals.due + 100 });
  assert.equal(over.statusCode, 400);
  assert.match(over.json().message, /more than the ₹[\d,.]+ still due/);

  // An order on a bill is paid through the bill.
  const [first] = await sql<{ id: number; total_paise: number }[]>`select id, total_paise from orders where invoice_id = ${id} order by created_at, id limit 1`;
  const perOrder = await app.inject({ method: 'POST', url: `/api/admin/orders/${first.id}/payments`, headers: auth(), payload: { method: 'cash', amountPaise: 100 } });
  assert.equal(perOrder.statusCode, 409);
  assert.equal(perOrder.json().error, 'use_invoice');

  // ₹ first order's total + ₹10 in cash: covers the first order and ₹10 of the second.
  const part = await payInv(id, { method: 'cash', amountPaise: first.total_paise + 1000 });
  assert.equal(part.statusCode, 200, part.body);
  const rows = await sql<{ order_id: number; amount_paise: number; txn_group: string }[]>`select order_id, amount_paise, txn_group from payments where invoice_id = ${id} order by id`;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].order_id, first.id);
  assert.equal(rows[0].amount_paise, first.total_paise);
  assert.equal(rows[1].amount_paise, 1000);
  assert.equal(rows[0].txn_group, rows[1].txn_group);
  assert.equal(part.json().invoice.status, 'open');
  assert.equal(part.json().invoice.payments.length, 1); // one transaction on the bill

  const rest = await payInv(id, { method: 'upi', reference: 'UPI-77120', });
  assert.equal(rest.statusCode, 200, rest.body);
  const paid = rest.json().invoice;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.totals.due, 0);
  assert.equal(paid.payments[1].reference, 'UPI-77120');
  assert.equal(paid.payments[1].staff, 'Owner');
  assert.equal((await payInv(id, { method: 'cash', amountPaise: 100 })).statusCode, 409);
});

test('invoices: a paid bill locks its orders, except moving them forward; then the table frees up', async () => {
  const orders = await sql<{ id: number }[]>`select id from orders where invoice_id = ${tableInvoice.id} order by id`;
  const disc = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${orders[0].id}`, headers: auth(), payload: { discountPaise: 500 } });
  assert.equal(disc.statusCode, 409);
  assert.match(disc.json().message, /paid invoice LB\/.*can't be changed/);
  const move = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${orders[0].id}`, headers: auth(), payload: { table: '12' } });
  assert.equal(move.statusCode, 409);
  const sitting = async () => (await sql<{ sitting: number }[]>`select sitting from dining_tables where label = '11'`)[0].sitting;
  const before = await sitting();
  for (const o of orders) {
    const r = await app.inject({ method: 'PATCH', url: `/api/admin/orders/${o.id}`, headers: auth(), payload: { status: 'completed' } });
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(await sitting(), before + 1);
});

test('invoices: takeaway bills, consecutive numbers, prepaid bills, and cancelling the last unpaid order', async () => {
  const latte = find('Cafe Latte');
  // Paid at the counter before anyone asked for the bill: the bill is born paid.
  const t = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'takeaway', phone: '9123400010', lines: [{ ...latte, qty: 1 }] } });
  const [{ id: tid, total_paise }] = await sql<{ id: number; total_paise: number }[]>`select id, total_paise from orders where token = ${t.json().token}`;
  assert.equal((await app.inject({ method: 'POST', url: `/api/admin/orders/${tid}/payments`, headers: auth(), payload: { method: 'cash', amountPaise: total_paise } })).statusCode, 200);
  const guest = await app.inject({ method: 'POST', url: `/api/public/orders/${t.json().token}/bill` });
  assert.equal(guest.statusCode, 200, guest.body);
  const tinv = (await app.inject({ method: 'GET', url: `/api/public/invoices/${guest.json().token}` })).json().invoice;
  assert.match(tinv.number, /\/00002$/);
  assert.equal(tinv.status, 'paid');
  assert.equal(tinv.table, null);
  assert.equal(tinv.payments[0].staff, undefined); // guests don't see who took it

  // Table 12: two orders on one bill; pay the first; cancelling the second settles the bill.
  const a = await placeAt('12', [{ ...latte, qty: 1 }]);
  const b = await placeAt('12', [{ ...latte, qty: 3 }]);
  const inv = await invoiceFor(a);
  assert.match(inv.number, /\/00003$/);
  const [{ total_paise: aTotal }] = await sql<{ total_paise: number }[]>`select total_paise from orders where id = ${a}`;
  assert.equal((await payInv(inv.id, { method: 'cash', amountPaise: aTotal })).json().invoice.status, 'open');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/admin/orders/${b}`, headers: auth(), payload: { status: 'cancelled' } })).statusCode, 200);
  const after = (await app.inject({ method: 'GET', url: `/api/admin/invoices/${inv.id}`, headers: auth() })).json().invoice;
  assert.equal(after.status, 'paid');
  assert.equal(after.orders.length, 1);
});

test('invoices: a staff order at a table with an open bill joins it, and pay-now pays the bill', async () => {
  const latte = find('Cafe Latte');
  const guestOrder = await placeAt('10', [{ ...latte, qty: 1 }]);
  const inv = await invoiceFor(guestOrder);
  const staff = await app.inject({ method: 'POST', url: '/api/admin/orders', headers: auth(), payload: { source: 'table', table: '10', lines: [{ ...latte, qty: 2 }], payment: { method: 'card', reference: 'AUTH 99120' } } });
  assert.equal(staff.statusCode, 201, staff.body);
  assert.equal(staff.json().order.invoice_id, inv.id);
  const now = (await app.inject({ method: 'GET', url: `/api/admin/invoices/${inv.id}`, headers: auth() })).json().invoice;
  assert.equal(now.orders.length, 2);
  assert.equal(now.status, 'paid'); // pay-now took the whole bill's balance
  const noRef = await app.inject({ method: 'POST', url: '/api/admin/orders', headers: auth(), payload: { source: 'counter', lines: [{ ...latte, qty: 1 }], payment: { method: 'upi' } } });
  assert.equal(noRef.statusCode, 400);
});

test('invoices: the guest gets the bill with the table code; the waiter is called either way', async () => {
  const before = (await sql<{ n: number }[]>`select count(*)::int as n from service_requests where table_label = '9' and kind = 'bill'`)[0].n;
  const noPass = await app.inject({ method: 'POST', url: '/api/public/tables/9/bill', payload: {} });
  assert.equal(noPass.statusCode, 403);
  assert.equal(noPass.json().error, 'table_code');
  assert.equal((await sql<{ n: number }[]>`select count(*)::int as n from service_requests where table_label = '9' and kind = 'bill'`)[0].n, before + 1);
  const empty = await app.inject({ method: 'POST', url: '/api/public/tables/9/bill', payload: { pass: await passFor('9') } });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error, 'nothing_to_bill');
  await placeAt('9', [{ ...find('Americano'), qty: 1 }]);
  const ok = await app.inject({ method: 'POST', url: '/api/public/tables/9/bill', payload: { pass: await passFor('9') } });
  assert.equal(ok.statusCode, 200, ok.body);
  const inv = (await app.inject({ method: 'GET', url: `/api/public/invoices/${ok.json().token}` })).json().invoice;
  assert.equal(inv.table, '9');
  assert.equal(inv.lines[0].name, 'Americano');
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/invoices/not-a-token' })).statusCode, 404);
});

test('invoices: the payments report has one row per transaction and its totals add up', async () => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const r = (await app.inject({ method: 'GET', url: `/api/admin/reports/payments?from=${day}&to=${day}`, headers: auth() })).json();
  const [{ n, total }] = await sql<{ n: number; total: number }[]>`select count(distinct txn_group)::int as n, sum(amount_paise)::int as total from payments`;
  assert.equal(r.rows.length, n);
  assert.equal(Object.values(r.byMethod as Record<string, number>).reduce((a, b) => a + b, 0), total);
  const split = r.rows.find((x: any) => x.invoice === tableInvoice.number && x.method === 'cash');
  assert.ok(split.orders.includes(','), 'one cash payment covered two orders');
  const found = (await app.inject({ method: 'GET', url: `/api/admin/reports/payments?from=${day}&to=${day}&search=77120`, headers: auth() })).json().rows;
  assert.equal(found.length, 1);
  const csv = await app.inject({ method: 'GET', url: `/api/admin/reports/payments?from=${day}&to=${day}&format=csv`, headers: auth() });
  assert.equal(csv.body.trim().split('\n').length, n + 1);
  const gst = (await app.inject({ method: 'GET', url: `/api/admin/reports/gst?from=${day}&to=${day}`, headers: auth() })).json().rows;
  assert.ok(gst.some((g: any) => g.invoice === tableInvoice.number));
});

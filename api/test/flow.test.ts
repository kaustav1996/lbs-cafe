// End-to-end flow against a real Postgres. Run with:
// DATABASE_URL=postgres://postgres:postgres@localhost:5433/lbs_test DATABASE_SSL=disable JWT_SECRET=... npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.OWNER_EMAIL ??= 'owner@lbscafe.test';
process.env.OWNER_PASSWORD ??= 'bandit-owner-pass';

const { buildApp } = await import('../src/app.js');
const { migrate } = await import('../src/migrate.js');
const { sql } = await import('../src/db.js');
const { computeTotals } = await import('../src/money.js');

let app: Awaited<ReturnType<typeof buildApp>>;
let token = '';
const auth = () => ({ authorization: `Bearer ${token}` });

before(async () => {
  await sql`drop schema public cascade`;
  await sql`create schema public`;
  await migrate(() => {});
  app = await buildApp();
});
after(async () => {
  await app.close();
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

let orderToken = '';
let orderId = 0;
test('a table orders from the QR menu; prices come from the server', async () => {
  const affogato = find('Affogato');
  const burritos = find('Burritos', 'Non-veg');
  const r = await app.inject({
    method: 'POST',
    url: '/api/public/orders',
    payload: { mode: 'table', table: '5', note: 'less ice', lines: [{ ...affogato, qty: 2 }, { ...burritos, qty: 1 }] },
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
  const pay = await app.inject({ method: 'POST', url: `/api/admin/orders/${orderId}/payments`, headers: auth(), payload: { method: 'upi', amountPaise: o.total_paise } });
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
  const p2 = await app.inject({ method: 'POST', url: `/api/admin/orders/${o.id}/payments`, headers: auth(), payload: { method: 'card', amountPaise: o.total_paise - 50000 } });
  assert.equal(p2.json().order.payment_status, 'paid');
  const cust = (await app.inject({ method: 'GET', url: '/api/admin/customers', headers: auth() })).json().customers;
  assert.equal(cust[0].phone, '+919874563210');
  assert.equal(cust[0].visits, 1);
});

test('sold-out items cannot be ordered online', async () => {
  const x = find('Dirty Matcha');
  await app.inject({ method: 'PATCH', url: `/api/admin/items/${x.itemId}`, headers: auth(), payload: { available: false } });
  const r = await app.inject({ method: 'POST', url: '/api/public/orders', payload: { mode: 'table', table: '2', lines: [{ itemId: x.itemId, optionId: x.optionId, qty: 1 }] } });
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

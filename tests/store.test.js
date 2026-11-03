'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupApp, Client } = require('./helpers');

let ctx; let q;
before(async () => { ctx = await setupApp(); q = require('../src/db').q; });
after(() => ctx.server.close());

const variantOf = (slug, where = '') => q.get(`SELECT v.* FROM variants v JOIN products p ON p.id = v.product_id WHERE p.slug = ? ${where} ORDER BY v.id LIMIT 1`, slug);
const checkoutForm = (over = {}) => ({
  email: 'guest@example.com', phone: '0300 1112233', full_name: 'Ali Raza', line1: 'House 7, Street 9, G-11/2',
  city: 'Islamabad', province: 'Islamabad Capital Territory', shipping_method: 'standard', payment_method: 'cod', accept_terms: 'on', ...over,
});

test('public pages render', async () => {
  const c = new Client(ctx.base);
  for (const url of ['/', '/shop', '/c/laptops', '/p/sony-wh-1000xm5', '/search?q=samsung', '/deals', '/new', '/brands', '/brand/apple',
    '/cart', '/wishlist', '/compare?ids=1,2', '/track', '/contact', '/pages/shipping', '/sitemap.xml', '/robots.txt', '/account/login']) {
    const r = await c.get(url);
    assert.equal(r.status, 200, url);
  }
  assert.equal((await c.get('/p/does-not-exist')).status, 404);
});

test('product page has structured data and SEO tags', async () => {
  const r = await new Client(ctx.base).get('/p/samsung-galaxy-s25-ultra');
  assert.match(r.text, /"@type":"Product"/);
  assert.match(r.text, /"priceCurrency":"PKR"/);
  assert.match(r.text, /<link rel="canonical" href="[^"]+\/p\/samsung-galaxy-s25-ultra">/);
});

test('state changing requests need the CSRF token', async () => {
  const c = new Client(ctx.base);
  await c.get('/');
  const v = variantOf('jbl-flip-6');
  const res = await fetch(ctx.base + '/api/cart/items', { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookieHeader() }, body: JSON.stringify({ variant_id: v.id }) });
  assert.equal(res.status, 403);
});

test('search, filters and sorting', async () => {
  const c = new Client(ctx.base);
  const s = await c.get('/api/search/suggest?q=galax');
  assert.ok(s.data.products.length >= 3);
  const f = await c.get('/c/smartphones?brand=samsung&spec%5BRAM%5D=8%20GB');
  assert.match(f.text, /1 product</);
  const sorted = await c.get('/c/smartphones?sort=price_asc');
  const first = sorted.text.match(/class="pcard-name"><a href="\/p\/([^"]+)/)[1];
  assert.equal(first, 'samsung-galaxy-a16');
});

test('cart, coupons and delivery are priced on the server', async () => {
  const c = new Client(ctx.base); await c.get('/');
  const v = variantOf('jbl-tune-520bt');
  let r = await c.api('POST', '/api/cart/items', { variant_id: v.id, qty: 2 });
  assert.equal(r.data.cart.subtotal, v.price * 2);
  r = await c.api('POST', '/api/cart/coupon', { code: 'TAAR2000' });
  assert.equal(r.status, 400, 'minimum spend enforced');
  r = await c.api('POST', '/api/cart/coupon', { code: 'ELEVEN11' });
  assert.match(r.data.message, /expired/);
  const big = variantOf('sony-wh-1000xm5');
  await c.api('POST', '/api/cart/items', { variant_id: big.id, qty: 1 });
  r = await c.api('POST', '/api/cart/coupon', { code: 'taar2000' });
  assert.equal(r.status, 200);
  assert.equal(r.data.cart.discount, 2000);
  r = await c.api('POST', '/api/cart/city', { city: 'Lahore' });
  assert.equal(r.data.cart.shipping, 0, 'free delivery above threshold');
  const ship = await c.get('/api/shipping?city=Gwadar&subtotal=10000');
  assert.equal(ship.data.zone, 'Rest of Pakistan');
  assert.equal(ship.data.methods[0].fee, 449);
  // quantity is capped at stock
  const low = variantOf('fujifilm-x-t30-ii-with-15-45mm', 'AND v.stock > 0');
  r = await c.api('POST', '/api/cart/items', { variant_id: low.id, qty: 50 });
  assert.equal(r.data.cart.lines.find(l => l.variant_id === low.id).qty, low.stock);
});

test('guest checkout with cash on delivery', async () => {
  const c = new Client(ctx.base); await c.get('/');
  const v = variantOf('samsung-45w-super-fast-charger');
  await c.api('POST', '/api/cart/items', { variant_id: v.id, qty: 1 });
  await c.get('/checkout');
  let r = await c.post('/checkout', checkoutForm({ phone: '12345', city: 'Paris' }));
  assert.equal(r.status, 400);
  assert.match(r.text, /Pakistani mobile number/);
  assert.match(r.text, /Choose your city from the list/);
  r = await c.post('/checkout', checkoutForm({ province: 'Sindh' }));
  assert.equal(r.status, 400, 'province must match city');
  r = await c.post('/checkout', checkoutForm());
  assert.equal(r.status, 303);
  assert.match(r.location, /^\/order\/TR\d+\?t=.+&placed=1$/);
  const number = r.location.split('/')[2].split('?')[0];
  const order = q.get('SELECT * FROM orders WHERE number = ?', number);
  assert.equal(order.subtotal, v.price);
  assert.equal(order.shipping, 299, 'Islamabad standard delivery');
  assert.equal(order.total, v.price + 299);
  assert.equal(order.phone, '+923001112233');
  assert.equal(q.get('SELECT stock FROM variants WHERE id = ?', v.id).stock, v.stock - 1);
  assert.equal((await c.get('/api/cart')).data.cart.count, 0, 'cart emptied');
  assert.ok(q.get('SELECT 1 FROM outbox WHERE to_email = ? AND subject LIKE ?', 'guest@example.com', `%${number}%`));
  // the order page needs the token
  assert.equal((await new Client(ctx.base).get(`/order/${number}`)).status, 404);
  assert.equal((await c.get(r.location)).status, 200);
  // tracking
  const t = new Client(ctx.base); await t.get('/track');
  assert.equal((await t.post('/track', { number, contact: 'someone@else.com' })).status, 404);
  const ok = await t.post('/track', { number, contact: '0300-1112233' });
  assert.equal(ok.status, 302);
});

test('the last unit cannot be sold twice', async () => {
  const v = variantOf('xbox-wireless-controller');
  q.run('UPDATE variants SET stock = 1 WHERE id = ?', v.id);
  const a = new Client(ctx.base); const b = new Client(ctx.base);
  await a.get('/'); await b.get('/');
  await a.api('POST', '/api/cart/items', { variant_id: v.id, qty: 1 });
  await b.api('POST', '/api/cart/items', { variant_id: v.id, qty: 1 });
  await a.get('/checkout'); await b.get('/checkout');
  const ra = await a.post('/checkout', checkoutForm({ email: 'a@example.com' }));
  const rb = await b.post('/checkout', checkoutForm({ email: 'b@example.com' }));
  assert.equal(ra.status, 303);
  assert.equal(rb.status, 400);
  assert.match(rb.text, /Only 0 left|sold out|Out of stock/);
  assert.equal(q.get('SELECT stock FROM variants WHERE id = ?', v.id).stock, 0);
});

test('bank transfer reference and online card payment', async () => {
  const c = new Client(ctx.base); await c.get('/');
  const v = variantOf('logitech-mx-master-3s');
  await c.api('POST', '/api/cart/items', { variant_id: v.id, qty: 1 });
  await c.get('/checkout');
  let r = await c.post('/checkout', checkoutForm({ payment_method: 'bank_transfer', email: 'bank@example.com' }));
  const [, number, token] = r.location.match(/\/order\/(\w+)\?t=([^&]+)/);
  await c.get(r.location);
  r = await c.post(`/order/${number}/reference`, { t: token, reference: 'IBFT998877' });
  assert.equal(q.get('SELECT payment_status FROM orders WHERE number = ?', number).payment_status, 'awaiting_verification');

  await c.api('POST', '/api/cart/items', { variant_id: v.id, qty: 1 });
  await c.get('/checkout');
  r = await c.post('/checkout', checkoutForm({ payment_method: 'card', email: 'card@example.com' }));
  assert.match(r.location, /^\/pay\/sandbox\/pay_/);
  const payUrl = r.location;
  await c.get(payUrl);
  r = await c.post(payUrl, { card_number: '4000 0000 0000 0002', action: 'pay' });
  r = await c.get(r.location);
  assert.match(r.location, /pay=failed/);
  const failedNumber = r.location.match(/\/order\/(\w+)/)[1];
  assert.equal(q.get('SELECT payment_status FROM orders WHERE number = ?', failedNumber).payment_status, 'failed');
  // tampered callback is rejected
  const bad = await c.get(`/payments/sandbox/return?pid=${payUrl.split('/').pop()}&status=succeeded&amount=1&ref=x&sig=abc`);
  assert.equal(bad.status, 400);
  // retry and succeed
  const tok = q.get('SELECT access_token FROM orders WHERE number = ?', failedNumber).access_token;
  await c.get(`/order/${failedNumber}?t=${tok}`);
  r = await c.post(`/order/${failedNumber}/pay`, { t: tok });
  await c.get(r.location);
  r = await c.post(r.location, { card_number: '4242424242424242', action: 'pay' });
  r = await c.get(r.location);
  assert.match(r.location, /pay=success/);
  const paid = q.get('SELECT payment_status, status FROM orders WHERE number = ?', failedNumber);
  assert.deepEqual({ ...paid }, { payment_status: 'paid', status: 'confirmed' });
});

test('accounts: register, sign in, cart merge, permissions', async () => {
  const c = new Client(ctx.base); await c.get('/account/register');
  let r = await c.post('/account/register', { name: 'Hina Shah', email: 'hina@example.com', password: 'short' });
  assert.equal(r.status, 400);
  r = await c.post('/account/register', { name: 'Hina Shah', email: 'hina@example.com', password: 'Secret123', phone: '03211234567' });
  assert.equal(r.status, 302);
  assert.equal((await c.get('/account')).status, 200);
  assert.equal((await c.get('/admin')).status, 403, 'customers cannot open admin');
  await c.post('/account/logout', {});

  const g = new Client(ctx.base); await g.get('/');
  const v = variantOf('anker-nano-charger-30w');
  await g.api('POST', '/api/cart/items', { variant_id: v.id, qty: 1 });
  await g.get('/account/login');
  r = await g.post('/account/login', { email: 'hina@example.com', password: 'wrong-pass1' });
  assert.equal(r.status, 401);
  r = await g.post('/account/login', { email: 'hina@example.com', password: 'Secret123' });
  assert.equal(r.status, 302);
  assert.equal((await g.get('/api/cart')).data.cart.count, 1, 'guest cart moved to account');
  // address book
  await g.get('/account/addresses');
  r = await g.post('/account/addresses', { full_name: 'Hina Shah', phone: '03211234567', line1: 'Flat 3, Clifton Block 5', city: 'Karachi', province: 'Sindh' });
  assert.equal(r.status, 302);
  assert.equal(q.get(`SELECT COUNT(*) n FROM addresses a JOIN users u ON u.id = a.user_id WHERE u.email = 'hina@example.com'`).n, 1);
});

async function staff(email, password) {
  const c = new Client(ctx.base); await c.get('/account/login');
  const r = await c.post('/account/login', { email, password });
  assert.equal(r.status, 302);
  await c.get('/admin');
  return c;
}

test('admin pages and order workflow', async () => {
  const a = await staff('admin@taar.pk', 'Admin!2026');
  for (const url of ['/admin', '/admin?days=7', '/admin/orders', '/admin/orders?status=pending&q=TR', '/admin/products', '/admin/products/new', '/admin/products/1',
    '/admin/inventory', '/admin/categories', '/admin/brands', '/admin/customers', '/admin/discounts', '/admin/shipping', '/admin/returns',
    '/admin/reviews', '/admin/messages', '/admin/settings', '/admin/staff']) {
    assert.equal((await a.get(url)).status, 200, url);
  }
  const order = q.get(`SELECT * FROM orders WHERE email = 'guest@example.com'`);
  await a.get(`/admin/orders/${order.id}`);
  await a.post(`/admin/orders/${order.id}/status`, { status: 'confirmed' });
  await a.post(`/admin/orders/${order.id}/status`, { status: 'processing' });
  await a.post(`/admin/orders/${order.id}/status`, { status: 'shipped' });
  assert.equal(q.get('SELECT status FROM orders WHERE id = ?', order.id).status, 'processing', 'tracking required before shipping');
  await a.post(`/admin/orders/${order.id}/status`, { status: 'shipped', courier: 'TCS', tracking: '778899001122' });
  await a.post(`/admin/orders/${order.id}/status`, { status: 'delivered' });
  const done = q.get('SELECT status, payment_status FROM orders WHERE id = ?', order.id);
  assert.deepEqual({ ...done }, { status: 'delivered', payment_status: 'paid' }, 'COD marked paid on delivery');

  // cancelling restocks
  const pending = q.get(`SELECT o.id, oi.variant_id, oi.qty FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.email = 'bank@example.com'`);
  const before = q.get('SELECT stock FROM variants WHERE id = ?', pending.variant_id).stock;
  await a.post(`/admin/orders/${pending.id}/status`, { status: 'cancelled' });
  assert.equal(q.get('SELECT stock FROM variants WHERE id = ?', pending.variant_id).stock, before + pending.qty);
});

test('admin catalogue editing', async () => {
  const a = await staff('admin@taar.pk', 'Admin!2026');
  await a.get('/admin/products/new');
  const brand = q.get(`SELECT id FROM brands WHERE name = 'Xiaomi'`).id;
  const cat = q.get(`SELECT id FROM categories WHERE slug = 'smartphones'`).id;
  const form = {
    name: 'Xiaomi Redmi 14C', short_desc: 'A big screen budget phone with a 50 MP camera.', brand_id: brand, category_id: cat,
    status: 'active', warranty_months: '12', weight_g: '200', option_names: 'Color, Storage',
    spec_key: 'RAM', spec_val: '4 GB',
    'variants[0][opt][Color]': 'Black', 'variants[0][opt][Storage]': '128 GB', 'variants[0][price]': '29999', 'variants[0][stock]': '10', 'variants[0][active]': 'on',
    'variants[1][opt][Color]': 'Sage', 'variants[1][opt][Storage]': '128 GB', 'variants[1][price]': '29999', 'variants[1][compare_price]': '100', 'variants[1][stock]': '5', 'variants[1][active]': 'on',
  };
  let r = await a.post('/admin/products/new', form);
  assert.equal(r.status, 400, 'compare price lower than price is rejected');
  form['variants[1][compare_price]'] = '';
  r = await a.post('/admin/products/new', form);
  assert.equal(r.status, 302);
  const p = q.get(`SELECT * FROM products WHERE slug = 'xiaomi-redmi-14c'`);
  assert.equal(q.get('SELECT COUNT(*) n FROM variants WHERE product_id = ?', p.id).n, 2);
  assert.equal((await a.get('/p/xiaomi-redmi-14c')).status, 200);
  assert.ok((await a.get('/api/search/suggest?q=redmi 14c')).data.products.length);
  // inventory bulk edit
  const v = q.get('SELECT * FROM variants WHERE product_id = ? ORDER BY id LIMIT 1', p.id);
  await a.get('/admin/inventory');
  await a.post('/admin/inventory', { [`stock[${v.id}]`]: '3', [`price[${v.id}]`]: '28999' });
  assert.deepEqual({ ...q.get('SELECT stock, price FROM variants WHERE id = ?', v.id) }, { stock: 3, price: 28999 });
  // discount code
  await a.get('/admin/discounts');
  await a.post('/admin/discounts', { code: 'eid50', type: 'fixed', value: '500', min_subtotal: '1000', active: 'on' });
  assert.ok(q.get(`SELECT 1 FROM coupons WHERE code = 'EID50'`));
  // image upload goes through sharp and rejects non images
  const fd = new FormData();
  fd.append('images', new Blob([Buffer.from('not an image')], { type: 'image/png' }), 'fake.png');
  const up = await fetch(`${ctx.base}/admin/products/${p.id}/images?_csrf=${encodeURIComponent(a.csrf)}`, { method: 'POST', body: fd, headers: { cookie: a.cookieHeader() }, redirect: 'manual' });
  assert.equal(up.status, 302);
  assert.equal(q.get('SELECT COUNT(*) n FROM product_images WHERE product_id = ?', p.id).n, 0);
  const png = await require('sharp')({ create: { width: 900, height: 900, channels: 3, background: '#2346c8' } }).png().toBuffer();
  const fd2 = new FormData();
  fd2.append('images', new Blob([png], { type: 'image/png' }), 'blue.png');
  await fetch(`${ctx.base}/admin/products/${p.id}/images?_csrf=${encodeURIComponent(a.csrf)}`, { method: 'POST', body: fd2, headers: { cookie: a.cookieHeader() }, redirect: 'manual' });
  const img = q.get('SELECT * FROM product_images WHERE product_id = ?', p.id);
  assert.match(img.url, /\.webp$/);
  assert.equal((await fetch(ctx.base + img.url)).status, 200);
});

test('roles limit what staff can do', async () => {
  const s = await staff('support@taar.pk', 'Support!2026');
  assert.equal((await s.get('/admin/orders')).status, 200);
  assert.equal((await s.get('/admin/products')).status, 403);
  assert.equal((await s.get('/admin/settings')).status, 403);
  assert.equal((await s.get('/admin/staff')).status, 403);
  const m = await staff('manager@taar.pk', 'Manager!2026');
  assert.equal((await m.get('/admin/products')).status, 200);
  assert.equal((await m.get('/admin/settings')).status, 403);
});

test('reviews and returns', async () => {
  // Hina buys and receives a product, reviews it, and returns it.
  const c = new Client(ctx.base); await c.get('/account/login');
  await c.post('/account/login', { email: 'hina@example.com', password: 'Secret123' });
  await c.get('/checkout');
  const r = await c.post('/checkout', checkoutForm({ email: 'hina@example.com', city: 'Karachi', province: 'Sindh' }));
  const number = r.location.split('/')[2].split('?')[0];
  const order = q.get('SELECT * FROM orders WHERE number = ?', number);
  const a = await staff('admin@taar.pk', 'Admin!2026');
  for (const s of ['confirmed', 'processing']) await a.post(`/admin/orders/${order.id}/status`, { status: s });
  await a.post(`/admin/orders/${order.id}/status`, { status: 'shipped', courier: 'Leopards', tracking: 'LP123456' });
  await a.post(`/admin/orders/${order.id}/status`, { status: 'delivered' });

  await c.get('/p/anker-nano-charger-30w');
  await c.post('/p/anker-nano-charger-30w/reviews', { rating: '4', title: 'Tiny', body: 'Charges my phone fast and fits in my pocket.' });
  const rv = q.get(`SELECT * FROM reviews WHERE author = 'Hina Shah'`);
  assert.equal(rv.status, 'pending');
  assert.equal(rv.verified, 1);
  await a.get('/admin/reviews');
  await a.post(`/admin/reviews/${rv.id}`, { action: 'published' });
  assert.equal(q.get('SELECT status FROM reviews WHERE id = ?', rv.id).status, 'published');

  const item = q.get('SELECT * FROM order_items WHERE order_id = ?', order.id);
  const stockBefore = q.get('SELECT stock FROM variants WHERE id = ?', item.variant_id).stock;
  await c.get(`/order/${number}?t=${order.access_token}`);
  await c.post(`/account/orders/${number}/return`, { reason: 'defective', items: String(item.id), details: 'Gets very hot' });
  const ret = q.get('SELECT * FROM returns WHERE order_id = ?', order.id);
  assert.equal(ret.status, 'requested');
  await a.get('/admin/returns');
  await a.post(`/admin/returns/${ret.id}`, { status: 'approved' });
  await a.post(`/admin/returns/${ret.id}`, { status: 'received' });
  assert.equal(q.get('SELECT stock FROM variants WHERE id = ?', item.variant_id).stock, stockBefore + item.qty);
  await a.post(`/admin/returns/${ret.id}`, { status: 'refunded', refund_amount: String(item.price) });
  assert.match(q.get('SELECT payment_status FROM orders WHERE id = ?', order.id).payment_status, /refunded/);
});

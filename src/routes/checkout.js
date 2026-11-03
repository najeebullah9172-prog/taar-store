'use strict';
const express = require('express');
const { q } = require('../db');
const pricing = require('../lib/pricing');
const payments = require('../lib/payments');
const orders = require('../lib/orders');
const { schemas, check, password: passwordSchema } = require('../lib/validate');
const { ensureSession, ownerKey, flash } = require('../lib/session');
const { hashPassword, signIn, can } = require('../lib/auth');
const { CITY_LIST, CITIES, PROVINCES } = require('../lib/pk');
const { getSetting } = require('../db');
const limits = require('../lib/limits');

const r = express.Router();

// ---------- cart page ----------
r.get('/cart', (req, res) => {
  const summary = pricing.summarize(ownerKey(req), { userId: req.user?.id, email: req.user?.email });
  res.locals.meta = { title: 'Your cart | Taar', noindex: true };
  res.render('store/cart', { summary, cities: CITY_LIST });
});

// ---------- checkout ----------
function checkoutView(req, res, { values = {}, errors = {}, status = 200 } = {}) {
  const owner = ownerKey(req);
  const addresses = req.user ? q.all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', req.user.id) : [];
  const def = addresses[0];
  const v = {
    email: req.user?.email || '', full_name: def?.full_name || req.user?.name || '', phone: def?.phone || req.user?.phone || '',
    line1: def?.line1 || '', line2: def?.line2 || '', city: def?.city || '', province: def?.province || '', postal_code: def?.postal_code || '',
    shipping_method: 'standard', payment_method: 'cod', save_address: !!req.user && !def,
    ...values,
  };
  const summary = pricing.summarize(owner, { city: v.city || undefined, shippingMethod: v.shipping_method, paymentMethod: v.payment_method, userId: req.user?.id, email: v.email });
  if (!summary.lines.length) return res.redirect('/cart');
  res.locals.meta = { title: 'Checkout | Taar', noindex: true };
  res.status(status).render('store/checkout', {
    summary, values: v, errors, addresses, cities: CITY_LIST, cityProvince: CITIES, provinces: PROVINCES,
    payMethods: payments.methods({ total: summary.total }),
  });
}

r.get('/checkout', (req, res) => checkoutView(req, res));

r.get('/api/checkout/summary', (req, res) => {
  const city = CITY_LIST.includes(req.query.city) ? req.query.city : undefined;
  const s = pricing.summarize(ownerKey(req), {
    city, shippingMethod: String(req.query.shipping_method || 'standard'), paymentMethod: String(req.query.payment_method || ''),
    userId: req.user?.id, email: req.user?.email,
  });
  res.json({
    ok: true, subtotal: s.subtotal, discount: s.discount, shipping: s.shipping, paymentFee: s.paymentFee, total: s.total,
    options: s.shippingOptions, method: s.shippingMethod?.id || null, zone: s.zone, cod: s.codAvailable, city: s.city,
    payMethods: payments.methods({ total: s.total }),
  });
});

r.post('/checkout', limits.checkout, async (req, res, next) => {
  try {
    const { data, errors } = check(schemas.checkout, req.body);
    const values = { ...req.body, save_address: req.body.save_address === 'on', create_account: req.body.create_account === 'on' };
    if (errors) return checkoutView(req, res, { values, errors, status: 400 });
    if (CITIES[data.city] !== data.province) {
      return checkoutView(req, res, { values, errors: { province: `${data.city} is in ${CITIES[data.city]}. Check the province.` }, status: 400 });
    }
    const method = payments.methods().find(m => m.id === data.payment_method);
    if (!method) return checkoutView(req, res, { values, errors: { payment_method: 'That payment method is not available.' }, status: 400 });

    // Optional account creation for guests.
    let newUser = null;
    if (!req.user && data.create_account) {
      const pw = passwordSchema.safeParse(req.body.account_password || '');
      if (!pw.success) return checkoutView(req, res, { values, errors: { account_password: pw.error.issues[0].message }, status: 400 });
      if (q.get('SELECT 1 FROM users WHERE email = ?', data.email)) {
        return checkoutView(req, res, { values, errors: { email: 'An account already uses this email. Sign in first, or untick "Create an account".' }, status: 400 });
      }
    }

    const summary = pricing.summarize(ownerKey(req), { city: data.city, shippingMethod: data.shipping_method, paymentMethod: data.payment_method });
    if (method.id === 'cod') {
      const cod = payments.methods({ total: summary.total }).find(m => m.id === 'cod');
      if (cod?.disabled) return checkoutView(req, res, { values, errors: { payment_method: cod.disabled }, status: 400 });
    }

    let order;
    try {
      order = orders.placeOrder(ownerKey(req), req.user, data);
    } catch (err) {
      if (err instanceof orders.CheckoutError) return checkoutView(req, res, { values, errors: { [err.field || '_']: err.message }, status: 400 });
      throw err;
    }

    if (!req.user && data.create_account) {
      const hash = await hashPassword(req.body.account_password);
      const u = q.run('INSERT INTO users (email, password_hash, name, phone) VALUES (?,?,?,?)', data.email, hash, data.full_name, data.phone);
      newUser = q.get('SELECT * FROM users WHERE id = ?', u.lastInsertRowid);
      q.run('UPDATE orders SET user_id = ? WHERE id = ?', newUser.id, order.id);
      q.run(`INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, province, postal_code, is_default)
             VALUES (?,?,?,?,?,?,?,?,?,1)`, newUser.id, 'Home', data.full_name, data.phone, data.line1, data.line2, data.city, data.province, data.postal_code);
      signIn(req, res, newUser);
    }

    const pay = payments.createPayment(order);
    if (pay.redirect) return res.redirect(303, pay.redirect);
    res.redirect(303, `/order/${order.number}?t=${order.access_token}&placed=1`);
  } catch (err) { next(err); }
});

// ---------- order page (confirmation and tracking) ----------
function loadOrderFor(req, t = req.query.t) {
  const order = orders.getOrderWithItems('number = ?', req.params.number);
  if (!order) return null;
  const tokenOk = typeof t === 'string' && t === order.access_token;
  const ownerOk = req.user && order.user_id === req.user.id;
  const staffOk = req.user && can(req.user, 'orders');
  return tokenOk || ownerOk || staffOk ? order : null;
}

r.get('/order/:number', (req, res, next) => {
  const order = loadOrderFor(req);
  if (!order) return next();
  res.locals.meta = { title: `Order ${order.number} | Taar`, noindex: true };
  res.render('store/order', {
    order, placed: req.query.placed === '1', token: order.access_token,
    bank: getSetting('payments', {}).bank_transfer || {}, canCancel: orders.canCustomerCancel(order) && (req.user?.id === order.user_id || req.query.t === order.access_token),
    payMessage: req.query.pay || null,
  });
});

r.get('/order/:number/invoice', (req, res, next) => {
  const order = loadOrderFor(req);
  if (!order) return next();
  res.render('store/invoice', { order });
});

r.post('/order/:number/reference', limits.forms, (req, res, next) => {
  const order = loadOrderFor(req, req.body.t);
  if (!order) return next();
  const ref = String(req.body.reference || '').trim().slice(0, 60);
  const back = `/order/${order.number}?t=${order.access_token}`;
  if (order.payment_method !== 'bank_transfer' || !['unpaid', 'failed'].includes(order.payment_status)) return res.redirect(back);
  if (ref.length < 4) { flash(res, 'error', 'Enter the transaction ID or reference from your banking app.'); return res.redirect(back); }
  q.run('UPDATE payments SET reference = ? WHERE order_id = ?', ref, order.id);
  orders.setPaymentStatus(order.id, 'awaiting_verification', { reference: ref, note: `Reference ${ref}` });
  flash(res, 'success', 'Thanks. We will confirm your payment shortly and email you when the order is on its way.');
  res.redirect(back);
});

r.post('/order/:number/pay', limits.forms, (req, res, next) => {
  const order = loadOrderFor(req, req.body.t);
  if (!order) return next();
  if (order.payment_method !== 'card' || order.payment_status === 'paid' || order.status === 'cancelled') return res.redirect(`/order/${order.number}?t=${order.access_token}`);
  const pay = payments.createPayment(order);
  res.redirect(303, pay.redirect);
});

r.post('/order/:number/cancel', limits.forms, (req, res, next) => {
  const order = loadOrderFor(req, req.body.t);
  if (!order) return next();
  const back = `/order/${order.number}?t=${order.access_token}`;
  if (!orders.canCustomerCancel(order)) { flash(res, 'error', 'This order is already being packed. Contact us and we will help.'); return res.redirect(back); }
  orders.setStatus(order.id, 'cancelled', { userId: req.user?.id, note: 'Cancelled by the customer.' });
  flash(res, 'success', `Order ${order.number} is cancelled.${order.payment_status === 'paid' ? ' Your refund will be processed within 5 working days.' : ''}`);
  res.redirect(back);
});

// ---------- built in test gateway ----------
function sandboxPayment(pid) {
  return q.get(`SELECT p.*, o.number, o.access_token, o.total AS order_total, o.email, o.status AS order_status
                FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.public_id = ? AND p.provider = 'sandbox'`, pid);
}

r.get('/pay/sandbox/:pid', (req, res, next) => {
  const p = sandboxPayment(req.params.pid);
  if (!p) return next();
  if (p.status === 'succeeded') return res.redirect(`/order/${p.number}?t=${p.access_token}`);
  res.locals.meta = { title: 'Test payment', noindex: true };
  res.render('store/sandbox-pay', { p, error: null });
});

r.post('/pay/sandbox/:pid', limits.checkout, (req, res, next) => {
  const p = sandboxPayment(req.params.pid);
  if (!p) return next();
  if (p.status === 'succeeded') return res.redirect(`/order/${p.number}?t=${p.access_token}`);
  if (req.body.action === 'cancel') {
    return res.redirect(303, `/order/${p.number}?t=${p.access_token}&pay=cancelled`);
  }
  const result = payments.sandboxCharge(req.body.card_number);
  const fields = { pid: p.public_id, status: result.status, amount: p.amount, ref: result.status === 'succeeded' ? `SBX${Date.now()}` : 'none' };
  fields.sig = payments.signSandbox(fields);
  // In a real gateway this redirect comes from the provider's servers.
  res.redirect(303, `/payments/sandbox/return?${new URLSearchParams(fields)}`);
});

function applyGatewayResult(fields) {
  if (!payments.verifySandbox(fields)) return { ok: false, message: 'Invalid signature' };
  const p = sandboxPayment(fields.pid);
  if (!p) return { ok: false, message: 'Unknown payment' };
  if (Number(fields.amount) !== p.amount) return { ok: false, message: 'Amount mismatch' };
  if (p.status === 'succeeded') return { ok: true, p, already: true };
  if (fields.status === 'succeeded') {
    q.run(`UPDATE payments SET status = 'succeeded', reference = ?, payload = ?, updated_at = datetime('now') WHERE id = ?`, fields.ref, JSON.stringify(fields), p.id);
    orders.setPaymentStatus(p.order_id, 'paid', { reference: fields.ref, note: `Test gateway reference ${fields.ref}` });
  } else {
    q.run(`UPDATE payments SET status = 'failed', payload = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(fields), p.id);
    q.run(`UPDATE orders SET payment_status = 'failed', updated_at = datetime('now') WHERE id = ?`, p.order_id);
    orders.event(p.order_id, 'payment', 'Card payment was declined');
  }
  return { ok: true, p };
}

r.get('/payments/sandbox/return', (req, res) => {
  const out = applyGatewayResult(req.query);
  if (!out.ok) return res.status(400).render('store/error', { title: 'Payment error', status: 400, message: 'We could not verify this payment response. No changes were made to your order.' });
  const status = req.query.status === 'succeeded' ? 'success' : 'failed';
  res.redirect(303, `/order/${out.p.number}?t=${out.p.access_token}&pay=${status}${status === 'success' ? '&placed=1' : ''}`);
});

// Server to server notification. The signature check replaces CSRF here.
r.post('/payments/sandbox/webhook', (req, res) => {
  const out = applyGatewayResult(req.body || {});
  res.status(out.ok ? 200 : 400).json({ ok: out.ok, message: out.message });
});

module.exports = r;

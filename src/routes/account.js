'use strict';
const express = require('express');
const { q } = require('../db');
const { schemas, check, password: passwordSchema } = require('../lib/validate');
const { authenticate, signIn, hashPassword, checkPassword, requireUser, safeNext, audit } = require('../lib/auth');
const { destroySession, flash } = require('../lib/session');
const orders = require('../lib/orders');
const mailer = require('../lib/mailer');
const limits = require('../lib/limits');
const config = require('../config');
const { token, sha256 } = require('../lib/util');
const { CITY_LIST, CITIES, PROVINCES } = require('../lib/pk');
const { getSetting } = require('../db');

const r = express.Router();
const meta = (res, title) => { res.locals.meta = { title: `${title} | Taar`, noindex: true }; };

// ---------- sign in / register ----------
r.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  meta(res, 'Sign in');
  res.render('account/login', { mode: 'login', errors: {}, values: {}, next: safeNext(req.query.next, '') });
});
r.get('/register', (req, res) => {
  if (req.user) return res.redirect('/account');
  meta(res, 'Create account');
  res.render('account/login', { mode: 'register', errors: {}, values: {}, next: safeNext(req.query.next, '') });
});

r.post('/login', limits.auth, async (req, res, next) => {
  try {
    const nextUrl = safeNext(req.body.next, '');
    meta(res, 'Sign in');
    const { data, errors, values } = check(schemas.login, req.body);
    if (errors) return res.status(400).render('account/login', { mode: 'login', errors, values, next: nextUrl });
    const user = await authenticate(data.email, data.password);
    if (!user) {
      return res.status(401).render('account/login', { mode: 'login', values: { email: data.email }, next: nextUrl, errors: { _: 'That email and password do not match. Check them or reset your password.' } });
    }
    signIn(req, res, user);
    if (user.role !== 'customer') audit(req, 'staff.login', 'user', user.id);
    res.redirect(nextUrl || (user.role === 'customer' ? '/account' : '/admin'));
  } catch (e) { next(e); }
});

r.post('/register', limits.auth, async (req, res, next) => {
  try {
    const nextUrl = safeNext(req.body.next, '');
    meta(res, 'Create account');
    const { data, errors, values } = check(schemas.register, req.body);
    if (errors) return res.status(400).render('account/login', { mode: 'register', errors, values, next: nextUrl });
    if (q.get('SELECT 1 FROM users WHERE email = ?', data.email)) {
      return res.status(400).render('account/login', { mode: 'register', values, next: nextUrl, errors: { email: 'An account already uses this email. Sign in instead.' } });
    }
    const hash = await hashPassword(data.password);
    const r2 = q.run('INSERT INTO users (email, password_hash, name, phone, marketing) VALUES (?,?,?,?,?)', data.email, hash, data.name, data.phone || null, data.marketing ? 1 : 0);
    // Link earlier guest orders placed with this email.
    q.run('UPDATE orders SET user_id = ? WHERE user_id IS NULL AND email = ? COLLATE NOCASE', r2.lastInsertRowid, data.email);
    if (data.marketing) q.run('INSERT OR IGNORE INTO newsletter (email) VALUES (?)', data.email);
    signIn(req, res, q.get('SELECT * FROM users WHERE id = ?', r2.lastInsertRowid));
    flash(res, 'success', `Welcome to Taar, ${data.name.split(' ')[0]}.`);
    res.redirect(nextUrl || '/account');
  } catch (e) { next(e); }
});

r.post('/logout', (req, res) => {
  destroySession(req, res);
  res.redirect('/');
});

// ---------- password reset ----------
r.get('/forgot', (req, res) => { meta(res, 'Reset password'); res.render('account/forgot', { sent: false, error: null }); });
r.post('/forgot', limits.auth, (req, res) => {
  meta(res, 'Reset password');
  const email = String(req.body.email || '').trim();
  const user = q.get('SELECT * FROM users WHERE email = ? AND disabled = 0', email);
  if (user) {
    const raw = token(32);
    q.run(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`, sha256(raw), user.id);
    mailer.passwordReset(user, `${config.baseUrl}/account/reset/${raw}`).catch(() => {});
  }
  // Same response either way, so the form does not reveal who has an account.
  res.render('account/forgot', { sent: true, error: null });
});
function resetRow(raw) {
  return q.get(`SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`, sha256(String(raw || '')));
}
r.get('/reset/:token', (req, res) => {
  meta(res, 'Choose a new password');
  res.render('account/reset', { valid: !!resetRow(req.params.token), error: null, token: req.params.token });
});
r.post('/reset/:token', limits.auth, async (req, res, next) => {
  try {
    meta(res, 'Choose a new password');
    const row = resetRow(req.params.token);
    if (!row) return res.render('account/reset', { valid: false, error: null, token: '' });
    const pw = passwordSchema.safeParse(req.body.password || '');
    if (!pw.success) return res.status(400).render('account/reset', { valid: true, error: pw.error.issues[0].message, token: req.params.token });
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw.data), row.user_id);
    q.run('UPDATE password_resets SET used = 1 WHERE user_id = ?', row.user_id);
    q.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
    flash(res, 'success', 'Password changed. Sign in with your new password.');
    res.redirect('/account/login');
  } catch (e) { next(e); }
});

// ---------- signed in area ----------
r.use(requireUser);

r.get('/', (req, res) => {
  meta(res, 'Your account');
  const recent = q.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 3', req.user.id);
  const counts = q.get(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status NOT IN ('delivered','cancelled','returned') THEN 1 END),0) open FROM orders WHERE user_id = ?`, req.user.id);
  const address = q.get('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC LIMIT 1', req.user.id);
  const wish = q.get('SELECT COUNT(*) n FROM wishlist WHERE owner = ?', `u:${req.user.id}`).n;
  res.render('account/overview', { tab: 'overview', recent, counts, address, wish });
});

r.get('/orders', (req, res) => {
  meta(res, 'Your orders');
  const list = q.all(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS items,
                      (SELECT image FROM order_items WHERE order_id = o.id LIMIT 1) AS image
                      FROM orders o WHERE user_id = ? ORDER BY created_at DESC`, req.user.id);
  res.render('account/orders', { tab: 'orders', orders: list });
});

r.get('/orders/:number', (req, res, next) => {
  const order = orders.getOrderWithItems('number = ? AND user_id = ?', req.params.number, req.user.id);
  if (!order) return next();
  res.redirect(`/order/${order.number}?t=${order.access_token}`);
});

r.post('/orders/:number/return', limits.forms, (req, res, next) => {
  const order = orders.getOrderWithItems('number = ? AND user_id = ?', req.params.number, req.user.id);
  if (!order) return next();
  const back = `/order/${order.number}?t=${order.access_token}`;
  const days = getSetting('policies', {}).return_days || 7;
  const delivered = order.events.filter(e => e.message.startsWith('Your order was delivered')).pop();
  const deliveredAt = delivered ? new Date(delivered.created_at.replace(' ', 'T') + 'Z') : new Date(order.updated_at.replace(' ', 'T') + 'Z');
  if (order.status !== 'delivered') { flash(res, 'error', 'Returns can be requested once the order is delivered.'); return res.redirect(back); }
  if (Date.now() - deliveredAt.getTime() > days * 86400000) { flash(res, 'error', `The ${days} day return window for this order has closed. Contact us about warranty support.`); return res.redirect(back); }
  if (order.returns.some(x => ['requested', 'approved', 'received'].includes(x.status))) { flash(res, 'error', 'A return is already open for this order.'); return res.redirect(back); }
  const { data, errors } = check(schemas.returnRequest, req.body);
  if (errors) { flash(res, 'error', Object.values(errors)[0]); return res.redirect(back + '#return'); }
  const ids = new Set(order.items.map(i => String(i.id)));
  const items = data.items.filter(i => ids.has(i));
  if (!items.length) { flash(res, 'error', 'Choose at least one item to return.'); return res.redirect(back + '#return'); }
  q.run('INSERT INTO returns (order_id, user_id, items, reason, details) VALUES (?,?,?,?,?)', order.id, req.user.id, JSON.stringify(items.map(Number)), data.reason, data.details);
  orders.event(order.id, 'return', 'Return requested. We will contact you to arrange pickup.');
  flash(res, 'success', 'Return requested. Our team will call you within one working day to arrange pickup.');
  res.redirect(back);
});

// addresses
r.get('/addresses', (req, res) => {
  meta(res, 'Addresses');
  res.render('account/addresses', { tab: 'addresses', addresses: q.all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id', req.user.id), errors: {}, values: {}, editing: null, cities: CITY_LIST, provinces: PROVINCES, cityProvince: CITIES });
});
r.get('/addresses/:id/edit', (req, res, next) => {
  const a = q.get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!a) return next();
  meta(res, 'Edit address');
  res.render('account/addresses', { tab: 'addresses', addresses: q.all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id', req.user.id), errors: {}, values: a, editing: a.id, cities: CITY_LIST, provinces: PROVINCES, cityProvince: CITIES });
});
r.post('/addresses', (req, res) => saveAddress(req, res, null));
r.post('/addresses/:id', (req, res, next) => {
  if (!q.get('SELECT 1 FROM addresses WHERE id = ? AND user_id = ?', req.params.id, req.user.id)) return next();
  saveAddress(req, res, Number(req.params.id));
});
function saveAddress(req, res, id) {
  const { data, errors, values } = check(schemas.address, req.body);
  if (errors) {
    meta(res, 'Addresses');
    return res.status(400).render('account/addresses', { tab: 'addresses', addresses: q.all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id', req.user.id), errors, values, editing: id, cities: CITY_LIST, provinces: PROVINCES, cityProvince: CITIES });
  }
  const first = !q.get('SELECT 1 FROM addresses WHERE user_id = ?', req.user.id);
  const makeDefault = data.is_default || first;
  if (makeDefault) q.run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', req.user.id);
  if (id) {
    q.run(`UPDATE addresses SET label=?, full_name=?, phone=?, line1=?, line2=?, city=?, province=?, postal_code=?, is_default = CASE WHEN ? THEN 1 ELSE is_default END WHERE id = ? AND user_id = ?`,
      data.label, data.full_name, data.phone, data.line1, data.line2, data.city, data.province, data.postal_code, makeDefault ? 1 : 0, id, req.user.id);
  } else {
    q.run('INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, province, postal_code, is_default) VALUES (?,?,?,?,?,?,?,?,?,?)',
      req.user.id, data.label, data.full_name, data.phone, data.line1, data.line2, data.city, data.province, data.postal_code, makeDefault ? 1 : 0);
  }
  flash(res, 'success', 'Address saved.');
  res.redirect('/account/addresses');
}
r.post('/addresses/:id/delete', (req, res) => {
  const a = q.get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (a) {
    q.run('DELETE FROM addresses WHERE id = ?', a.id);
    if (a.is_default) q.run('UPDATE addresses SET is_default = 1 WHERE id = (SELECT id FROM addresses WHERE user_id = ? ORDER BY id LIMIT 1)', req.user.id);
    flash(res, 'success', 'Address removed.');
  }
  res.redirect('/account/addresses');
});
r.post('/addresses/:id/default', (req, res) => {
  if (q.get('SELECT 1 FROM addresses WHERE id = ? AND user_id = ?', req.params.id, req.user.id)) {
    q.run('UPDATE addresses SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?', req.params.id, req.user.id);
  }
  res.redirect('/account/addresses');
});

// profile and password
r.get('/profile', (req, res) => {
  meta(res, 'Profile');
  const u = q.get('SELECT name, email, phone, marketing FROM users WHERE id = ?', req.user.id);
  res.render('account/profile', { tab: 'profile', u, errors: {} });
});
r.post('/profile', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const { normalizePhone } = require('../lib/pk');
  const phone = req.body.phone ? normalizePhone(req.body.phone) : null;
  const errors = {};
  if (name.length < 2) errors.name = 'Enter your name.';
  if (req.body.phone && !phone) errors.phone = 'Enter a Pakistani mobile number, for example 0300 1234567.';
  if (Object.keys(errors).length) {
    meta(res, 'Profile');
    return res.status(400).render('account/profile', { tab: 'profile', u: { ...req.body, email: req.user.email }, errors });
  }
  const marketing = req.body.marketing === 'on' ? 1 : 0;
  q.run('UPDATE users SET name = ?, phone = ?, marketing = ? WHERE id = ?', name, phone, marketing, req.user.id);
  if (marketing) q.run('INSERT OR IGNORE INTO newsletter (email) VALUES (?)', req.user.email);
  else q.run('DELETE FROM newsletter WHERE email = ?', req.user.email);
  flash(res, 'success', 'Profile updated.');
  res.redirect('/account/profile');
});
r.post('/password', limits.auth, async (req, res, next) => {
  try {
    const u = q.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!(await checkPassword(String(req.body.current || ''), u.password_hash))) { flash(res, 'error', 'Your current password is not right.'); return res.redirect('/account/profile'); }
    const pw = passwordSchema.safeParse(req.body.password || '');
    if (!pw.success) { flash(res, 'error', pw.error.issues[0].message); return res.redirect('/account/profile'); }
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pw.data), req.user.id);
    q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.session.id);
    flash(res, 'success', 'Password changed. Other devices have been signed out.');
    res.redirect('/account/profile');
  } catch (e) { next(e); }
});

module.exports = r;

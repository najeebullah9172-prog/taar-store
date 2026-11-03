'use strict';
const express = require('express');
const { q, json, getSetting, setSetting } = require('../../db');
const { requirePerm, audit, hashPassword } = require('../../lib/auth');
const { flash } = require('../../lib/session');
const { password: passwordSchema } = require('../../lib/validate');
const { CITY_LIST } = require('../../lib/pk');
const config = require('../../config');

const r = express.Router();
const int = (v, def = null) => (v === '' || v == null || isNaN(parseInt(v, 10)) ? def : parseInt(v, 10));

// ---------- discounts ----------
r.get('/discounts', requirePerm('discounts'), (req, res) => {
  const list = q.all(`SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.coupon_code = c.code COLLATE NOCASE AND o.status != 'cancelled') orders,
                      (SELECT COALESCE(SUM(discount),0) FROM orders o WHERE o.coupon_code = c.code COLLATE NOCASE AND o.status != 'cancelled') given
                      FROM coupons c ORDER BY active DESC, created_at DESC`);
  const edit = req.query.edit ? list.find(c => String(c.id) === req.query.edit) : null;
  res.render('admin/discounts', { list, edit, today: new Date().toISOString().slice(0, 10) });
});
r.post('/discounts', requirePerm('discounts'), (req, res) => {
  const id = int(req.body.id);
  const code = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
  const type = ['percent', 'fixed', 'free_shipping'].includes(req.body.type) ? req.body.type : null;
  const value = int(req.body.value, 0);
  const err = !code || code.length < 3 ? 'Codes need at least 3 letters or numbers.'
    : !type ? 'Choose a discount type.'
      : type === 'percent' && (value < 1 || value > 90) ? 'Percentage discounts must be between 1 and 90.'
        : type === 'fixed' && value < 1 ? 'Enter the amount in rupees.'
          : q.get('SELECT 1 FROM coupons WHERE code = ? AND id != ?', code, id || 0) ? 'That code already exists.' : null;
  if (err) { flash(res, 'error', err); return res.redirect('/admin/discounts' + (id ? `?edit=${id}` : '')); }
  const vals = [code, String(req.body.description || '').slice(0, 160), type, type === 'free_shipping' ? 0 : value, int(req.body.min_subtotal, 0),
    int(req.body.max_discount), int(req.body.usage_limit), int(req.body.per_customer_limit), req.body.starts_at || null, req.body.ends_at || null, req.body.active === 'on' ? 1 : 0];
  if (id) q.run('UPDATE coupons SET code=?, description=?, type=?, value=?, min_subtotal=?, max_discount=?, usage_limit=?, per_customer_limit=?, starts_at=?, ends_at=?, active=? WHERE id = ?', ...vals, id);
  else q.run('INSERT INTO coupons (code, description, type, value, min_subtotal, max_discount, usage_limit, per_customer_limit, starts_at, ends_at, active) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ...vals);
  audit(req, id ? 'coupon.update' : 'coupon.create', 'coupon', id, { code });
  flash(res, 'success', `Discount code ${code} saved.`);
  res.redirect('/admin/discounts');
});
r.post('/discounts/:id/toggle', requirePerm('discounts'), (req, res) => {
  q.run('UPDATE coupons SET active = 1 - active WHERE id = ?', req.params.id);
  audit(req, 'coupon.toggle', 'coupon', req.params.id);
  res.redirect('/admin/discounts');
});

// ---------- shipping ----------
r.get('/shipping', requirePerm('shipping'), (req, res) => {
  const zones = q.all('SELECT * FROM shipping_zones ORDER BY sort').map(z => ({ ...z, cities: json(z.cities, []) }));
  res.render('admin/shipping', { zones, cities: CITY_LIST, payments: getSetting('payments', {}) });
});
r.post('/shipping', requirePerm('shipping'), (req, res) => {
  const zones = Array.isArray(req.body.zones) ? req.body.zones : Object.values(req.body.zones || {});
  let fallback = 0;
  for (const z of zones) {
    const cities = [].concat(z.cities || []).filter(c => CITY_LIST.includes(c));
    if (!cities.length) fallback++;
    const vals = [String(z.name || 'Zone').slice(0, 60), JSON.stringify(cities), int(z.standard_rate, 0), int(z.express_rate), int(z.per_kg, 0), int(z.free_over),
      int(z.eta_min, 2), int(z.eta_max, 4), int(z.express_eta, 1), z.cod_available === 'on' ? 1 : 0, z.active === 'on' ? 1 : 0];
    if (z.id) q.run('UPDATE shipping_zones SET name=?, cities=?, standard_rate=?, express_rate=?, per_kg=?, free_over=?, eta_min=?, eta_max=?, express_eta=?, cod_available=?, active=? WHERE id = ?', ...vals, int(z.id));
    else if (z.name) q.run('INSERT INTO shipping_zones (name, cities, standard_rate, express_rate, per_kg, free_over, eta_min, eta_max, express_eta, cod_available, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?, 99)', ...vals);
  }
  audit(req, 'shipping.update', 'shipping', null);
  flash(res, fallback ? 'success' : 'error', fallback ? 'Shipping zones saved.' : 'Saved, but no zone covers the rest of Pakistan. Leave one zone with no cities selected so every city can check out.');
  res.redirect('/admin/shipping');
});

// ---------- store settings (admin only) ----------
r.get('/settings', requirePerm('settings'), (req, res) => {
  res.render('admin/settings', {
    s: { store: getSetting('store', {}), announcement: getSetting('announcement', ''), payments: getSetting('payments', {}), policies: getSetting('policies', {}) },
    env: {
      sandbox: config.payments.sandbox, safepay: !!config.payments.safepay.apiKey, jazzcash: !!config.payments.jazzcash.merchantId,
      smtp: !!config.smtpUrl, prod: config.isProd,
    },
  });
});
r.post('/settings', requirePerm('settings'), (req, res) => {
  const b = req.body;
  const cut = (v, n) => String(v || '').trim().slice(0, n);
  setSetting('store', { name: cut(b.name, 60) || 'Taar', legal_name: cut(b.legal_name, 120), email: cut(b.email, 120), phone: cut(b.phone, 40), whatsapp: cut(b.whatsapp, 40), address: cut(b.address, 200), hours: cut(b.hours, 120) });
  setSetting('announcement', cut(b.announcement, 200));
  const banks = [].concat(b.bank_name || []).map((bank, i) => ({ bank: cut(bank, 60), title: cut([].concat(b.bank_title || [])[i], 100), account: cut([].concat(b.bank_account || [])[i], 40), iban: cut([].concat(b.bank_iban || [])[i], 40) })).filter(x => x.bank);
  setSetting('payments', {
    cod: { enabled: b.cod_enabled === 'on', fee: int(b.cod_fee, 0), max_order: int(b.cod_max) },
    bank_transfer: { enabled: b.bank_enabled === 'on', accounts: banks },
    card: { enabled: b.card_enabled === 'on', provider: ['sandbox', 'safepay', 'jazzcash'].includes(b.card_provider) ? b.card_provider : 'sandbox' },
  });
  setSetting('policies', { return_days: int(b.return_days, 7), cancellation_hours: int(b.cancellation_hours, 24) });
  audit(req, 'settings.update', 'settings', null);
  flash(res, 'success', 'Settings saved.');
  res.redirect('/admin/settings');
});

// ---------- staff (admin only) ----------
r.get('/staff', requirePerm('staff'), (req, res) => {
  const staff = q.all(`SELECT id, name, email, role, disabled, last_login_at, created_at FROM users WHERE role != 'customer' ORDER BY role, name`);
  const log = q.all('SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 60');
  res.render('admin/staff', { staff, log });
});
r.post('/staff', requirePerm('staff'), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 80);
    const role = ['admin', 'manager', 'support'].includes(req.body.role) ? req.body.role : null;
    const pw = passwordSchema.safeParse(req.body.password || '');
    const err = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Enter a valid email.' : name.length < 2 ? 'Enter a name.' : !role ? 'Choose a role.'
      : !pw.success ? pw.error.issues[0].message : null;
    if (err) { flash(res, 'error', err); return res.redirect('/admin/staff'); }
    const existing = q.get('SELECT * FROM users WHERE email = ?', email);
    if (existing && existing.role !== 'customer') { flash(res, 'error', 'That person is already on the staff list.'); return res.redirect('/admin/staff'); }
    if (existing) q.run('UPDATE users SET role = ?, name = ?, password_hash = ? WHERE id = ?', role, name, await hashPassword(pw.data), existing.id);
    else q.run('INSERT INTO users (email, name, role, password_hash) VALUES (?,?,?,?)', email, name, role, await hashPassword(pw.data));
    audit(req, 'staff.create', 'user', email, { role });
    flash(res, 'success', `${name} can now sign in as ${role}.`);
    res.redirect('/admin/staff');
  } catch (e) { next(e); }
});
r.post('/staff/:id', requirePerm('staff'), (req, res) => {
  const u = q.get(`SELECT * FROM users WHERE id = ? AND role != 'customer'`, req.params.id);
  if (!u) return res.redirect('/admin/staff');
  if (u.id === req.user.id) { flash(res, 'error', 'You cannot change your own role or access.'); return res.redirect('/admin/staff'); }
  const action = req.body.action;
  if (['admin', 'manager', 'support'].includes(action)) q.run('UPDATE users SET role = ? WHERE id = ?', action, u.id);
  if (action === 'toggle') { q.run('UPDATE users SET disabled = 1 - disabled WHERE id = ?', u.id); q.run('DELETE FROM sessions WHERE user_id = ?', u.id); }
  if (action === 'remove') { q.run(`UPDATE users SET role = 'customer' WHERE id = ?`, u.id); q.run('DELETE FROM sessions WHERE user_id = ?', u.id); }
  audit(req, 'staff.' + action, 'user', u.id);
  flash(res, 'success', 'Staff access updated.');
  res.redirect('/admin/staff');
});

module.exports = r;

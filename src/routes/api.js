'use strict';
// JSON endpoints used by the storefront scripts. All writes require the CSRF header.
const express = require('express');
const { q } = require('../db');
const catalog = require('../lib/catalog');
const pricing = require('../lib/pricing');
const { ensureSession, ownerKey } = require('../lib/session');
const limits = require('../lib/limits');
const { CITY_LIST } = require('../lib/pk');

const r = express.Router();
r.use('/api', limits.api);

function cartJson(req, extra = {}) {
  const owner = ownerKey(req);
  const s = pricing.summarize(owner, { userId: req.user?.id, email: req.user?.email });
  return {
    ok: true,
    ...extra,
    cart: {
      count: s.count, subtotal: s.subtotal, discount: s.discount, shipping: s.shipping, total: s.total,
      city: s.city, toFree: s.toFree, freeOver: s.freeOver, coupon: s.coupon, shippingMethod: s.shippingMethod,
      lines: s.lines.map(l => ({
        variant_id: l.variant_id, product_id: l.product_id, slug: l.slug, name: l.name, brand: l.brand, image: l.image,
        variant_label: l.variant_label, price: l.price, compare_price: l.compare_price, qty: l.qty, stock: l.stock,
        line_total: l.line_total, problem: l.problem,
      })),
    },
  };
}

r.get('/api/search/suggest', (req, res) => {
  const text = String(req.query.q || '').trim().slice(0, 80);
  if (text.length < 2) return res.json({ products: [], categories: [], total: 0 });
  res.json(catalog.suggest(text));
});

r.get('/api/products', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 12);
  const list = catalog.listProducts({ ids, perPage: 12 }).items;
  const byId = new Map(list.map(p => [p.id, p]));
  res.json({ products: ids.map(id => byId.get(id)).filter(Boolean).map(p => ({
    id: p.id, slug: p.slug, name: p.name, brand: p.brand, price: p.price, compare_price: p.compare_price,
    image: p.image, rating_avg: p.rating_avg, rating_count: p.rating_count, in_stock: p.in_stock,
  })) });
});

r.get('/api/cart', (req, res) => res.json(cartJson(req)));

function readQty(v, def = 1) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : def;
}

r.post('/api/cart/items', (req, res) => {
  const variantId = Number(req.body.variant_id);
  if (!Number.isInteger(variantId)) return res.status(400).json({ ok: false, message: 'Choose an option first.' });
  ensureSession(req, res, req.user?.id);
  const out = pricing.addItem(ownerKey(req), variantId, Math.max(1, readQty(req.body.qty)));
  if (!out.ok) return res.status(409).json(out);
  res.json(cartJson(req, { message: out.message, added: variantId }));
});

r.patch('/api/cart/items/:variantId', (req, res) => {
  const owner = ownerKey(req);
  if (!owner) return res.status(404).json({ ok: false, message: 'Your cart is empty.' });
  const out = pricing.setQty(owner, Number(req.params.variantId), readQty(req.body.qty, 1));
  if (!out.ok) return res.status(400).json(out);
  res.json(cartJson(req, { message: out.message }));
});

r.delete('/api/cart/items/:variantId', (req, res) => {
  const owner = ownerKey(req);
  if (owner) pricing.setQty(owner, Number(req.params.variantId), 0);
  res.json(cartJson(req));
});

r.post('/api/cart/coupon', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 40);
  ensureSession(req, res, req.user?.id);
  const owner = ownerKey(req);
  if (!code) { pricing.setCartField(owner, 'coupon_code', null); return res.json(cartJson(req)); }
  const s = pricing.summarize(owner, { userId: req.user?.id, email: req.user?.email, couponOverride: code });
  if (!s.coupon.ok) return res.status(400).json({ ok: false, message: s.coupon.message });
  pricing.setCartField(owner, 'coupon_code', code);
  res.json(cartJson(req, { message: `${code} applied. ${s.coupon.description || ''}`.trim() }));
});

r.delete('/api/cart/coupon', (req, res) => {
  const owner = ownerKey(req);
  if (owner) pricing.setCartField(owner, 'coupon_code', null);
  res.json(cartJson(req));
});

r.post('/api/cart/city', (req, res) => {
  const city = String(req.body.city || '');
  if (!CITY_LIST.includes(city)) return res.status(400).json({ ok: false, message: 'Choose a city from the list.' });
  ensureSession(req, res, req.user?.id);
  pricing.setCartField(ownerKey(req), 'city', city);
  const s = pricing.summarize(ownerKey(req), { userId: req.user?.id });
  res.json({ ...cartJson(req), options: s.shippingOptions });
});

r.get('/api/shipping', (req, res) => {
  const city = String(req.query.city || '');
  if (!CITY_LIST.includes(city)) return res.status(400).json({ ok: false, message: 'Choose a city from the list.' });
  const subtotal = Math.max(0, Number(req.query.subtotal) || 0);
  const weightKg = Math.max(0, Number(req.query.weight) || 0);
  const out = pricing.shippingOptions(city, { subtotal, weightKg });
  res.json({ ok: true, zone: out.zone?.name, methods: out.methods, freeOver: out.freeOver, cod: out.codAvailable });
});

r.post('/api/wishlist/toggle', (req, res) => {
  const productId = Number(req.body.product_id);
  if (!q.get(`SELECT 1 FROM products WHERE id = ? AND status = 'active'`, productId)) return res.status(404).json({ ok: false, message: 'Product not found.' });
  ensureSession(req, res, req.user?.id);
  const owner = ownerKey(req);
  const has = q.get('SELECT 1 FROM wishlist WHERE owner = ? AND product_id = ?', owner, productId);
  if (has) q.run('DELETE FROM wishlist WHERE owner = ? AND product_id = ?', owner, productId);
  else q.run('INSERT INTO wishlist (owner, product_id) VALUES (?,?)', owner, productId);
  res.json({ ok: true, saved: !has, count: q.get('SELECT COUNT(*) n FROM wishlist WHERE owner = ?', owner).n });
});

r.get('/api/wishlist', (req, res) => {
  const owner = ownerKey(req);
  const ids = owner ? q.all('SELECT product_id FROM wishlist WHERE owner = ?', owner).map(x => x.product_id) : [];
  res.json({ ok: true, ids });
});

module.exports = r;

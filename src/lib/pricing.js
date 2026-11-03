'use strict';
// Cart, coupons and shipping. All money is calculated here on the server; the
// browser only ever displays what this module returns.
const { q, json, getSetting } = require('../db');

// ---------- shipping ----------
function zones() {
  return q.all('SELECT * FROM shipping_zones WHERE active = 1 ORDER BY sort').map(z => ({ ...z, cities: json(z.cities, []) }));
}

function zoneForCity(city) {
  const all = zones();
  const c = String(city || '').trim().toLowerCase();
  return all.find(z => z.cities.some(x => x.toLowerCase() === c)) || all.find(z => z.cities.length === 0) || null;
}

/** Returns available delivery methods for a city, with fees already worked out. */
function shippingOptions(city, { subtotal = 0, weightKg = 0, freeShipping = false } = {}) {
  const zone = zoneForCity(city);
  if (!zone) return { zone: null, methods: [] };
  const extraKg = Math.max(0, Math.ceil(weightKg - 2));
  const weightFee = extraKg * zone.per_kg;
  const free = freeShipping || (zone.free_over != null && subtotal >= zone.free_over);
  const methods = [{
    id: 'standard', label: 'Standard delivery',
    fee: free ? 0 : zone.standard_rate + weightFee,
    eta: zone.eta_min === zone.eta_max ? `${zone.eta_min} working day${zone.eta_min > 1 ? 's' : ''}` : `${zone.eta_min} to ${zone.eta_max} working days`,
    free,
  }];
  if (zone.express_rate != null) {
    methods.push({
      id: 'express', label: zone.express_eta === 0 ? 'Same day delivery' : 'Express delivery',
      fee: zone.express_rate + weightFee,
      eta: zone.express_eta === 0 ? 'Today if ordered before 1 pm' : `${zone.express_eta} working day`,
      free: false,
    });
  }
  return { zone, methods, freeOver: zone.free_over, codAvailable: !!zone.cod_available };
}

// ---------- coupons ----------
function evaluateCoupon(code, { subtotal, userId = null, email = null }) {
  if (!code) return { ok: false };
  const c = q.get('SELECT * FROM coupons WHERE code = ?', String(code).trim());
  const fail = (message) => ({ ok: false, message, code });
  if (!c || !c.active) return fail('That code is not valid. Check the spelling and try again.');
  const today = new Date().toISOString().slice(0, 10);
  if (c.starts_at && today < c.starts_at.slice(0, 10)) return fail('This code is not active yet.');
  if (c.ends_at && today > c.ends_at.slice(0, 10)) return fail('This code has expired.');
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return fail('This code has reached its usage limit.');
  if (subtotal < c.min_subtotal) return fail(`Add Rs ${(c.min_subtotal - subtotal).toLocaleString('en-PK')} more to use this code.`);
  if (c.per_customer_limit != null && (userId || email)) {
    const used = q.get(`SELECT COUNT(*) n FROM orders WHERE coupon_code = ? COLLATE NOCASE AND status != 'cancelled'
                        AND (user_id = ? OR email = ? COLLATE NOCASE)`, c.code, userId, email || '').n;
    if (used >= c.per_customer_limit) return fail('You have already used this code.');
  }
  let discount = 0;
  if (c.type === 'percent') discount = Math.floor(subtotal * c.value / 100);
  if (c.type === 'fixed') discount = c.value;
  if (c.max_discount != null) discount = Math.min(discount, c.max_discount);
  discount = Math.min(discount, subtotal);
  return { ok: true, coupon: c, code: c.code, discount, freeShipping: c.type === 'free_shipping', description: c.description };
}

// ---------- cart ----------
function cartRow(owner, create = false) {
  if (!owner) return null;
  let cart = q.get('SELECT * FROM carts WHERE owner = ?', owner);
  if (!cart && create) {
    q.run('INSERT INTO carts (owner) VALUES (?)', owner);
    cart = q.get('SELECT * FROM carts WHERE owner = ?', owner);
  }
  return cart;
}

function cartLines(cartId) {
  return q.all(`SELECT ci.variant_id, ci.qty, v.sku, v.price, v.compare_price, v.stock, v.options, v.active AS variant_active,
                       p.id AS product_id, p.slug, p.name, p.weight_g, p.status, b.name AS brand,
                       COALESCE(
                         (SELECT url FROM product_images i WHERE i.product_id = p.id AND i.option_value = json_extract(v.options, '$.Color') ORDER BY sort LIMIT 1),
                         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort LIMIT 1)) AS image
                FROM cart_items ci
                JOIN variants v ON v.id = ci.variant_id
                JOIN products p ON p.id = v.product_id
                LEFT JOIN brands b ON b.id = p.brand_id
                WHERE ci.cart_id = ? ORDER BY ci.added_at`, cartId)
    .map(l => {
      const options = json(l.options, {});
      const available = l.status === 'active' && l.variant_active === 1;
      return {
        ...l, options,
        variant_label: Object.values(options).join(' / '),
        line_total: l.price * l.qty,
        available,
        problem: !available ? 'No longer available' : l.stock === 0 ? 'Out of stock' : l.qty > l.stock ? `Only ${l.stock} left` : null,
      };
    });
}

/**
 * Full cart summary for an owner. ctx: { city, shippingMethod, paymentMethod, userId, email, couponOverride }
 */
function summarize(owner, ctx = {}) {
  const cart = cartRow(owner);
  const lines = cart ? cartLines(cart.id) : [];
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const weightKg = lines.reduce((s, l) => s + (l.weight_g || 0) * l.qty, 0) / 1000;

  const code = ctx.couponOverride !== undefined ? ctx.couponOverride : cart?.coupon_code;
  const coupon = code ? evaluateCoupon(code, { subtotal, userId: ctx.userId, email: ctx.email }) : { ok: false };
  const discount = coupon.ok ? coupon.discount : 0;

  const city = ctx.city || cart?.city || null;
  const ship = city ? shippingOptions(city, { subtotal: subtotal - discount, weightKg, freeShipping: coupon.ok && coupon.freeShipping }) : null;
  let method = null;
  if (ship && ship.methods.length) method = ship.methods.find(m => m.id === ctx.shippingMethod) || ship.methods[0];
  const shipping = method ? method.fee : 0;

  const pay = getSetting('payments', {});
  const paymentFee = ctx.paymentMethod === 'cod' && pay.cod ? Number(pay.cod.fee || 0) : 0;
  const total = Math.max(0, subtotal - discount) + shipping + paymentFee;

  // Nudge toward free delivery when it is close.
  const freeOver = ship?.freeOver ?? zones().find(z => z.cities.length > 0)?.free_over ?? null;
  const toFree = freeOver != null && !(method && method.free) ? Math.max(0, freeOver - (subtotal - discount)) : 0;

  return {
    id: cart?.id || null, lines, count, subtotal, discount, shipping, paymentFee, total, weightKg,
    coupon: code ? { code: code.toUpperCase(), ok: coupon.ok, message: coupon.message, description: coupon.description, freeShipping: coupon.freeShipping } : null,
    city, shippingOptions: ship ? ship.methods : [], shippingMethod: method, zone: ship?.zone?.name || null,
    codAvailable: ship ? ship.codAvailable : true,
    freeOver, toFree,
    hasProblems: lines.some(l => l.problem),
  };
}

function addItem(owner, variantId, qty) {
  const v = q.get(`SELECT v.*, p.status FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`, variantId);
  if (!v || !v.active || v.status !== 'active') return { ok: false, message: 'This product is not available.' };
  const cart = cartRow(owner, true);
  const existing = q.get('SELECT qty FROM cart_items WHERE cart_id = ? AND variant_id = ?', cart.id, variantId);
  const want = Math.min(99, (existing ? existing.qty : 0) + qty);
  if (v.stock <= 0) return { ok: false, message: 'Sorry, this item just sold out.' };
  const finalQty = Math.min(want, v.stock);
  q.run(`INSERT INTO cart_items (cart_id, variant_id, qty) VALUES (?,?,?)
         ON CONFLICT(cart_id, variant_id) DO UPDATE SET qty = excluded.qty`, cart.id, variantId, finalQty);
  q.run(`UPDATE carts SET updated_at = datetime('now') WHERE id = ?`, cart.id);
  return { ok: true, capped: finalQty < want, message: finalQty < want ? `Only ${v.stock} in stock, so we added the maximum.` : null };
}

function setQty(owner, variantId, qty) {
  const cart = cartRow(owner);
  if (!cart) return { ok: false, message: 'Your cart is empty.' };
  if (qty <= 0) {
    q.run('DELETE FROM cart_items WHERE cart_id = ? AND variant_id = ?', cart.id, variantId);
    return { ok: true };
  }
  const v = q.get('SELECT stock FROM variants WHERE id = ?', variantId);
  if (!v) return { ok: false, message: 'Item not found.' };
  const finalQty = Math.min(qty, Math.max(v.stock, 1), 99);
  q.run('UPDATE cart_items SET qty = ? WHERE cart_id = ? AND variant_id = ?', finalQty, cart.id, variantId);
  return { ok: true, message: finalQty < qty ? `Only ${v.stock} in stock.` : null };
}

function setCartField(owner, field, value) {
  if (!['coupon_code', 'city'].includes(field)) throw new Error('bad field');
  const cart = cartRow(owner, true);
  q.run(`UPDATE carts SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`, value, cart.id);
}

function clearCart(owner) {
  const cart = cartRow(owner);
  if (cart) { q.run('DELETE FROM cart_items WHERE cart_id = ?', cart.id); q.run('UPDATE carts SET coupon_code = NULL WHERE id = ?', cart.id); }
}

module.exports = { zones, zoneForCity, shippingOptions, evaluateCoupon, summarize, addItem, setQty, setCartField, clearCart, cartRow };

'use strict';
const { q, tx } = require('../db');
const pricing = require('./pricing');
const mailer = require('./mailer');
const { orderNumber, token } = require('./util');

class CheckoutError extends Error {
  constructor(message, field) { super(message); this.field = field; this.status = 400; }
}

/**
 * Places an order from the owner's cart inside one transaction. Prices, discounts
 * and delivery fees are recalculated here, and stock is decremented with a
 * conditional update so two shoppers can never buy the last unit twice.
 */
function placeOrder(owner, user, input) {
  const order = tx(() => {
    const summary = pricing.summarize(owner, {
      city: input.city, shippingMethod: input.shipping_method, paymentMethod: input.payment_method,
      userId: user ? user.id : null, email: input.email,
    });
    if (!summary.lines.length) throw new CheckoutError('Your cart is empty.');
    const bad = summary.lines.find(l => l.problem);
    if (bad) throw new CheckoutError(`${bad.name}: ${bad.problem}. Update your cart to continue.`);
    if (!summary.shippingMethod) throw new CheckoutError('We do not deliver to that city yet.', 'city');
    if (summary.shippingMethod.id !== input.shipping_method) throw new CheckoutError('That delivery option is not available for your city.', 'shipping_method');
    if (summary.coupon && !summary.coupon.ok) throw new CheckoutError(summary.coupon.message || 'Your discount code is no longer valid.', 'coupon');
    if (input.payment_method === 'cod' && !summary.codAvailable) throw new CheckoutError('Cash on delivery is not available in your city.', 'payment_method');

    for (const l of summary.lines) {
      const r = q.run('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?', l.qty, l.variant_id, l.qty);
      if (Number(r.changes) !== 1) throw new CheckoutError(`${l.name} just sold out. Update your cart to continue.`);
      q.run('UPDATE products SET sold_count = sold_count + ? WHERE id = ?', l.qty, l.product_id);
    }
    if (summary.coupon && summary.coupon.ok) {
      const r = q.run(`UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND (usage_limit IS NULL OR used_count < usage_limit)`, summary.coupon.code);
      if (Number(r.changes) !== 1) throw new CheckoutError('That discount code has just reached its limit.', 'coupon');
    }

    let number;
    do { number = orderNumber(); } while (q.get('SELECT 1 FROM orders WHERE number = ?', number));
    const r = q.run(`INSERT INTO orders (number, access_token, user_id, email, phone, full_name, line1, line2, city, province, postal_code,
        subtotal, discount, shipping, payment_fee, total, coupon_code, shipping_method, shipping_zone, payment_method, payment_status, customer_note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    number, token(18), user ? user.id : null, input.email, input.phone, input.full_name, input.line1, input.line2 || null,
    input.city, input.province, input.postal_code || null, summary.subtotal, summary.discount, summary.shipping, summary.paymentFee,
    summary.total, summary.coupon?.ok ? summary.coupon.code : null, summary.shippingMethod.id, summary.zone, input.payment_method,
    input.payment_method === 'card' ? 'pending' : 'unpaid', input.note || null);
    const orderId = Number(r.lastInsertRowid);
    for (const l of summary.lines) {
      q.run('INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label, sku, image, price, qty) VALUES (?,?,?,?,?,?,?,?,?)',
        orderId, l.product_id, l.variant_id, l.name, l.variant_label || null, l.sku, l.image, l.price, l.qty);
    }
    event(orderId, 'placed', 'Order placed');
    pricing.clearCart(owner);

    if (user && input.save_address) {
      const exists = q.get('SELECT id FROM addresses WHERE user_id = ? AND line1 = ? AND city = ?', user.id, input.line1, input.city);
      if (!exists) {
        const first = !q.get('SELECT 1 FROM addresses WHERE user_id = ?', user.id);
        q.run(`INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, province, postal_code, is_default)
               VALUES (?,?,?,?,?,?,?,?,?,?)`, user.id, 'Saved at checkout', input.full_name, input.phone, input.line1, input.line2 || null,
        input.city, input.province, input.postal_code || null, first ? 1 : 0);
      }
    }
    return q.get('SELECT * FROM orders WHERE id = ?', orderId);
  });
  const items = q.all('SELECT * FROM order_items WHERE order_id = ?', order.id);
  mailer.orderPlaced(order, items).catch(() => {});
  return order;
}

function event(orderId, kind, message, { isPublic = true, userId = null } = {}) {
  q.run('INSERT INTO order_events (order_id, kind, message, public, user_id) VALUES (?,?,?,?,?)', orderId, kind, message, isPublic ? 1 : 0, userId);
}

const STATUS_FLOW = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};
const STATUS_TEXT = {
  confirmed: 'Your order is confirmed.',
  processing: 'We are packing your order.',
  shipped: 'Your order is on its way.',
  delivered: 'Your order was delivered. Enjoy!',
  cancelled: 'Your order was cancelled.',
  returned: 'Your return has been received.',
};

function restock(order) {
  if (order.stock_restored) return;
  for (const it of q.all('SELECT variant_id, product_id, qty FROM order_items WHERE order_id = ?', order.id)) {
    if (it.variant_id) q.run('UPDATE variants SET stock = stock + ? WHERE id = ?', it.qty, it.variant_id);
    if (it.product_id) q.run('UPDATE products SET sold_count = MAX(0, sold_count - ?) WHERE id = ?', it.qty, it.product_id);
  }
  if (order.coupon_code) q.run('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?', order.coupon_code);
  q.run('UPDATE orders SET stock_restored = 1 WHERE id = ?', order.id);
}

function setStatus(orderId, status, { userId = null, courier = null, tracking = null, note = null, force = false } = {}) {
  return tx(() => {
    const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw new CheckoutError('Order not found.');
    if (order.status === status) return order;
    if (!force && !STATUS_FLOW[order.status].includes(status)) {
      throw new CheckoutError(`An order that is ${order.status} cannot be moved to ${status}.`);
    }
    if (status === 'shipped' && (!courier || !tracking) && !order.tracking_number) {
      throw new CheckoutError('Add the courier and tracking number before marking the order as shipped.');
    }
    q.run(`UPDATE orders SET status = ?, courier = COALESCE(?, courier), tracking_number = COALESCE(?, tracking_number),
           updated_at = datetime('now') WHERE id = ?`, status, courier, tracking, orderId);
    if (status === 'cancelled' || status === 'returned') restock(order);
    if (status === 'cancelled' && order.payment_status === 'paid') {
      event(orderId, 'note', 'Order was paid. Issue a refund and mark the payment as refunded.', { isPublic: false, userId });
    }
    if (status === 'delivered' && order.payment_method === 'cod' && order.payment_status !== 'paid') {
      q.run(`UPDATE orders SET payment_status = 'paid' WHERE id = ?`, orderId);
      event(orderId, 'payment', 'Cash collected on delivery', { userId });
    }
    event(orderId, 'status', STATUS_TEXT[status] + (note ? ` ${note}` : ''), { userId });
    const updated = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    mailer.statusChanged(updated, STATUS_TEXT[status]).catch(() => {});
    return updated;
  });
}

function setPaymentStatus(orderId, status, { userId = null, reference = null, note = null } = {}) {
  return tx(() => {
    q.run(`UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`, status, orderId);
    const latest = q.get('SELECT id FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', orderId);
    const map = { paid: 'succeeded', failed: 'failed', refunded: 'refunded', awaiting_verification: 'pending', pending: 'pending' };
    if (latest && map[status]) q.run(`UPDATE payments SET status = ?, reference = COALESCE(?, reference), updated_at = datetime('now') WHERE id = ?`, map[status], reference, latest.id);
    const label = { paid: 'Payment received', failed: 'Payment failed', refunded: 'Payment refunded', awaiting_verification: 'Payment reference submitted, waiting for verification', unpaid: 'Payment marked as unpaid', partially_refunded: 'Partial refund issued' }[status] || status;
    event(orderId, 'payment', label + (note ? `. ${note}` : ''), { userId });
    const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    // Paid online orders move straight to confirmed.
    if (status === 'paid' && order.status === 'pending') return setStatus(orderId, 'confirmed', { userId });
    return order;
  });
}

function canCustomerCancel(order) {
  return ['pending', 'confirmed'].includes(order.status);
}

function getOrderWithItems(where, ...params) {
  const order = q.get(`SELECT * FROM orders WHERE ${where}`, ...params);
  if (!order) return null;
  order.items = q.all('SELECT * FROM order_items WHERE order_id = ?', order.id);
  order.events = q.all('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, id', order.id);
  order.returns = q.all('SELECT * FROM returns WHERE order_id = ? ORDER BY id DESC', order.id);
  return order;
}

module.exports = { placeOrder, setStatus, setPaymentStatus, event, canCustomerCancel, getOrderWithItems, STATUS_FLOW, CheckoutError, restock };

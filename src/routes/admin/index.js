'use strict';
const express = require('express');
const { q, json } = require('../../db');
const { requirePerm, can, audit } = require('../../lib/auth');
const { flash } = require('../../lib/session');
const orders = require('../../lib/orders');
const { CheckoutError } = orders;

const r = express.Router();

// Every admin page needs a staff account. Each section checks its own permission.
r.use((req, res, next) => {
  if (!req.user) return res.redirect(`/account/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.user.role === 'customer') {
    const err = new Error('This area is for store staff.'); err.status = 403; return next(err);
  }
  res.locals.adminNav = [
    { href: '/admin', label: 'Overview', perm: 'dashboard', icon: 'grid' },
    { href: '/admin/orders', label: 'Orders', perm: 'orders', icon: 'box', badge: q.get(`SELECT COUNT(*) n FROM orders WHERE status = 'pending'`).n },
    { href: '/admin/products', label: 'Products', perm: 'catalog', icon: 'tag' },
    { href: '/admin/inventory', label: 'Inventory', perm: 'inventory', icon: 'layers', badge: q.get('SELECT COUNT(*) n FROM variants v JOIN products p ON p.id = v.product_id WHERE v.active = 1 AND p.status = \'active\' AND v.stock <= 2').n },
    { href: '/admin/categories', label: 'Categories', perm: 'catalog', icon: 'folder' },
    { href: '/admin/brands', label: 'Brands', perm: 'catalog', icon: 'star' },
    { href: '/admin/customers', label: 'Customers', perm: 'customers', icon: 'users' },
    { href: '/admin/discounts', label: 'Discounts', perm: 'discounts', icon: 'percent' },
    { href: '/admin/shipping', label: 'Shipping', perm: 'shipping', icon: 'truck' },
    { href: '/admin/returns', label: 'Returns', perm: 'returns', icon: 'undo', badge: q.get(`SELECT COUNT(*) n FROM returns WHERE status = 'requested'`).n },
    { href: '/admin/reviews', label: 'Reviews', perm: 'reviews', icon: 'chat', badge: q.get(`SELECT COUNT(*) n FROM reviews WHERE status = 'pending'`).n },
    { href: '/admin/messages', label: 'Messages', perm: 'messages', icon: 'mail', badge: q.get('SELECT COUNT(*) n FROM messages WHERE handled = 0').n },
    { href: '/admin/settings', label: 'Settings', perm: 'settings', icon: 'cog' },
    { href: '/admin/staff', label: 'Staff', perm: 'staff', icon: 'shield' },
  ].filter(i => can(req.user, i.perm));
  res.locals.meta = { title: 'Admin | Taar', noindex: true };
  next();
});

const page = (v, def = 1) => Math.max(1, parseInt(v, 10) || def);

// ---------- dashboard ----------
r.get('/', requirePerm('dashboard'), (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = `-${days} days`;
  const prevSince = `-${days * 2} days`;
  const live = `status NOT IN ('cancelled')`;
  const cur = q.get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(AVG(total),0) aov FROM orders WHERE ${live} AND created_at >= datetime('now', ?)`, since);
  const prev = q.get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders WHERE ${live} AND created_at >= datetime('now', ?) AND created_at < datetime('now', ?)`, prevSince, since);
  const customers = q.get(`SELECT COUNT(DISTINCT email) n FROM orders WHERE created_at >= datetime('now', ?)`, since).n;
  const daily = q.all(`SELECT date(created_at, '+5 hours') d, COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders
                       WHERE ${live} AND created_at >= datetime('now', ?) GROUP BY d ORDER BY d`, since);
  // Fill gaps so the chart has one bar per day.
  const series = [];
  const map = new Map(daily.map(d => [d.d, d]));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + 5 * 3600000 - i * 86400000).toISOString().slice(0, 10);
    series.push({ d, revenue: map.get(d)?.revenue || 0, orders: map.get(d)?.orders || 0 });
  }
  const byStatus = q.all(`SELECT status, COUNT(*) n FROM orders WHERE created_at >= datetime('now', ?) GROUP BY status`, since);
  const byPayment = q.all(`SELECT payment_method m, COUNT(*) n, SUM(total) revenue FROM orders WHERE ${live} AND created_at >= datetime('now', ?) GROUP BY m ORDER BY revenue DESC`, since);
  const topProducts = q.all(`SELECT oi.name, p.slug, SUM(oi.qty) units, SUM(oi.qty * oi.price) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
                             LEFT JOIN products p ON p.id = oi.product_id WHERE o.${live} AND o.created_at >= datetime('now', ?) GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 6`, since);
  const topCategories = q.all(`SELECT c.name, SUM(oi.qty * oi.price) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
                               JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
                               WHERE o.${live} AND o.created_at >= datetime('now', ?) GROUP BY c.id ORDER BY revenue DESC LIMIT 6`, since);
  const topCities = q.all(`SELECT city, COUNT(*) n, SUM(total) revenue FROM orders WHERE ${live} AND created_at >= datetime('now', ?) GROUP BY city ORDER BY revenue DESC LIMIT 6`, since);
  const lowStock = q.all(`SELECT v.id, v.sku, v.stock, v.options, p.name, p.id AS product_id FROM variants v JOIN products p ON p.id = v.product_id
                          WHERE v.active = 1 AND p.status = 'active' AND v.stock <= 2 ORDER BY v.stock, p.name LIMIT 8`).map(v => ({ ...v, options: json(v.options, {}) }));
  const recent = q.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8');
  const todo = {
    pending: q.get(`SELECT COUNT(*) n FROM orders WHERE status = 'pending'`).n,
    verify: q.get(`SELECT COUNT(*) n FROM orders WHERE payment_status = 'awaiting_verification'`).n,
    toShip: q.get(`SELECT COUNT(*) n FROM orders WHERE status IN ('confirmed','processing')`).n,
    returns: q.get(`SELECT COUNT(*) n FROM returns WHERE status = 'requested'`).n,
    reviews: q.get(`SELECT COUNT(*) n FROM reviews WHERE status = 'pending'`).n,
  };
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  res.render('admin/dashboard', {
    days, cur, prev, customers, series, byStatus, byPayment, topProducts, topCategories, topCities, lowStock, recent, todo,
    change: { revenue: pct(cur.revenue, prev.revenue), orders: pct(cur.orders, prev.orders) },
  });
});

// ---------- orders ----------
r.get('/orders', requirePerm('orders'), (req, res) => {
  const where = []; const params = [];
  const { status, payment, method } = req.query;
  const text = String(req.query.q || '').trim();
  if (status && orders.STATUS_FLOW[status]) { where.push('status = ?'); params.push(status); }
  if (payment) { where.push('payment_status = ?'); params.push(String(payment)); }
  if (method) { where.push('payment_method = ?'); params.push(String(method)); }
  if (text) { where.push('(number LIKE ? OR email LIKE ? OR full_name LIKE ? OR phone LIKE ?)'); const t = `%${text}%`; params.push(t, t, t, t); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = q.get(`SELECT COUNT(*) n FROM orders ${w}`, ...params).n;
  const p = page(req.query.page); const per = 25;
  const list = q.all(`SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) items FROM orders o ${w} ORDER BY created_at DESC LIMIT ${per} OFFSET ${(p - 1) * per}`, ...params);
  const counts = Object.fromEntries(q.all('SELECT status, COUNT(*) n FROM orders GROUP BY status').map(x => [x.status, x.n]));
  res.render('admin/orders', { list, total, page: p, pages: Math.max(1, Math.ceil(total / per)), counts, filters: { status, payment, method, q: text } });
});

r.get('/orders/:id', requirePerm('orders'), (req, res, next) => {
  const order = orders.getOrderWithItems('id = ?', req.params.id);
  if (!order) return next();
  const paymentsList = q.all('SELECT * FROM payments WHERE order_id = ? ORDER BY id', order.id);
  const customer = order.user_id ? q.get('SELECT id, name, email, created_at FROM users WHERE id = ?', order.user_id) : null;
  const history = q.get('SELECT COUNT(*) n, SUM(total) spent FROM orders WHERE (email = ? OR user_id = ?) AND status != \'cancelled\'', order.email, order.user_id);
  res.render('admin/order', { order, paymentsList, customer, history, nextStatuses: orders.STATUS_FLOW[order.status] });
});

function orderAction(handler) {
  return (req, res, next) => {
    const order = q.get('SELECT * FROM orders WHERE id = ?', req.params.id);
    if (!order) return next();
    try {
      const msg = handler(req, order);
      flash(res, 'success', msg);
    } catch (e) {
      if (e instanceof CheckoutError) flash(res, 'error', e.message); else return next(e);
    }
    res.redirect(`/admin/orders/${order.id}`);
  };
}

r.post('/orders/:id/status', requirePerm('orders'), orderAction((req, order) => {
  const status = String(req.body.status);
  const courier = String(req.body.courier || '').trim().slice(0, 40) || null;
  const tracking = String(req.body.tracking || '').trim().slice(0, 40) || null;
  orders.setStatus(order.id, status, { userId: req.user.id, courier, tracking });
  audit(req, 'order.status', 'order', order.id, { from: order.status, to: status });
  return `Order ${order.number} marked as ${status}. The customer has been emailed.`;
}));

r.post('/orders/:id/payment', requirePerm('orders'), orderAction((req, order) => {
  const status = String(req.body.payment_status);
  const allowed = ['unpaid', 'awaiting_verification', 'paid', 'failed', 'refunded', 'partially_refunded'];
  if (!allowed.includes(status)) throw new CheckoutError('Unknown payment status.');
  orders.setPaymentStatus(order.id, status, { userId: req.user.id, note: String(req.body.note || '').slice(0, 200) || null });
  audit(req, 'order.payment', 'order', order.id, { from: order.payment_status, to: status });
  return `Payment marked as ${status.replace(/_/g, ' ')}.`;
}));

r.post('/orders/:id/tracking', requirePerm('orders'), orderAction((req, order) => {
  const courier = String(req.body.courier || '').trim().slice(0, 40);
  const tracking = String(req.body.tracking || '').trim().slice(0, 40);
  if (!courier || !tracking) throw new CheckoutError('Enter both the courier and the tracking number.');
  q.run(`UPDATE orders SET courier = ?, tracking_number = ?, updated_at = datetime('now') WHERE id = ?`, courier, tracking, order.id);
  orders.event(order.id, 'tracking', `Shipped with ${courier}. Tracking number ${tracking}.`, { userId: req.user.id });
  return 'Tracking details saved.';
}));

r.post('/orders/:id/note', requirePerm('orders'), orderAction((req, order) => {
  const note = String(req.body.note || '').trim().slice(0, 1000);
  if (!note) throw new CheckoutError('Write a note first.');
  orders.event(order.id, 'note', note, { isPublic: false, userId: req.user.id });
  return 'Note added. Only staff can see it.';
}));

// ---------- customers ----------
r.get('/customers', requirePerm('customers'), (req, res) => {
  const text = String(req.query.q || '').trim();
  const params = []; let w = `WHERE u.role = 'customer'`;
  if (text) { w += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'; params.push(`%${text}%`, `%${text}%`, `%${text}%`); }
  const p = page(req.query.page); const per = 30;
  const total = q.get(`SELECT COUNT(*) n FROM users u ${w}`, ...params).n;
  const list = q.all(`SELECT u.*, COUNT(o.id) orders, COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END),0) spent, MAX(o.created_at) last_order
                      FROM users u LEFT JOIN orders o ON o.user_id = u.id ${w} GROUP BY u.id ORDER BY u.created_at DESC LIMIT ${per} OFFSET ${(p - 1) * per}`, ...params);
  const guests = q.get(`SELECT COUNT(DISTINCT email) n FROM orders WHERE user_id IS NULL`).n;
  res.render('admin/customers', { list, total, page: p, pages: Math.max(1, Math.ceil(total / per)), q: text, guests });
});

r.get('/customers/:id', requirePerm('customers'), (req, res, next) => {
  const u = q.get(`SELECT * FROM users WHERE id = ? AND role = 'customer'`, req.params.id);
  if (!u) return next();
  const list = q.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', u.id);
  const addresses = q.all('SELECT * FROM addresses WHERE user_id = ?', u.id);
  res.render('admin/customer', { u, list, addresses });
});

r.post('/customers/:id/toggle', requirePerm('staff'), (req, res) => {
  const u = q.get(`SELECT * FROM users WHERE id = ? AND role = 'customer'`, req.params.id);
  if (u) {
    q.run('UPDATE users SET disabled = ? WHERE id = ?', u.disabled ? 0 : 1, u.id);
    if (!u.disabled) q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    audit(req, u.disabled ? 'customer.enable' : 'customer.disable', 'user', u.id);
    flash(res, 'success', u.disabled ? 'Account enabled.' : 'Account disabled and signed out everywhere.');
  }
  res.redirect(`/admin/customers/${req.params.id}`);
});

// ---------- returns ----------
r.get('/returns', requirePerm('returns'), (req, res) => {
  const list = q.all(`SELECT r.*, o.number, o.full_name, o.total, o.id AS order_id, o.payment_method FROM returns r JOIN orders o ON o.id = r.order_id
                      ORDER BY CASE r.status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 WHEN 'received' THEN 2 ELSE 3 END, r.created_at DESC`);
  for (const x of list) {
    const ids = json(x.items, []);
    x.lines = ids.length ? q.all(`SELECT * FROM order_items WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
    x.value = x.lines.reduce((s, l) => s + l.price * l.qty, 0);
  }
  res.render('admin/returns', { list });
});

r.post('/returns/:id', requirePerm('returns'), (req, res, next) => {
  const ret = q.get('SELECT * FROM returns WHERE id = ?', req.params.id);
  if (!ret) return next();
  const status = String(req.body.status);
  const flow = { requested: ['approved', 'rejected'], approved: ['received', 'rejected'], received: ['refunded'], rejected: [], refunded: [] };
  if (!flow[ret.status].includes(status)) { flash(res, 'error', `A ${ret.status} return cannot move to ${status}.`); return res.redirect('/admin/returns'); }
  const note = String(req.body.note || '').trim().slice(0, 500) || null;
  const refund = status === 'refunded' ? Math.max(0, parseInt(req.body.refund_amount, 10) || 0) : null;
  q.run(`UPDATE returns SET status = ?, admin_note = COALESCE(?, admin_note), refund_amount = COALESCE(?, refund_amount), updated_at = datetime('now') WHERE id = ?`, status, note, refund, ret.id);
  const msgs = { approved: 'Return approved. A courier will collect the item.', rejected: `Return request declined.${note ? ' ' + note : ''}`, received: 'We received your returned item and are checking it.', refunded: `Refund of Rs ${(refund || 0).toLocaleString('en-PK')} issued.` };
  orders.event(ret.order_id, 'return', msgs[status], { userId: req.user.id });
  if (status === 'received') {
    // Put returned units back into stock.
    for (const itemId of json(ret.items, [])) {
      const it = q.get('SELECT * FROM order_items WHERE id = ?', itemId);
      if (it?.variant_id) q.run('UPDATE variants SET stock = stock + ? WHERE id = ?', it.qty, it.variant_id);
    }
  }
  if (status === 'refunded') {
    const order = q.get('SELECT * FROM orders WHERE id = ?', ret.order_id);
    q.run(`UPDATE orders SET payment_status = ? WHERE id = ?`, refund >= order.total ? 'refunded' : 'partially_refunded', order.id);
  }
  audit(req, 'return.' + status, 'return', ret.id, { refund });
  flash(res, 'success', `Return marked as ${status}.`);
  res.redirect('/admin/returns');
});

// ---------- reviews ----------
function refreshRating(productId) {
  const a = q.get(`SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE product_id = ? AND status = 'published'`, productId);
  q.run('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?', a.n ? Math.round(a.a * 10) / 10 : 0, a.n, productId);
}
r.get('/reviews', requirePerm('reviews'), (req, res) => {
  const status = ['pending', 'published', 'hidden'].includes(req.query.status) ? req.query.status : 'pending';
  const list = q.all(`SELECT r.*, p.name AS product, p.slug FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`, status);
  const counts = Object.fromEntries(q.all('SELECT status, COUNT(*) n FROM reviews GROUP BY status').map(x => [x.status, x.n]));
  res.render('admin/reviews', { list, status, counts });
});
r.post('/reviews/:id', requirePerm('reviews'), (req, res) => {
  const rv = q.get('SELECT * FROM reviews WHERE id = ?', req.params.id);
  const action = String(req.body.action);
  if (rv) {
    if (action === 'delete') q.run('DELETE FROM reviews WHERE id = ?', rv.id);
    else if (['published', 'hidden', 'pending'].includes(action)) q.run('UPDATE reviews SET status = ? WHERE id = ?', action, rv.id);
    refreshRating(rv.product_id);
    audit(req, 'review.' + action, 'review', rv.id);
  }
  res.redirect(`/admin/reviews?status=${encodeURIComponent(req.query.from || rv?.status || 'pending')}`);
});

// ---------- messages and emails ----------
r.get('/messages', requirePerm('messages'), (req, res) => {
  res.render('admin/messages', { list: q.all('SELECT * FROM messages ORDER BY handled, created_at DESC LIMIT 200'), emails: can(req.user, 'settings') ? q.all('SELECT * FROM outbox ORDER BY id DESC LIMIT 50') : [] });
});
r.post('/messages/:id/handled', requirePerm('messages'), (req, res) => {
  q.run('UPDATE messages SET handled = 1 - handled WHERE id = ?', req.params.id);
  res.redirect('/admin/messages');
});

r.use(require('./catalog'));
r.use(require('./settings'));

module.exports = r;

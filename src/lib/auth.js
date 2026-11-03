'use strict';
const bcrypt = require('bcryptjs');
const { q, tx } = require('../db');
const { destroySession, ensureSession } = require('./session');

const PERMS = {
  admin: ['*'],
  manager: ['dashboard', 'catalog', 'inventory', 'discounts', 'orders', 'customers', 'shipping', 'returns', 'reviews', 'messages'],
  support: ['dashboard', 'orders', 'customers', 'returns', 'reviews', 'messages'],
  customer: [],
};

function can(user, perm) {
  if (!user) return false;
  const p = PERMS[user.role] || [];
  return p.includes('*') || p.includes(perm);
}

const hashPassword = (pw) => bcrypt.hash(pw, 11);
const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

// Equalises timing between "no such user" and "wrong password".
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 11);

async function authenticate(email, password) {
  const user = q.get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
  const ok = await checkPassword(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || user.disabled) return null;
  return user;
}

// Signs the user in on a fresh session id (prevents session fixation) and moves
// the guest cart and wishlist over to the account.
function signIn(req, res, user) {
  const guestOwner = req.session ? `s:${req.session.id}` : null;
  destroySession(req, res);
  ensureSession(req, res, user.id);
  req.user = { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone };
  res.locals.user = req.user;
  q.run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, user.id);
  if (guestOwner) mergeGuest(guestOwner, `u:${user.id}`);
}

function mergeGuest(from, to) {
  tx(() => {
    const guest = q.get('SELECT * FROM carts WHERE owner = ?', from);
    if (guest) {
      let target = q.get('SELECT * FROM carts WHERE owner = ?', to);
      if (!target) {
        q.run('UPDATE carts SET owner = ? WHERE id = ?', to, guest.id);
      } else {
        for (const it of q.all('SELECT * FROM cart_items WHERE cart_id = ?', guest.id)) {
          q.run(`INSERT INTO cart_items (cart_id, variant_id, qty) VALUES (?,?,?)
                 ON CONFLICT(cart_id, variant_id) DO UPDATE SET qty = MIN(99, cart_items.qty + excluded.qty)`, target.id, it.variant_id, it.qty);
        }
        if (guest.coupon_code && !target.coupon_code) q.run('UPDATE carts SET coupon_code = ? WHERE id = ?', guest.coupon_code, target.id);
        q.run('DELETE FROM carts WHERE id = ?', guest.id);
      }
    }
    q.run('INSERT OR IGNORE INTO wishlist (owner, product_id, added_at) SELECT ?, product_id, added_at FROM wishlist WHERE owner = ?', to, from);
    q.run('DELETE FROM wishlist WHERE owner = ?', from);
  });
}

function requireUser(req, res, next) {
  if (req.user) return next();
  const back = encodeURIComponent(req.originalUrl);
  res.redirect(`/account/login?next=${back}`);
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(`/account/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (!can(req.user, perm)) {
      const err = new Error('You do not have access to this page. Ask an admin to change your role.');
      err.status = 403;
      return next(err);
    }
    next();
  };
}

function audit(req, action, entity, entityId, details) {
  q.run('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)',
    req.user ? req.user.id : null, action, entity || null, entityId == null ? null : String(entityId),
    details ? JSON.stringify(details) : null, req.ip || null);
}

// Only allow redirects back into this site.
function safeNext(n, fallback = '/account') {
  return typeof n === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : fallback;
}

module.exports = { PERMS, can, hashPassword, checkPassword, authenticate, signIn, mergeGuest, requireUser, requirePerm, audit, safeNext };

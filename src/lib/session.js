'use strict';
// Database backed sessions plus stateless CSRF protection.
//
// Session cookie: random 32 byte token, only its SHA-256 is stored, so a leaked
// database cannot be used to hijack sessions. Sessions are created lazily (first
// cart add, wishlist add or login), so casual visitors and crawlers do not fill
// the sessions table.
//
// CSRF: every visitor gets a random httpOnly cookie. Pages embed HMAC(cookie),
// and every state changing request must send that value back in a form field
// or the X-CSRF-Token header. A third party site can neither read the cookie nor
// compute the HMAC without the server secret.
const { q, json } = require('../db');
const config = require('../config');
const { token, sha256, hmac, safeEqual } = require('./util');

const SID = 'taar_sid';
const CSRF = 'taar_csrf';

function cookieOpts(maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: maxAgeMs };
}

function loadSession(req, res, next) {
  req.session = null;
  req.user = null;
  const raw = req.cookies[SID];
  if (raw && typeof raw === 'string' && raw.length < 100) {
    const row = q.get(`SELECT s.*, u.id AS uid, u.email, u.name, u.role, u.phone, u.disabled
                       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
                       WHERE s.id = ? AND s.expires_at > datetime('now')`, sha256(raw));
    if (row) {
      req.session = { id: row.id, userId: row.user_id, data: json(row.data, {}) };
      if (row.uid && !row.disabled) {
        req.user = { id: row.uid, email: row.email, name: row.name, role: row.role, phone: row.phone };
      }
    } else {
      res.clearCookie(SID, { path: '/' });
    }
  }

  // CSRF cookie for everyone.
  let c = req.cookies[CSRF];
  if (!c || typeof c !== 'string' || c.length < 20 || c.length > 100) {
    c = token(24);
    res.cookie(CSRF, c, cookieOpts(365 * 86400000));
  }
  req.csrfToken = hmac(`csrf:${c}`);
  res.locals.csrfToken = req.csrfToken;
  res.locals.user = req.user;
  next();
}

function ensureSession(req, res, userId = null) {
  if (req.session) return req.session;
  const raw = token(32);
  const id = sha256(raw);
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  q.run('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?,?,?,?)', id, userId, 'stateless', expires);
  res.cookie(SID, raw, cookieOpts(config.sessionDays * 86400000));
  req.session = { id, userId, data: {} };
  return req.session;
}

function destroySession(req, res) {
  if (req.session) q.run('DELETE FROM sessions WHERE id = ?', req.session.id);
  req.session = null;
  req.user = null;
  res.clearCookie(SID, { path: '/' });
}

function saveSessionData(req) {
  if (req.session) q.run('UPDATE sessions SET data = ? WHERE id = ?', JSON.stringify(req.session.data), req.session.id);
}

// The cart and wishlist belong to the user when signed in, otherwise to the browser session.
function ownerKey(req) {
  if (req.user) return `u:${req.user.id}`;
  if (req.session) return `s:${req.session.id}`;
  return null;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
function csrfProtect(req, res, next) {
  if (SAFE.has(req.method)) return next();
  // Signed gateway callbacks verify their own HMAC signature instead.
  if (req.path.startsWith('/payments/') && req.path.endsWith('/webhook')) return next();
  // Multipart bodies are parsed later by multer, so upload forms carry the token in the query string.
  const multipart = (req.get('content-type') || '').startsWith('multipart/form-data');
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || (multipart ? req.query._csrf : '') || '';
  if (sent && safeEqual(sent, req.csrfToken)) return next();
  const err = new Error('Your session expired or the form was out of date. Refresh the page and try again.');
  err.status = 403;
  next(err);
}

function flash(res, type, message) {
  res.cookie('taar_flash', JSON.stringify({ type, message }), { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 60000, path: '/' });
}
function readFlash(req, res, next) {
  const f = req.cookies.taar_flash;
  res.locals.flash = null;
  if (f) {
    try { const v = JSON.parse(f); if (v && typeof v.message === 'string') res.locals.flash = v; } catch { /* ignore */ }
    res.clearCookie('taar_flash', { path: '/' });
  }
  next();
}

function pruneSessions() {
  q.run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
  q.run(`DELETE FROM carts WHERE owner LIKE 's:%' AND owner NOT IN (SELECT 's:' || id FROM sessions)`);
  q.run(`DELETE FROM wishlist WHERE owner LIKE 's:%' AND owner NOT IN (SELECT 's:' || id FROM sessions)`);
}

module.exports = { loadSession, ensureSession, destroySession, saveSessionData, ownerKey, csrfProtect, flash, readFlash, pruneSessions, SID };

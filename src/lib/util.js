'use strict';
const crypto = require('node:crypto');
const config = require('../config');

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/["']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

const pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
function money(n) { return `Rs ${pkr.format(Math.round(Number(n) || 0))}`; }
function num(n) { return pkr.format(Math.round(Number(n) || 0)); }

function token(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function hmac(data, key = config.secret) { return crypto.createHmac('sha256', key).update(String(data)).digest('hex'); }
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function orderNumber() {
  // TR + yymmdd + 4 random digits, e.g. TR2611034821
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `TR${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${crypto.randomInt(1000, 10000)}`;
}

function dateFmt(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!s) return '';
  const d = new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-PK', { ...opts, timeZone: 'Asia/Karachi' });
}
function dateTimeFmt(s) {
  if (!s) return '';
  const d = new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
}

function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }

function plural(n, word, many = word + 's') { return `${n} ${n === 1 ? word : many}`; }

function variantLabel(options) {
  return Object.values(options || {}).join(' / ');
}

module.exports = { plural, slugify, money, num, token, sha256, hmac, safeEqual, orderNumber, dateFmt, dateTimeFmt, addDays, variantLabel };

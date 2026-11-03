'use strict';
// Payment providers.
//
//   cod            Cash on delivery. Fully working. Admin marks it paid on delivery.
//   bank_transfer  Fully working. Customer submits a transaction reference, admin verifies it.
//   card/sandbox   Built in test gateway. Runs the complete redirect, signed callback and
//                  webhook flow so the online payment path can be tested end to end.
//                  It never charges anyone. Disable with PAYMENT_SANDBOX=0 in production.
//   card/safepay   Adapter outline only. Needs a Safepay merchant account and keys, and must
//   card/jazzcash  be completed against the provider's current API documentation before use.
const config = require('../config');
const { q, getSetting } = require('../db');
const { token, hmac, safeEqual } = require('./util');

function methods(order = null) {
  const s = getSetting('payments', {});
  const list = [];
  if (s.cod?.enabled) {
    const max = s.cod.max_order || null;
    list.push({
      id: 'cod', label: 'Cash on delivery', note: s.cod.fee ? `Rs ${s.cod.fee} handling fee` : 'Pay the rider in cash when your order arrives',
      disabled: order && max && order.total > max ? `Not available for orders above Rs ${max.toLocaleString('en-PK')}` : null,
    });
  }
  if (s.bank_transfer?.enabled) list.push({ id: 'bank_transfer', label: 'Bank transfer', note: 'Transfer to our account. We dispatch once the payment is confirmed.' });
  const provider = onlineProvider();
  if (s.card?.enabled && provider) {
    list.push({ id: 'card', label: 'Debit or credit card, JazzCash, Easypaisa', note: provider.id === 'sandbox' ? 'Test mode: no real money is charged' : `Secure payment with ${provider.name}`, test: provider.id === 'sandbox' });
  }
  return list;
}

function onlineProvider() {
  const s = getSetting('payments', {});
  const want = s.card?.provider || 'sandbox';
  if (want === 'safepay' && config.payments.safepay.apiKey) return { id: 'safepay', name: 'Safepay' };
  if (want === 'jazzcash' && config.payments.jazzcash.merchantId) return { id: 'jazzcash', name: 'JazzCash' };
  if (config.payments.sandbox) return { id: 'sandbox', name: 'Test gateway' };
  return null;
}

function createPayment(order) {
  const provider = order.payment_method === 'card' ? onlineProvider() : { id: order.payment_method };
  if (!provider) throw new Error('No online payment provider is configured.');
  const publicId = `pay_${token(12)}`;
  q.run('INSERT INTO payments (public_id, order_id, provider, amount, status) VALUES (?,?,?,?,?)',
    publicId, order.id, provider.id, order.total, order.payment_method === 'card' ? 'created' : 'pending');
  if (order.payment_method !== 'card') return { redirect: null };
  if (provider.id === 'sandbox') return { redirect: `/pay/sandbox/${publicId}` };
  // Real gateways: build the hosted checkout request here using the provider SDK or API.
  throw new Error(`${provider.name} is not wired up yet. See src/lib/payments.js.`);
}

// ---------- sandbox gateway ----------
const SANDBOX_KEY = () => hmac('sandbox-gateway-key');
function signSandbox(fields) {
  const base = ['pid', 'status', 'amount', 'ref'].map(k => `${k}=${fields[k]}`).join('&');
  return hmac(base, SANDBOX_KEY());
}
function verifySandbox(fields) {
  return typeof fields.sig === 'string' && safeEqual(fields.sig, signSandbox(fields));
}
// Test card rules: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined.
function sandboxCharge(cardNumber) {
  const n = String(cardNumber || '').replace(/\D/g, '');
  if (n === '4000000000000002') return { status: 'failed', reason: 'Card declined by the issuing bank.' };
  if (n.length >= 12) return { status: 'succeeded' };
  return { status: 'failed', reason: 'Card number is incomplete.' };
}

module.exports = { methods, onlineProvider, createPayment, signSandbox, verifySandbox, sandboxCharge };

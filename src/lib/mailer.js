'use strict';
// Every email is written to the outbox table (visible in Admin > Emails). When
// SMTP_URL is set it is also delivered through nodemailer.
const { q, getSetting } = require('../db');
const config = require('../config');
const { money } = require('./util');

let transport = null;
if (config.smtpUrl) {
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport(config.smtpUrl);
}

async function send(to, subject, body) {
  const r = q.run('INSERT INTO outbox (to_email, subject, body, status) VALUES (?,?,?,?)', to, subject, body, transport ? 'queued' : 'logged');
  if (!transport) return;
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject, text: body });
    q.run(`UPDATE outbox SET status = 'sent' WHERE id = ?`, r.lastInsertRowid);
  } catch (err) {
    q.run(`UPDATE outbox SET status = 'failed' WHERE id = ?`, r.lastInsertRowid);
    console.error('Email failed:', err.message);
  }
}

function orderLink(order) { return `${config.baseUrl}/order/${order.number}?t=${order.access_token}`; }

const PAY_LABEL = { cod: 'Cash on delivery', bank_transfer: 'Bank transfer', card: 'Card or wallet' };

function orderPlaced(order, items) {
  const store = getSetting('store', {});
  const lines = items.map(i => `  ${i.qty} x ${i.name}${i.variant_label ? ` (${i.variant_label})` : ''}  ${money(i.price * i.qty)}`).join('\n');
  let payNote = '';
  if (order.payment_method === 'bank_transfer') {
    payNote = '\nPlease transfer the total to the account shown on your order page and add the transaction reference there. We dispatch once the payment is confirmed.\n';
  } else if (order.payment_method === 'cod') {
    payNote = `\nPlease keep ${money(order.total)} ready in cash for the rider.\n`;
  }
  return send(order.email, `Order ${order.number} received`,
    `Hi ${order.full_name},\n\nThanks for shopping with ${store.name || 'Taar'}. We have received your order ${order.number}.\n\n${lines}\n\n`
    + `Subtotal: ${money(order.subtotal)}\nDiscount: ${money(order.discount)}\nDelivery: ${money(order.shipping)}\nTotal: ${money(order.total)}\n`
    + `Payment: ${PAY_LABEL[order.payment_method] || order.payment_method}\n${payNote}\nTrack your order: ${orderLink(order)}\n\n`
    + `Questions? Reply to this email or call ${store.phone || ''}.`);
}

function statusChanged(order, message) {
  return send(order.email, `Order ${order.number}: ${message}`,
    `Hi ${order.full_name},\n\n${message}\n${order.tracking_number ? `\nCourier: ${order.courier}\nTracking number: ${order.tracking_number}\n` : ''}\nView your order: ${orderLink(order)}`);
}

function passwordReset(user, link) {
  return send(user.email, 'Reset your Taar password',
    `Hi ${user.name},\n\nUse this link to choose a new password. It works once and expires in one hour.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`);
}

module.exports = { send, orderPlaced, statusChanged, passwordReset, PAY_LABEL };

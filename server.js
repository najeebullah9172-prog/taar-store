'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');
const { pruneSessions } = require('./src/lib/session');
const { q } = require('./src/db');

if (q.get('SELECT COUNT(*) AS n FROM users').n === 0) {
  console.log('The database is empty. Run "npm run seed" first to create the admin account and sample catalogue.');
}

if (config.isProd && config.payments.sandbox) {
  console.warn('Warning: the test payment gateway is switched on. Set PAYMENT_SANDBOX=0 before taking real orders.');
}
if (config.isProd && !config.smtpUrl) {
  console.warn('Warning: SMTP_URL is not set, so order emails are only logged in Admin > Messages.');
}

const app = createApp();
pruneSessions();
setInterval(pruneSessions, 6 * 3600 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Taar is running at ${config.baseUrl}`);
  console.log(`Admin dashboard: ${config.baseUrl}/admin`);
});

'use strict';
const path = require('node:path');

// Load a .env file if one exists (Node 22 has this built in).
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env, use defaults */ }

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.APP_SECRET || env.APP_SECRET.length < 32)) {
  throw new Error('APP_SECRET must be set to at least 32 random characters in production.');
}

module.exports = {
  isProd,
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dbPath: path.resolve(env.DB_PATH || path.join(__dirname, '..', 'data', 'taar.db')),
  uploadDir: path.resolve(env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  secret: env.APP_SECRET || 'dev-only-secret-change-me-before-going-live-0000',
  sessionDays: 30,
  trustProxy: env.TRUST_PROXY === '1',
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'Taar <orders@taar.pk>',
  payments: {
    // The built in test gateway lets the full online payment flow run end to end
    // without a merchant account. Turn it off in production.
    sandbox: env.PAYMENT_SANDBOX !== '0',
    safepay: {
      apiKey: env.SAFEPAY_API_KEY || '',
      secret: env.SAFEPAY_SECRET || '',
      webhookSecret: env.SAFEPAY_WEBHOOK_SECRET || '',
      environment: env.SAFEPAY_ENV || 'sandbox',
    },
    jazzcash: {
      merchantId: env.JAZZCASH_MERCHANT_ID || '',
      password: env.JAZZCASH_PASSWORD || '',
      integritySalt: env.JAZZCASH_INTEGRITY_SALT || '',
    },
  },
};

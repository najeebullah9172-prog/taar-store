'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { q, getSetting } = require('./db');
const { loadSession, csrfProtect, readFlash, ownerKey } = require('./lib/session');
const { can } = require('./lib/auth');
const util = require('./lib/util');
const catalog = require('./lib/catalog');
const { formatPhone } = require('./lib/pk');
const { swatch } = require('./lib/colors');

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.set('query parser', 'extended');
  app.disable('x-powered-by');
  if (config.isProd) app.set('view cache', true);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd,
  }));
  app.use(compression());

  const staticOpts = { maxAge: config.isProd ? '7d' : 0, etag: true };
  app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css'), staticOpts));
  app.use('/js', express.static(path.join(__dirname, '..', 'public', 'js'), staticOpts));
  app.use('/fonts', express.static(path.join(__dirname, '..', 'public', 'fonts'), { maxAge: '365d', immutable: true }));
  app.use('/img', express.static(path.join(__dirname, '..', 'public', 'img'), { maxAge: config.isProd ? '30d' : 0 }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.svg'));

  app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 2000 }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(loadSession);
  app.use(readFlash);

  // Shared template data.
  let navCache = { at: 0, data: null };
  app.use((req, res, next) => {
    if (!navCache.data || Date.now() - navCache.at > 30000) {
      navCache = { at: Date.now(), data: catalog.categories() };
    }
    const owner = ownerKey(req);
    const cartCount = owner ? (q.get(`SELECT COALESCE(SUM(ci.qty),0) n FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.owner = ?`, owner)?.n || 0) : 0;
    const wishCount = owner ? q.get('SELECT COUNT(*) n FROM wishlist WHERE owner = ?', owner).n : 0;
    Object.assign(res.locals, {
      ...util,
      formatPhone,
      swatch,
      navCategories: navCache.data,
      store: getSetting('store', {}),
      announcement: getSetting('announcement', ''),
      cartCount, wishCount,
      path: req.path,
      query: req.query,
      baseUrl: config.baseUrl,
      can: (perm) => can(req.user, perm),
      meta: {},
      assetV: process.env.ASSET_VERSION || '7',
    });
    next();
  });

  app.use(csrfProtect);

  app.use(require('./routes/api'));
  app.use(require('./routes/store'));
  app.use(require('./routes/checkout'));
  app.use('/account', require('./routes/account'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/api/')) return res.json({ ok: false, message: 'Not found' });
    res.render('store/error', { title: 'Page not found', status: 404, message: 'We could not find that page. It may have moved, or the link may be wrong.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Something went wrong on our side. Please try again in a moment.' : err.message;
    res.status(status);
    if (req.path.startsWith('/api/') || req.xhr || (req.get('accept') || '').includes('application/json')) {
      return res.json({ ok: false, message });
    }
    res.render('store/error', { title: status === 403 ? 'Not allowed' : 'Error', status, message });
  });

  return app;
}

module.exports = { createApp };

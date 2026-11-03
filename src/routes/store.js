'use strict';
const express = require('express');
const { q } = require('../db');
const catalog = require('../lib/catalog');
const config = require('../config');
const { schemas, check } = require('../lib/validate');
const { flash, ownerKey } = require('../lib/session');
const { normalizePhone, CITY_LIST } = require('../lib/pk');
const limits = require('../lib/limits');
const pages = require('./pages');

const r = express.Router();

const arr = (v) => (v == null ? [] : [].concat(v)).map(String).filter(Boolean).slice(0, 30);

function parseFilters(query, specKeys = []) {
  const specs = {};
  const raw = query.spec && typeof query.spec === 'object' ? query.spec : {};
  for (const k of specKeys) if (raw[k]) specs[k] = arr(raw[k]);
  const toInt = (v) => (v === undefined || v === '' || isNaN(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));
  return {
    brands: arr(query.brand),
    min: toInt(query.min), max: toInt(query.max),
    inStock: query.stock === '1',
    rating: [3, 4].includes(Number(query.rating)) ? Number(query.rating) : null,
    specs,
    sort: catalog.SORT_LABELS[query.sort] ? query.sort : null,
    page: Math.max(1, parseInt(query.page, 10) || 1),
  };
}

function renderListing(req, res, { title, heading, intro, category = null, scope = {}, crumbs = [], canonical, brandPage = false }) {
  const specKeys = category ? category.spec_filters : [];
  const f = parseFilters(req.query, specKeys);
  if (scope.forceBrand) f.brands = [scope.forceBrand];
  const { forceBrand, ...listScope } = scope;
  const result = catalog.listProducts({ ...listScope, ...f, perPage: 24 });
  const facets = catalog.facets({ category: scope.category, q: scope.q }, specKeys);
  void forceBrand;
  const activeCount = f.brands.length + (f.min != null) + (f.max != null) + f.inStock + (f.rating ? 1 : 0)
    + Object.values(f.specs).reduce((s, v) => s + v.length, 0) - (scope.forceBrand ? 1 : 0);
  res.locals.meta = {
    title, description: intro ? String(intro).slice(0, 155) : `Shop ${heading} online in Pakistan with cash on delivery and official warranty.`,
    canonical: `${config.baseUrl}${canonical || req.path}`,
    noindex: activeCount > 0 || f.page > 1 || !!scope.q,
  };
  res.render('store/listing', { title, heading, intro, category, result, facets, filters: f, activeCount, crumbs, scope, brandPage, sortLabels: catalog.SORT_LABELS });
}

// ---------- home ----------
r.get('/', (req, res) => {
  const featured = catalog.listProducts({ featured: true, sort: 'popular', perPage: 8 }).items;
  const newArrivals = catalog.listProducts({ isNew: true, sort: 'newest', perPage: 8 }).items;
  const bestSellers = catalog.listProducts({ sort: 'popular', perPage: 8 }).items;
  const deals = catalog.listProducts({ onSale: true, sort: 'popular', perPage: 8 }).items;
  const hero = ['samsung-galaxy-s25-ultra', 'apple-macbook-air-13-m4', 'sony-wh-1000xm5']
    .map(s => catalog.getProduct(s)).filter(Boolean);
  const heroFallback = hero.length ? hero : featured.slice(0, 3).map(p => catalog.getProduct(p.slug));
  const reviews = q.all(`SELECT r.author, r.city, r.rating, r.title, r.body, r.verified, p.name AS product, p.slug
                         FROM reviews r JOIN products p ON p.id = r.product_id
                         WHERE r.status = 'published' AND r.rating >= 4 AND length(r.body) > 60 AND p.status = 'active'
                         GROUP BY p.category_id ORDER BY r.created_at DESC LIMIT 6`);
  const brandList = catalog.brands().filter(b => b.product_count > 0).sort((a, b) => b.featured - a.featured || b.product_count - a.product_count);
  const stats = q.get(`SELECT COUNT(*) n, ROUND(AVG(rating),1) avg FROM reviews WHERE status = 'published'`);
  res.locals.meta = {
    title: 'Taar | Phones, laptops and electronics in Pakistan',
    description: 'Shop PTA approved phones, laptops, audio, smartwatches and more with official warranty, cash on delivery and 7 day returns across Pakistan.',
    canonical: config.baseUrl + '/',
  };
  res.render('store/home', { featured, newArrivals, bestSellers, deals, hero: heroFallback, reviews, brandList, stats });
});

// ---------- listings ----------
r.get('/shop', (req, res) => renderListing(req, res, { title: 'All products | Taar', heading: 'All products', crumbs: [{ name: 'Shop' }] }));
r.get('/deals', (req, res) => renderListing(req, res, {
  title: 'Deals | Taar', heading: 'Deals', intro: 'Products currently priced below their usual price. Prices update as stock changes.',
  scope: { onSale: true }, crumbs: [{ name: 'Deals' }],
}));
r.get('/new', (req, res) => renderListing(req, res, {
  title: 'New arrivals | Taar', heading: 'New arrivals', intro: 'The latest phones, laptops and gadgets to land in our warehouse.',
  scope: { isNew: true }, crumbs: [{ name: 'New arrivals' }],
}));
r.get('/search', (req, res) => {
  const text = String(req.query.q || '').trim().slice(0, 80);
  if (!text) return res.redirect('/shop');
  renderListing(req, res, { title: `Search: ${text} | Taar`, heading: `Results for "${text}"`, scope: { q: text }, crumbs: [{ name: 'Search' }] });
});
r.get('/c/:slug', (req, res, next) => {
  const category = catalog.category(req.params.slug);
  if (!category) return next();
  renderListing(req, res, {
    title: `${category.name} price in Pakistan | Taar`, heading: category.name, intro: category.description, category,
    scope: { category: category.slug }, crumbs: [{ name: category.name }],
  });
});
r.get('/brand/:slug', (req, res, next) => {
  const brand = q.get('SELECT * FROM brands WHERE slug = ?', req.params.slug);
  if (!brand) return next();
  renderListing(req, res, {
    title: `${brand.name} products in Pakistan | Taar`, heading: brand.name, intro: brand.description || `Official ${brand.name} products with local warranty.`,
    crumbs: [{ name: 'Brands', href: '/brands' }, { name: brand.name }], scope: { forceBrand: brand.slug }, brandPage: true,
  });
});
r.get('/brands', (req, res) => {
  res.locals.meta = { title: 'Brands | Taar', canonical: config.baseUrl + '/brands' };
  res.render('store/brands', { brands: catalog.brands().filter(b => b.product_count) });
});

// ---------- product ----------
r.get('/p/:slug', (req, res, next) => {
  const product = catalog.getProduct(req.params.slug);
  if (!product) return next();
  const reviews = catalog.reviewsFor(product.id);
  const related = catalog.related(product, 4);
  const owner = ownerKey(req);
  const saved = owner ? !!q.get('SELECT 1 FROM wishlist WHERE owner = ? AND product_id = ?', owner, product.id) : false;
  const canReview = req.user ? !q.get('SELECT 1 FROM reviews WHERE product_id = ? AND user_id = ?', product.id, req.user.id) : false;
  const purchased = req.user ? !!q.get(`SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered'`, req.user.id, product.id) : false;
  const desc = product.meta_description || `${product.short_desc} Price in Pakistan: Rs ${product.price.toLocaleString('en-PK')}. Official warranty and cash on delivery.`;
  res.locals.meta = {
    title: product.meta_title || `${product.name} price in Pakistan | Taar`,
    description: desc.slice(0, 160),
    canonical: `${config.baseUrl}/p/${product.slug}`,
    image: product.image ? config.baseUrl + product.image : null,
    type: 'product',
  };
  res.render('store/product', { product, reviews, related, saved, canReview, purchased, productJson: {
    id: product.id, name: product.name, slug: product.slug, option_names: product.option_names,
    variants: product.variants, images: product.images, cities: CITY_LIST,
  } });
});

r.post('/p/:slug/reviews', limits.forms, (req, res, next) => {
  const product = catalog.getProduct(req.params.slug);
  if (!product) return next();
  if (!req.user) return res.redirect(`/account/login?next=${encodeURIComponent('/p/' + product.slug + '#reviews')}`);
  const { data, errors } = check(schemas.review, req.body);
  if (errors) { flash(res, 'error', Object.values(errors)[0]); return res.redirect(`/p/${product.slug}#write-review`); }
  if (q.get('SELECT 1 FROM reviews WHERE product_id = ? AND user_id = ?', product.id, req.user.id)) {
    flash(res, 'error', 'You have already reviewed this product.');
    return res.redirect(`/p/${product.slug}#reviews`);
  }
  const verified = !!q.get(`SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered'`, req.user.id, product.id);
  const addr = q.get('SELECT city FROM addresses WHERE user_id = ? ORDER BY is_default DESC LIMIT 1', req.user.id);
  q.run(`INSERT INTO reviews (product_id, user_id, author, city, rating, title, body, verified, status) VALUES (?,?,?,?,?,?,?,?, 'pending')`,
    product.id, req.user.id, req.user.name, addr?.city || null, data.rating, data.title, data.body, verified ? 1 : 0);
  flash(res, 'success', 'Thanks for your review. It will appear once our team has checked it, usually within a day.');
  res.redirect(`/p/${product.slug}#reviews`);
});

// ---------- compare and wishlist ----------
r.get('/compare', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 4);
  const products = ids.map(id => catalog.getProduct(id)).filter(Boolean);
  const keys = [];
  for (const p of products) for (const k of Object.keys(p.specs)) if (!keys.includes(k)) keys.push(k);
  res.locals.meta = { title: 'Compare products | Taar', noindex: true };
  res.render('store/compare', { products, keys });
});

r.get('/wishlist', (req, res) => {
  const owner = ownerKey(req);
  const ids = owner ? q.all('SELECT product_id FROM wishlist WHERE owner = ? ORDER BY added_at DESC', owner).map(x => x.product_id) : [];
  const list = ids.length ? catalog.listProducts({ ids, perPage: 60 }).items : [];
  const byId = new Map(list.map(p => [p.id, p]));
  res.locals.meta = { title: 'Wishlist | Taar', noindex: true };
  res.render('store/wishlist', { products: ids.map(id => byId.get(id)).filter(Boolean) });
});

// ---------- order tracking ----------
r.get('/track', (req, res) => {
  res.locals.meta = { title: 'Track your order | Taar' };
  res.render('store/track', { errors: {}, values: { number: req.query.number || '' } });
});
r.post('/track', limits.forms, (req, res) => {
  const { data, errors, values } = check(schemas.track, req.body);
  res.locals.meta = { title: 'Track your order | Taar' };
  if (errors) return res.status(400).render('store/track', { errors, values });
  const order = q.get('SELECT number, access_token, email, phone FROM orders WHERE number = ? COLLATE NOCASE', data.number.trim());
  const contact = data.contact.trim().toLowerCase();
  const phone = normalizePhone(contact);
  if (!order || !(order.email.toLowerCase() === contact || (phone && order.phone === phone))) {
    return res.status(404).render('store/track', { values: req.body, errors: { _: 'We could not find an order with those details. Check the order number in your confirmation email.' } });
  }
  res.redirect(`/order/${order.number}?t=${order.access_token}`);
});

// ---------- small forms ----------
r.post('/newsletter', limits.forms, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length < 160;
  if (ok) q.run('INSERT OR IGNORE INTO newsletter (email) VALUES (?)', email);
  if (req.get('accept')?.includes('application/json')) return res.status(ok ? 200 : 400).json({ ok, message: ok ? 'You are on the list. We send one email a week at most.' : 'Enter a valid email address.' });
  flash(res, ok ? 'success' : 'error', ok ? 'You are on the list. We send one email a week at most.' : 'Enter a valid email address.');
  res.redirect(req.get('referer')?.startsWith(config.baseUrl) ? req.get('referer') : '/');
});

r.get('/contact', (req, res) => {
  res.locals.meta = { title: 'Contact us | Taar' };
  res.render('store/contact', { errors: {}, values: {}, sent: false });
});
r.post('/contact', limits.forms, (req, res) => {
  const { data, errors, values } = check(schemas.contact, req.body);
  res.locals.meta = { title: 'Contact us | Taar' };
  if (errors) return res.status(400).render('store/contact', { errors, values, sent: false });
  q.run('INSERT INTO messages (name, email, phone, subject, body) VALUES (?,?,?,?,?)', data.name, data.email, data.phone || null, data.subject, data.body);
  res.render('store/contact', { errors: {}, values: {}, sent: true });
});

// ---------- information pages ----------
r.get('/pages/:slug', (req, res, next) => {
  const page = pages[req.params.slug];
  if (!page) return next();
  res.locals.meta = { title: `${page.title} | Taar`, description: page.summary, canonical: `${config.baseUrl}/pages/${req.params.slug}` };
  res.render('store/page', { page, slug: req.params.slug, pageList: Object.entries(pages).map(([slug, p]) => ({ slug, title: p.title })) });
});

// ---------- SEO ----------
r.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /checkout\nDisallow: /cart\nDisallow: /order/\nDisallow: /api/\nDisallow: /search\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});
r.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/shop', '/deals', '/new', '/brands', '/contact', '/track',
    ...catalog.categories().map(c => `/c/${c.slug}`),
    ...catalog.brands().filter(b => b.product_count).map(b => `/brand/${b.slug}`),
    ...Object.keys(pages).map(s => `/pages/${s}`)];
  const products = q.all(`SELECT slug, updated_at FROM products WHERE status = 'active'`);
  const esc = (s) => s.replace(/&/g, '&amp;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(u => `  <url><loc>${esc(config.baseUrl + u)}</loc></url>`).join('\n') + '\n'
    + products.map(p => `  <url><loc>${esc(`${config.baseUrl}/p/${p.slug}`)}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>`).join('\n')
    + '\n</urlset>\n';
  res.type('application/xml').send(xml);
});

module.exports = r;

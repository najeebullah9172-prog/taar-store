'use strict';
// Creates the database and fills it with a sample catalogue, staff accounts,
// shipping zones, coupons and two months of sample orders for the dashboard.
// Usage: node scripts/seed.js [--reset]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

if (process.argv.includes('--reset')) {
  const cfg = require('../src/config');
  for (const f of [cfg.dbPath, cfg.dbPath + '-wal', cfg.dbPath + '-shm']) fs.rmSync(f, { force: true });
}

const bcrypt = require('bcryptjs');
const { q, tx, reindexProduct, setSetting } = require('../src/db');
const { slugify, token, orderNumber } = require('../src/lib/util');
const { CITIES } = require('../src/lib/pk');
const { render, VIEWS } = require('./renders');
const cat = require('./catalog');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'products');
fs.mkdirSync(IMG_DIR, { recursive: true });

if (q.get('SELECT COUNT(*) AS n FROM products').n > 0) {
  console.log('Database already has products. Run with --reset to start over.');
  process.exit(0);
}

let rnd = 42;
function rand() { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; }
function pick(a) { return a[Math.floor(rand() * a.length)]; }

tx(() => {
  // ---------- settings ----------
  setSetting('store', {
    name: 'Taar', legal_name: 'Taar Electronics (Pvt) Ltd', email: 'help@taar.pk', phone: '+92 42 111 827 000',
    whatsapp: '+92 300 0000000', address: 'Office 4, Main Boulevard, Gulberg III, Lahore',
    hours: 'Monday to Saturday, 10 am to 8 pm',
  });
  setSetting('announcement', 'Free delivery on orders over Rs 25,000 in major cities. Cash on delivery across Pakistan.');
  setSetting('payments', {
    cod: { enabled: true, fee: 0, max_order: 300000 },
    bank_transfer: { enabled: true, accounts: [
      { bank: 'Meezan Bank', title: 'Taar Electronics (Pvt) Ltd', account: 'Replace with your account number', iban: 'Replace with your IBAN' },
    ] },
    card: { enabled: true, provider: 'sandbox' },
  });
  setSetting('policies', { return_days: 7, cancellation_hours: 24 });

  // ---------- staff and demo customer ----------
  const pw = (s) => bcrypt.hashSync(s, 11);
  const users = [
    ['admin@taar.pk', process.env.ADMIN_PASSWORD || 'Admin!2026', 'Sara Qureshi', 'admin'],
    ['manager@taar.pk', 'Manager!2026', 'Imran Butt', 'manager'],
    ['support@taar.pk', 'Support!2026', 'Nadia Hussain', 'support'],
    ['ayesha@example.com', 'Customer!2026', 'Ayesha Khan', 'customer'],
  ];
  for (const [email, pass, name, role] of users) {
    q.run('INSERT INTO users (email, password_hash, name, role, phone) VALUES (?,?,?,?,?)', email, pw(pass), name, role, '+923001234567');
  }
  const customerId = q.get('SELECT id FROM users WHERE email = ?', 'ayesha@example.com').id;
  q.run(`INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, province, postal_code, is_default)
         VALUES (?,?,?,?,?,?,?,?,?,1)`, customerId, 'Home', 'Ayesha Khan', '+923001234567', 'House 12, Street 4, Block C', 'Model Town', 'Lahore', 'Punjab', '54700');

  // ---------- catalogue ----------
  cat.categories.forEach((c, i) => {
    q.run('INSERT INTO categories (slug, name, tagline, description, icon, sort, spec_filters) VALUES (?,?,?,?,?,?,?)',
      c.slug, c.name, c.tagline, c.description, c.icon, i, JSON.stringify(c.filters));
  });
  for (const [name, featured] of cat.brands) {
    q.run('INSERT INTO brands (slug, name, featured) VALUES (?,?,?)', slugify(name), name, featured);
  }
  const catId = (s) => q.get('SELECT id FROM categories WHERE slug = ?', s).id;
  const brandId = (n) => q.get('SELECT id FROM brands WHERE name = ?', n).id;

  cat.products.forEach((p, idx) => {
    const slug = slugify(p.name);
    const optionNames = [];
    if (p.colors.length > 1) optionNames.push('Color');
    const optEntries = Object.entries(p.options).filter(([, vals]) => vals.length > 1);
    optEntries.forEach(([k]) => optionNames.push(k));
    // Single value options become plain specs.
    const specs = { ...p.specs };
    for (const [k, vals] of Object.entries(p.options)) if (vals.length === 1) specs[k] = vals[0][0];
    if (p.colors.length === 1) specs.Color = p.colors[0];

    const desc = `${p.short}\n\n${p.name} comes with ${p.warranty >= 24 ? `${p.warranty / 12} years` : `${p.warranty} months`} of official warranty in Pakistan. `
      + `Every unit is sealed, checked before dispatch and covered by our ${7} day return policy.\n\n`
      + `What stands out: ${p.highlights.slice(0, -1).join(', ')} and ${p.highlights[p.highlights.length - 1]}.`;
    const created = new Date(Date.now() - (p.is_new ? 10 + idx : 60 + idx * 3) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const r = q.run(`INSERT INTO products (slug, name, brand_id, category_id, short_desc, description, highlights, specs, option_names,
        warranty_months, warranty_text, weight_g, featured, is_new, sold_count, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      slug, p.name, brandId(p.brand), catId(p.cat), p.short, desc, JSON.stringify(p.highlights), JSON.stringify(specs),
      JSON.stringify(optionNames), p.warranty, `${p.warranty} month official ${p.brand} warranty`, p.weight,
      p.featured || 0, p.is_new || 0, p.sold || 0, created, created);
    const pid = Number(r.lastInsertRowid);

    // images, one set per colour
    let sort = 0;
    p.colors.forEach((color, ci) => {
      for (const view of VIEWS[p.type]) {
        const file = `${slug}-${slugify(color)}-${view}.svg`;
        fs.writeFileSync(path.join(IMG_DIR, file), render(p.type, color, view, idx + ci));
        q.run('INSERT INTO product_images (product_id, url, alt, option_value, sort) VALUES (?,?,?,?,?)',
          pid, `/img/products/${file}`, `${p.name} in ${color}, ${view} view`, p.colors.length > 1 ? color : null, sort++);
      }
    });

    // variants: colours x each multi value option
    let combos = [{}];
    if (p.colors.length > 1) combos = p.colors.map(c => ({ Color: c }));
    for (const [k, vals] of optEntries) {
      combos = combos.flatMap(cmb => vals.map(([v, add]) => ({ ...cmb, [k]: v, __add: (cmb.__add || 0) + add })));
    }
    combos.forEach((cmb, vi) => {
      const add = cmb.__add || 0; delete cmb.__add;
      const sku = `${slugify(p.brand).slice(0, 3).toUpperCase()}-${String(pid).padStart(3, '0')}-${String(vi + 1).padStart(2, '0')}`;
      const stock = p.stock === 0 ? 0 : Math.max(0, Math.round(p.stock / combos.length + rand() * 4 - 1));
      q.run('INSERT INTO variants (product_id, sku, options, price, compare_price, stock, sort) VALUES (?,?,?,?,?,?,?)',
        pid, sku, JSON.stringify(cmb), p.price + add, p.compare ? p.compare + add : null, stock, vi);
    });

    // reviews
    const pool = cat.reviewPool[p.type] || cat.reviewPool.phone;
    const n = 2 + Math.floor(rand() * Math.min(5, pool.length + 1));
    for (let i = 0; i < n; i++) {
      const [rating, title, body] = pool[i % pool.length];
      const [author, city] = pick(cat.reviewers);
      const when = new Date(Date.now() - Math.floor(rand() * 80 + 1) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      q.run(`INSERT INTO reviews (product_id, author, city, rating, title, body, verified, status, created_at)
             VALUES (?,?,?,?,?,?,?, 'published', ?)`, pid, author, city, rating, title, body, rand() > .25 ? 1 : 0, when);
    }
    const agg = q.get(`SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE product_id = ? AND status='published'`, pid);
    q.run('UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?', Math.round(agg.a * 10) / 10, agg.n, pid);
    reindexProduct(pid);
  });

  // ---------- shipping ----------
  const major = ['Karachi', 'Islamabad', 'Rawalpindi', 'Peshawar', 'Faisalabad', 'Multan', 'Gujranwala', 'Sialkot', 'Hyderabad', 'Quetta'];
  q.run(`INSERT INTO shipping_zones (name, cities, standard_rate, express_rate, per_kg, free_over, eta_min, eta_max, express_eta, sort)
         VALUES ('Lahore', ?, 199, 499, 50, 25000, 1, 2, 0, 0)`, JSON.stringify(['Lahore']));
  q.run(`INSERT INTO shipping_zones (name, cities, standard_rate, express_rate, per_kg, free_over, eta_min, eta_max, express_eta, sort)
         VALUES ('Major cities', ?, 299, 799, 80, 25000, 2, 4, 1, 1)`, JSON.stringify(major));
  q.run(`INSERT INTO shipping_zones (name, cities, standard_rate, express_rate, per_kg, free_over, eta_min, eta_max, express_eta, sort)
         VALUES ('Rest of Pakistan', '[]', 449, NULL, 100, 50000, 3, 6, 2, 2)`);

  // ---------- coupons ----------
  const later = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  q.run(`INSERT INTO coupons (code, description, type, value, min_subtotal, max_discount, per_customer_limit, ends_at)
         VALUES ('WELCOME10', '10% off your first order, up to Rs 5,000', 'percent', 10, 20000, 5000, 1, ?)`, later);
  q.run(`INSERT INTO coupons (code, description, type, value, min_subtotal, usage_limit, ends_at)
         VALUES ('TAAR2000', 'Rs 2,000 off orders over Rs 30,000', 'fixed', 2000, 30000, 500, ?)`, later);
  q.run(`INSERT INTO coupons (code, description, type, value, min_subtotal) VALUES ('FREESHIP', 'Free standard delivery', 'free_shipping', 0, 5000)`);
  q.run(`INSERT INTO coupons (code, description, type, value, ends_at, active) VALUES ('ELEVEN11', 'Expired 11.11 sale code', 'percent', 11, '2025-11-12', 1)`);

  // ---------- sample orders for analytics ----------
  const variants = q.all(`SELECT v.id, v.product_id, v.price, v.sku, v.options, p.name,
      (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort LIMIT 1) AS image
      FROM variants v JOIN products p ON p.id = v.product_id`);
  const names = cat.reviewers.map(r => r[0]);
  const cities = Object.keys(CITIES);
  const statuses = ['delivered', 'delivered', 'delivered', 'delivered', 'shipped', 'processing', 'confirmed', 'pending', 'cancelled'];
  for (let i = 0; i < 140; i++) {
    const daysAgo = Math.floor(Math.pow(rand(), 1.3) * 60);
    const created = new Date(Date.now() - daysAgo * 86400000 - Math.floor(rand() * 86400000));
    const ts = created.toISOString().slice(0, 19).replace('T', ' ');
    const lines = 1 + Math.floor(rand() * 2.2);
    const items = Array.from({ length: lines }, () => ({ v: pick(variants), qty: rand() > .85 ? 2 : 1 }));
    const subtotal = items.reduce((s, it) => s + it.v.price * it.qty, 0);
    const shipping = subtotal >= 25000 ? 0 : 299;
    let status = daysAgo < 2 ? pick(['pending', 'confirmed']) : daysAgo < 5 ? pick(['processing', 'shipped', 'delivered']) : pick(statuses);
    const method = pick(['cod', 'cod', 'cod', 'bank_transfer', 'card']);
    const paid = status === 'delivered' || (method !== 'cod' && status !== 'pending' && status !== 'cancelled');
    const city = pick(cities);
    const name = pick(names);
    const isCustomer = i % 9 === 0;
    const r = q.run(`INSERT INTO orders (number, access_token, user_id, email, phone, full_name, line1, city, province, subtotal, shipping, total,
        shipping_method, shipping_zone, payment_method, payment_status, status, courier, tracking_number, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNumber().slice(0, 8) + String(1000 + i), token(16), isCustomer ? customerId : null,
      isCustomer ? 'ayesha@example.com' : `${slugify(name).replace('-', '.')}${i}@example.com`,
      '+92300' + String(1000000 + Math.floor(rand() * 8999999)), isCustomer ? 'Ayesha Khan' : name,
      `House ${1 + Math.floor(rand() * 200)}, Street ${1 + Math.floor(rand() * 30)}`, city, CITIES[city],
      subtotal, shipping, subtotal + shipping, 'standard', 'Major cities', method,
      paid ? 'paid' : 'unpaid', status, ['shipped', 'delivered'].includes(status) ? pick(['TCS', 'Leopards', 'M&P']) : null,
      ['shipped', 'delivered'].includes(status) ? String(Math.floor(rand() * 9e11) + 1e11) : null, ts, ts);
    const oid = Number(r.lastInsertRowid);
    for (const it of items) {
      q.run('INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label, sku, image, price, qty) VALUES (?,?,?,?,?,?,?,?,?)',
        oid, it.v.product_id, it.v.id, it.v.name, Object.values(JSON.parse(it.v.options)).join(' / '), it.v.sku, it.v.image, it.v.price, it.qty);
    }
    q.run(`INSERT INTO order_events (order_id, kind, message, created_at) VALUES (?, 'placed', 'Order placed', ?)`, oid, ts);
    if (status !== 'pending') q.run(`INSERT INTO order_events (order_id, kind, message, created_at) VALUES (?, 'status', ?, ?)`, oid, `Status changed to ${status}`, ts);
  }
  // Mark the demo customer's reviews as verified purchases where it makes sense.
  q.run(`INSERT INTO newsletter (email) VALUES ('ayesha@example.com')`);
});

console.log('Seed complete.');
console.log('Admin login: admin@taar.pk /', process.env.ADMIN_PASSWORD || 'Admin!2026');
console.log('Customer login: ayesha@example.com / Customer!2026');
void crypto;

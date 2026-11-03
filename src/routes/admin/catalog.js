'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { q, tx, json, reindexProduct } = require('../../db');
const { requirePerm, audit } = require('../../lib/auth');
const { flash } = require('../../lib/session');
const { z, check, optStr, intStr } = require('../../lib/validate');
const { slugify, token } = require('../../lib/util');
const config = require('../../config');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 12 } });

// ---------- products ----------
r.get('/products', requirePerm('catalog'), (req, res) => {
  const where = []; const params = [];
  const text = String(req.query.q || '').trim();
  if (text) { where.push('(p.name LIKE ? OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku LIKE ?))'); params.push(`%${text}%`, `%${text}%`); }
  if (req.query.category) { where.push('p.category_id = ?'); params.push(Number(req.query.category)); }
  if (['active', 'draft', 'archived'].includes(req.query.status)) { where.push('p.status = ?'); params.push(req.query.status); } else where.push(`p.status != 'archived'`);
  if (req.query.stock === 'out') where.push('(SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) = 0');
  if (req.query.stock === 'low') where.push('(SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) BETWEEN 1 AND 5');
  const list = q.all(`SELECT p.*, b.name brand, c.name category,
      (SELECT MIN(price) FROM variants v WHERE v.product_id = p.id AND v.active = 1) price,
      (SELECT MAX(price) FROM variants v WHERE v.product_id = p.id AND v.active = 1) price_max,
      (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) stock,
      (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1) variant_count,
      (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort LIMIT 1) image
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.updated_at DESC`, ...params);
  res.render('admin/products', { list, categories: q.all('SELECT id, name FROM categories ORDER BY sort'), filters: req.query });
});

function formData(product) {
  return {
    categories: q.all('SELECT id, name, spec_filters FROM categories ORDER BY sort').map(c => ({ ...c, spec_filters: json(c.spec_filters, []) })),
    brands: q.all('SELECT id, name FROM brands ORDER BY name'),
    product,
  };
}

function blankProduct() {
  return { id: null, name: '', slug: '', brand_id: '', category_id: '', short_desc: '', description: '', highlights: [], specs: {}, option_names: [],
    warranty_months: 12, warranty_text: '', weight_g: 500, status: 'draft', featured: 0, is_new: 1, meta_title: '', meta_description: '',
    variants: [{ id: null, sku: '', options: {}, price: '', compare_price: '', stock: 0, active: 1 }], images: [] };
}

function loadProduct(id) {
  const p = q.get('SELECT * FROM products WHERE id = ?', id);
  if (!p) return null;
  return {
    ...p, highlights: json(p.highlights, []), specs: json(p.specs, {}), option_names: json(p.option_names, []),
    variants: q.all('SELECT * FROM variants WHERE product_id = ? ORDER BY sort, id', id).map(v => ({ ...v, options: json(v.options, {}) })),
    images: q.all('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id', id),
  };
}

r.get('/products/new', requirePerm('catalog'), (req, res) => res.render('admin/product-edit', { ...formData(blankProduct()), errors: {} }));
r.get('/products/:id', requirePerm('catalog'), (req, res, next) => {
  const p = loadProduct(req.params.id);
  if (!p) return next();
  const sales = q.get(`SELECT COALESCE(SUM(oi.qty),0) units, COALESCE(SUM(oi.qty*oi.price),0) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = ? AND o.status != 'cancelled'`, p.id);
  res.render('admin/product-edit', { ...formData(p), errors: {}, sales });
});

const productSchema = z.object({
  name: z.string().trim().min(3, 'Enter a product name.').max(140),
  slug: z.string().trim().max(90).optional(),
  brand_id: z.coerce.number().int().positive({ error: 'Choose a brand.' }),
  category_id: z.coerce.number().int().positive({ error: 'Choose a category.' }),
  short_desc: z.string().trim().min(10, 'Write a one sentence summary for product cards and search results.').max(240),
  description: z.string().trim().max(10000).optional().default(''),
  highlights: z.string().optional().default(''),
  option_names: z.string().optional().default(''),
  warranty_months: intStr(0, 120),
  warranty_text: optStr(160),
  weight_g: intStr(1, 200000),
  status: z.enum(['active', 'draft', 'archived']),
  featured: z.any().optional().transform(v => (v === 'on' ? 1 : 0)),
  is_new: z.any().optional().transform(v => (v === 'on' ? 1 : 0)),
  meta_title: optStr(70),
  meta_description: optStr(170),
});

function parseVariants(body, optionNames) {
  const rows = Array.isArray(body.variants) ? body.variants : Object.values(body.variants || {});
  const out = []; const errors = [];
  rows.forEach((v, i) => {
    if (!v || (v._remove === '1')) return;
    const options = {};
    for (const n of optionNames) {
      const val = String(v.opt?.[n] ?? '').trim();
      if (!val) errors.push(`Variant ${i + 1}: enter a value for ${n}.`);
      options[n] = val.slice(0, 40);
    }
    const price = parseInt(v.price, 10);
    const compare = v.compare_price === '' || v.compare_price == null ? null : parseInt(v.compare_price, 10);
    const stock = parseInt(v.stock, 10);
    if (!(price >= 0)) errors.push(`Variant ${i + 1}: enter a price in rupees.`);
    if (compare != null && !(compare > price)) errors.push(`Variant ${i + 1}: the compare at price must be higher than the price, or left empty.`);
    if (!(stock >= 0)) errors.push(`Variant ${i + 1}: stock must be zero or more.`);
    out.push({ id: v.id ? Number(v.id) : null, sku: String(v.sku || '').trim().toUpperCase().slice(0, 40), options, price, compare_price: compare, stock: Math.max(0, stock || 0), active: v.active === 'on' || v.active === '1' ? 1 : 0 });
  });
  if (!out.length) errors.push('Add at least one variant with a price.');
  const keys = out.map(v => JSON.stringify(v.options));
  if (new Set(keys).size !== keys.length) errors.push('Two variants have the same options. Each combination must be unique.');
  return { variants: out, errors };
}

function parseSpecs(body) {
  const keys = [].concat(body.spec_key || []); const vals = [].concat(body.spec_val || []);
  const specs = {};
  keys.forEach((k, i) => {
    const key = String(k || '').trim().slice(0, 40); const val = String(vals[i] || '').trim().slice(0, 200);
    if (key && val) specs[key] = val;
  });
  return specs;
}

function saveProduct(req, res, id) {
  const { data, errors } = check(productSchema, req.body);
  const optionNames = String(req.body.option_names || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
  const { variants, errors: vErrors } = parseVariants(req.body, optionNames);
  const specs = parseSpecs(req.body);
  const allErrors = { ...(errors || {}) };
  if (vErrors.length) allErrors.variants = vErrors.join(' ');
  const slug = slugify(req.body.slug || req.body.name || '');
  if (q.get('SELECT 1 FROM products WHERE slug = ? AND id != ?', slug, id || 0)) allErrors.slug = 'Another product already uses this URL. Change the URL handle.';
  for (const v of variants) {
    if (!v.sku) continue;
    const clash = q.get('SELECT p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ? AND v.id != ?', v.sku, v.id || 0);
    if (clash) allErrors.variants = `SKU ${v.sku} is already used by ${clash.name}.`;
  }
  if (Object.keys(allErrors).length) {
    const current = id ? loadProduct(id) : blankProduct();
    const product = { ...current, ...req.body, id, specs, option_names: optionNames, variants, highlights: String(req.body.highlights || '').split('\n'),
      featured: req.body.featured === 'on', is_new: req.body.is_new === 'on' };
    return res.status(400).render('admin/product-edit', { ...formData(product), errors: allErrors });
  }
  const highlights = data.highlights.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
  const pid = tx(() => {
    let pid = id;
    const fields = [data.name, slug, data.brand_id, data.category_id, data.short_desc, data.description, JSON.stringify(highlights), JSON.stringify(specs),
      JSON.stringify(optionNames), data.warranty_months, data.warranty_text, data.weight_g, data.status, data.featured, data.is_new, data.meta_title, data.meta_description];
    if (pid) {
      q.run(`UPDATE products SET name=?, slug=?, brand_id=?, category_id=?, short_desc=?, description=?, highlights=?, specs=?, option_names=?, warranty_months=?,
             warranty_text=?, weight_g=?, status=?, featured=?, is_new=?, meta_title=?, meta_description=?, updated_at = datetime('now') WHERE id = ?`, ...fields, pid);
    } else {
      pid = Number(q.run(`INSERT INTO products (name, slug, brand_id, category_id, short_desc, description, highlights, specs, option_names, warranty_months,
             warranty_text, weight_g, status, featured, is_new, meta_title, meta_description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...fields).lastInsertRowid);
    }
    const keep = [];
    variants.forEach((v, i) => {
      const sku = v.sku || `TR-${String(pid).padStart(4, '0')}-${token(3).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
      if (v.id && q.get('SELECT 1 FROM variants WHERE id = ? AND product_id = ?', v.id, pid)) {
        q.run('UPDATE variants SET sku=?, options=?, price=?, compare_price=?, stock=?, active=?, sort=? WHERE id = ?', sku, JSON.stringify(v.options), v.price, v.compare_price, v.stock, v.active, i, v.id);
        keep.push(v.id);
      } else {
        keep.push(Number(q.run('INSERT INTO variants (product_id, sku, options, price, compare_price, stock, active, sort) VALUES (?,?,?,?,?,?,?,?)', pid, sku, JSON.stringify(v.options), v.price, v.compare_price, v.stock, v.active, i).lastInsertRowid));
      }
    });
    // Removed variants: delete if never ordered, otherwise deactivate to keep order history intact.
    for (const old of q.all('SELECT id FROM variants WHERE product_id = ?', pid)) {
      if (keep.includes(old.id)) continue;
      if (q.get('SELECT 1 FROM order_items WHERE variant_id = ?', old.id)) q.run('UPDATE variants SET active = 0 WHERE id = ?', old.id);
      else q.run('DELETE FROM variants WHERE id = ?', old.id);
    }
    reindexProduct(pid);
    return pid;
  });
  audit(req, id ? 'product.update' : 'product.create', 'product', pid, { name: data.name });
  flash(res, 'success', id ? 'Product saved.' : 'Product created. Add some photos next.');
  res.redirect(`/admin/products/${pid}`);
}

r.post('/products/new', requirePerm('catalog'), (req, res) => saveProduct(req, res, null));
r.post('/products/:id', requirePerm('catalog'), (req, res, next) => {
  if (!q.get('SELECT 1 FROM products WHERE id = ?', req.params.id)) return next();
  saveProduct(req, res, Number(req.params.id));
});

r.post('/products/:id/duplicate', requirePerm('catalog'), (req, res, next) => {
  const p = loadProduct(req.params.id);
  if (!p) return next();
  const newId = tx(() => {
    let slug = `${p.slug}-copy`; let n = 2;
    while (q.get('SELECT 1 FROM products WHERE slug = ?', slug)) slug = `${p.slug}-copy-${n++}`;
    const id = Number(q.run(`INSERT INTO products (name, slug, brand_id, category_id, short_desc, description, highlights, specs, option_names, warranty_months, warranty_text, weight_g, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`, `${p.name} (copy)`, slug, p.brand_id, p.category_id, p.short_desc, p.description, JSON.stringify(p.highlights),
    JSON.stringify(p.specs), JSON.stringify(p.option_names), p.warranty_months, p.warranty_text, p.weight_g).lastInsertRowid);
    p.variants.forEach((v, i) => q.run('INSERT INTO variants (product_id, sku, options, price, compare_price, stock, active, sort) VALUES (?,?,?,?,?,0,?,?)',
      id, `${v.sku}-C${id}`, JSON.stringify(v.options), v.price, v.compare_price, v.active, i));
    p.images.forEach(im => q.run('INSERT INTO product_images (product_id, url, thumb_url, alt, option_value, sort) VALUES (?,?,?,?,?,?)', id, im.url, im.thumb_url, im.alt, im.option_value, im.sort));
    reindexProduct(id);
    return id;
  });
  audit(req, 'product.duplicate', 'product', newId, { from: p.id });
  flash(res, 'success', 'Copy created as a draft with zero stock.');
  res.redirect(`/admin/products/${newId}`);
});

r.post('/products/:id/archive', requirePerm('catalog'), (req, res) => {
  q.run(`UPDATE products SET status = 'archived', updated_at = datetime('now') WHERE id = ?`, req.params.id);
  audit(req, 'product.archive', 'product', req.params.id);
  flash(res, 'success', 'Product archived. It no longer appears in the store, and past orders are unaffected.');
  res.redirect('/admin/products');
});

// ---------- images ----------
const IMG_TYPES = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'svg']);
r.post('/products/:id/images', requirePerm('catalog'), upload.array('images', 12), async (req, res, next) => {
  try {
    const p = q.get('SELECT id, name FROM products WHERE id = ?', req.params.id);
    if (!p) return next();
    const dir = path.join(config.uploadDir, 'products', String(p.id));
    fs.mkdirSync(dir, { recursive: true });
    let added = 0; const failed = [];
    let sort = (q.get('SELECT MAX(sort) m FROM product_images WHERE product_id = ?', p.id).m ?? -1) + 1;
    for (const f of req.files || []) {
      try {
        const metaInfo = await sharp(f.buffer).metadata(); // rejects anything that is not a real image
        if (!IMG_TYPES.has(metaInfo.format)) throw new Error('type');
        const name = token(9);
        await sharp(f.buffer).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, `${name}.webp`));
        await sharp(f.buffer).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(dir, `${name}-480.webp`));
        q.run('INSERT INTO product_images (product_id, url, thumb_url, alt, option_value, sort) VALUES (?,?,?,?,?,?)',
          p.id, `/uploads/products/${p.id}/${name}.webp`, `/uploads/products/${p.id}/${name}-480.webp`, p.name, String(req.body.option_value || '').trim().slice(0, 40) || null, sort++);
        added++;
      } catch { failed.push(f.originalname); }
    }
    q.run(`UPDATE products SET updated_at = datetime('now') WHERE id = ?`, p.id);
    flash(res, failed.length ? 'error' : 'success', `${added} photo${added === 1 ? '' : 's'} added.${failed.length ? ` Could not read: ${failed.join(', ')}. Use JPG, PNG or WebP.` : ''}`);
    res.redirect(`/admin/products/${p.id}#images`);
  } catch (e) { next(e); }
});

r.post('/products/:id/images/:imageId', requirePerm('catalog'), (req, res) => {
  const img = q.get('SELECT * FROM product_images WHERE id = ? AND product_id = ?', req.params.imageId, req.params.id);
  if (img) {
    if (req.body.action === 'delete') {
      q.run('DELETE FROM product_images WHERE id = ?', img.id);
      if (img.url.startsWith('/uploads/') && !q.get('SELECT 1 FROM product_images WHERE url = ?', img.url)) {
        for (const u of [img.url, img.thumb_url].filter(Boolean)) fs.rm(path.join(config.uploadDir, u.replace('/uploads/', '')), { force: true }, () => {});
      }
    } else if (req.body.action === 'first') {
      q.run('UPDATE product_images SET sort = sort + 1 WHERE product_id = ?', img.product_id);
      q.run('UPDATE product_images SET sort = 0 WHERE id = ?', img.id);
    } else if (req.body.action === 'save') {
      q.run('UPDATE product_images SET alt = ?, option_value = ? WHERE id = ?', String(req.body.alt || '').slice(0, 160), String(req.body.option_value || '').trim().slice(0, 40) || null, img.id);
    }
  }
  res.redirect(`/admin/products/${req.params.id}#images`);
});

// ---------- inventory ----------
r.get('/inventory', requirePerm('inventory'), (req, res) => {
  const text = String(req.query.q || '').trim();
  const params = []; let w = `WHERE p.status != 'archived' AND v.active = 1`;
  if (text) { w += ' AND (p.name LIKE ? OR v.sku LIKE ?)'; params.push(`%${text}%`, `%${text}%`); }
  if (req.query.filter === 'low') w += ' AND v.stock <= 5';
  const rows = q.all(`SELECT v.*, p.name, p.id AS product_id, p.status FROM variants v JOIN products p ON p.id = v.product_id ${w} ORDER BY v.stock ASC, p.name`, ...params)
    .map(v => ({ ...v, options: json(v.options, {}) }));
  res.render('admin/inventory', { rows, q: text, filter: req.query.filter || '' });
});
r.post('/inventory', requirePerm('inventory'), (req, res) => {
  const stock = req.body.stock || {}; const price = req.body.price || {};
  let changed = 0;
  tx(() => {
    for (const [id, val] of Object.entries(stock)) {
      const s = parseInt(val, 10); const pr = parseInt(price[id], 10);
      const v = q.get('SELECT stock, price FROM variants WHERE id = ?', id);
      if (!v || !(s >= 0) || !(pr >= 0)) continue;
      if (v.stock !== s || v.price !== pr) {
        q.run('UPDATE variants SET stock = ?, price = ?, compare_price = CASE WHEN compare_price <= ? THEN NULL ELSE compare_price END WHERE id = ?', s, pr, pr, id);
        changed++;
      }
    }
  });
  audit(req, 'inventory.bulk', 'variant', null, { changed });
  flash(res, 'success', changed ? `${changed} variant${changed === 1 ? '' : 's'} updated.` : 'No changes to save.');
  res.redirect('/admin/inventory' + (req.body.back ? `?${new URLSearchParams(req.body.back)}` : ''));
});

// ---------- categories and brands ----------
r.get('/categories', requirePerm('catalog'), (req, res) => {
  const list = q.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) n FROM categories c ORDER BY sort').map(c => ({ ...c, spec_filters: json(c.spec_filters, []) }));
  const edit = req.query.edit ? list.find(c => String(c.id) === req.query.edit) : null;
  res.render('admin/categories', { list, edit, errors: {} });
});
r.post('/categories', requirePerm('catalog'), (req, res) => {
  const id = Number(req.body.id) || null;
  const name = String(req.body.name || '').trim().slice(0, 60);
  const slug = slugify(req.body.slug || name);
  if (name.length < 2) { flash(res, 'error', 'Enter a category name.'); return res.redirect('/admin/categories'); }
  if (q.get('SELECT 1 FROM categories WHERE slug = ? AND id != ?', slug, id || 0)) { flash(res, 'error', 'Another category already uses that URL handle.'); return res.redirect('/admin/categories'); }
  const filters = String(req.body.spec_filters || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
  const vals = [name, slug, String(req.body.tagline || '').slice(0, 120), String(req.body.description || '').slice(0, 600), String(req.body.icon || 'plug').slice(0, 20), parseInt(req.body.sort, 10) || 0, JSON.stringify(filters), req.body.active === 'on' ? 1 : 0];
  if (id) q.run('UPDATE categories SET name=?, slug=?, tagline=?, description=?, icon=?, sort=?, spec_filters=?, active=? WHERE id = ?', ...vals, id);
  else q.run('INSERT INTO categories (name, slug, tagline, description, icon, sort, spec_filters, active) VALUES (?,?,?,?,?,?,?,?)', ...vals);
  audit(req, id ? 'category.update' : 'category.create', 'category', id, { name });
  flash(res, 'success', 'Category saved.');
  res.redirect('/admin/categories');
});
r.post('/categories/:id/delete', requirePerm('catalog'), (req, res) => {
  if (q.get('SELECT 1 FROM products WHERE category_id = ?', req.params.id)) flash(res, 'error', 'Move or archive the products in this category first.');
  else { q.run('DELETE FROM categories WHERE id = ?', req.params.id); audit(req, 'category.delete', 'category', req.params.id); flash(res, 'success', 'Category deleted.'); }
  res.redirect('/admin/categories');
});

r.get('/brands', requirePerm('catalog'), (req, res) => {
  const list = q.all('SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) n FROM brands b ORDER BY name');
  res.render('admin/brands', { list, edit: req.query.edit ? list.find(b => String(b.id) === req.query.edit) : null });
});
r.post('/brands', requirePerm('catalog'), (req, res) => {
  const id = Number(req.body.id) || null;
  const name = String(req.body.name || '').trim().slice(0, 60);
  const slug = slugify(req.body.slug || name);
  if (name.length < 2) { flash(res, 'error', 'Enter a brand name.'); return res.redirect('/admin/brands'); }
  if (q.get('SELECT 1 FROM brands WHERE slug = ? AND id != ?', slug, id || 0)) { flash(res, 'error', 'That brand already exists.'); return res.redirect('/admin/brands'); }
  const vals = [name, slug, String(req.body.description || '').slice(0, 600), req.body.featured === 'on' ? 1 : 0];
  if (id) q.run('UPDATE brands SET name=?, slug=?, description=?, featured=? WHERE id = ?', ...vals, id);
  else q.run('INSERT INTO brands (name, slug, description, featured) VALUES (?,?,?,?)', ...vals);
  if (id) for (const p of q.all('SELECT id FROM products WHERE brand_id = ?', id)) reindexProduct(p.id);
  audit(req, id ? 'brand.update' : 'brand.create', 'brand', id, { name });
  flash(res, 'success', 'Brand saved.');
  res.redirect('/admin/brands');
});
r.post('/brands/:id/delete', requirePerm('catalog'), (req, res) => {
  if (q.get('SELECT 1 FROM products WHERE brand_id = ?', req.params.id)) flash(res, 'error', 'This brand still has products. Reassign them first.');
  else { q.run('DELETE FROM brands WHERE id = ?', req.params.id); audit(req, 'brand.delete', 'brand', req.params.id); flash(res, 'success', 'Brand deleted.'); }
  res.redirect('/admin/brands');
});

// Multer errors (file too large and so on) come back as friendly messages.
r.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    flash(res, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be under 8 MB.' : 'Upload failed. Try fewer or smaller photos.');
    return res.redirect(req.get('referer') || '/admin/products');
  }
  next(err);
});

module.exports = r;

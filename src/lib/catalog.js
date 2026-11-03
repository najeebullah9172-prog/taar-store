'use strict';
const { q, json } = require('../db');

const CARD_SQL = `
  SELECT p.id, p.slug, p.name, p.short_desc, p.rating_avg, p.rating_count, p.sold_count, p.is_new, p.featured,
         p.created_at, p.specs, p.option_names, p.warranty_months, p.status,
         b.name AS brand, b.slug AS brand_slug, c.name AS category, c.slug AS category_slug,
         (SELECT MIN(price) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS price,
         (SELECT MAX(price) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS price_max,
         (SELECT compare_price FROM variants v WHERE v.product_id = p.id AND v.active = 1 ORDER BY price LIMIT 1) AS compare_price,
         (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS stock_total,
         (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.active = 1) AS variant_count,
         (SELECT id FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND v.stock > 0 ORDER BY price LIMIT 1) AS quick_variant,
         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort LIMIT 1) AS image,
         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY sort LIMIT 1 OFFSET 1) AS image2
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id`;

function shapeCard(r) {
  if (!r) return null;
  const colors = q.all(`SELECT DISTINCT json_extract(options, '$.Color') AS c FROM variants
                        WHERE product_id = ? AND active = 1 AND json_extract(options, '$.Color') IS NOT NULL ORDER BY sort`, r.id).map(x => x.c);
  return {
    ...r,
    specs: json(r.specs, {}),
    option_names: json(r.option_names, []),
    in_stock: r.stock_total > 0,
    low_stock: r.stock_total > 0 && r.stock_total <= 5,
    discount_pct: r.compare_price && r.compare_price > r.price ? Math.round((1 - r.price / r.compare_price) * 100) : 0,
    colors,
  };
}

// Turns free text into a safe FTS5 query: each word becomes a quoted prefix term.
function ftsQuery(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.slice(0, 8).map(w => `"${w}"*`).join(' ');
}

function searchIds(text) {
  const fq = ftsQuery(text);
  if (!fq) return [];
  try {
    return q.all('SELECT rowid AS id FROM products_fts WHERE products_fts MATCH ? ORDER BY bm25(products_fts, 10, 5, 3, 1)', fq).map(r => r.id);
  } catch {
    return [];
  }
}

const SORTS = {
  featured: 'p.featured DESC, p.sold_count DESC',
  newest: 'p.created_at DESC',
  price_asc: 'price ASC',
  price_desc: 'price DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC',
  popular: 'p.sold_count DESC',
};
const SORT_LABELS = {
  featured: 'Featured', popular: 'Best selling', newest: 'Newest', price_asc: 'Price, low to high',
  price_desc: 'Price, high to low', rating: 'Top rated',
};

/**
 * filters: { category, brands[], q, min, max, inStock, rating, specs: {key: [values]}, sort, page, perPage, ids, featured, isNew, includeDraft }
 */
function listProducts(f = {}) {
  const where = [];
  const params = [];
  if (!f.includeDraft) where.push(`p.status = 'active'`);
  let searchOrder = null;
  if (f.q) {
    const ids = searchIds(f.q);
    if (!ids.length) return { items: [], total: 0, pages: 0, page: 1 };
    where.push(`p.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
    searchOrder = ids;
  }
  if (f.ids) {
    if (!f.ids.length) return { items: [], total: 0, pages: 0, page: 1 };
    where.push(`p.id IN (${f.ids.map(() => '?').join(',')})`);
    params.push(...f.ids);
  }
  if (f.category) { where.push('c.slug = ?'); params.push(f.category); }
  if (f.brands && f.brands.length) {
    where.push(`b.slug IN (${f.brands.map(() => '?').join(',')})`);
    params.push(...f.brands);
  }
  if (f.featured) where.push('p.featured = 1');
  if (f.isNew) where.push('p.is_new = 1');
  if (f.onSale) where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.compare_price > v.price)`);
  if (f.rating) { where.push('p.rating_avg >= ?'); params.push(Number(f.rating)); }
  if (f.specs) {
    for (const [key, vals] of Object.entries(f.specs)) {
      if (!vals.length) continue;
      const path = `$."${key.replace(/"/g, '')}"`;
      const ph = vals.map(() => '?').join(',');
      where.push(`(json_extract(p.specs, ?) IN (${ph}) OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.active = 1 AND json_extract(v.options, ?) IN (${ph})))`);
      params.push(path, ...vals, path, ...vals);
    }
  }
  const having = [];
  if (f.min != null && f.min !== '') { having.push('price >= ?'); params.push(Number(f.min)); }
  if (f.max != null && f.max !== '') { having.push('price <= ?'); params.push(Number(f.max)); }
  if (f.inStock) having.push('stock_total > 0');

  const inner = `${CARD_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const outerWhere = having.length ? `WHERE ${having.join(' AND ').replace(/\bprice\b/g, 'x.price').replace(/stock_total/g, 'x.stock_total')}` : '';
  const total = q.get(`SELECT COUNT(*) AS n FROM (${inner}) x ${outerWhere}`, ...params).n;

  const perPage = Math.min(Math.max(Number(f.perPage) || 24, 1), 60);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(Number(f.page) || 1, 1), pages);
  let order = SORTS[f.sort] || null;
  if (!order && searchOrder) order = null;
  if (!order && !searchOrder) order = SORTS.featured;
  let rows = q.all(`SELECT x.* FROM (${inner}) x ${outerWhere} ${order ? 'ORDER BY ' + order.replace(/\bp\./g, 'x.') : ''}`
    + (searchOrder && !order ? '' : ` LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`), ...params);
  if (searchOrder && !order) {
    const rank = new Map(searchOrder.map((id, i) => [id, i]));
    rows.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    rows = rows.slice((page - 1) * perPage, page * perPage);
  }
  return { items: rows.map(shapeCard), total, pages, page, perPage };
}

// Facet counts for the sidebar. Computed for the base scope (category or search)
// so options do not vanish while the shopper is choosing.
function facets({ category, q: text }, specKeys = []) {
  const base = listProducts({ category, q: text, perPage: 60, page: 1 });
  let all = base.items;
  if (base.total > 60) {
    all = [];
    for (let p = 1; p <= base.pages; p++) all.push(...listProducts({ category, q: text, perPage: 60, page: p }).items);
  }
  const brands = new Map();
  const specs = Object.fromEntries(specKeys.map(k => [k, new Map()]));
  let min = Infinity; let max = 0;
  for (const p of all) {
    if (p.brand) brands.set(p.brand_slug, { slug: p.brand_slug, name: p.brand, count: (brands.get(p.brand_slug)?.count || 0) + 1 });
    min = Math.min(min, p.price); max = Math.max(max, p.price_max || p.price);
    const variants = q.all('SELECT options FROM variants WHERE product_id = ? AND active = 1', p.id).map(v => json(v.options, {}));
    for (const k of specKeys) {
      const vals = new Set();
      if (p.specs[k]) vals.add(p.specs[k]);
      for (const o of variants) if (o[k]) vals.add(o[k]);
      for (const v of vals) specs[k].set(v, (specs[k].get(v) || 0) + 1);
    }
  }
  const sortVals = (a, b) => {
    const na = parseFloat(a[0]); const nb = parseFloat(b[0]);
    return !isNaN(na) && !isNaN(nb) ? na - nb : a[0].localeCompare(b[0]);
  };
  return {
    brands: [...brands.values()].sort((a, b) => a.name.localeCompare(b.name)),
    price: { min: isFinite(min) ? min : 0, max },
    specs: Object.fromEntries(Object.entries(specs).map(([k, m]) => [k, [...m.entries()].sort(sortVals).map(([value, count]) => ({ value, count }))]).filter(([, v]) => v.length > 1)),
    total: base.total,
  };
}

function getProduct(slugOrId, { includeDraft = false } = {}) {
  const row = q.get(`${CARD_SQL} WHERE ${typeof slugOrId === 'number' ? 'p.id' : 'p.slug'} = ? ${includeDraft ? '' : `AND p.status = 'active'`}`, slugOrId);
  if (!row) return null;
  const full = q.get('SELECT description, highlights, warranty_text, weight_g, meta_title, meta_description, brand_id, category_id FROM products WHERE id = ?', row.id);
  const product = shapeCard(row);
  product.description = full.description || '';
  product.highlights = json(full.highlights, []);
  product.warranty_text = full.warranty_text;
  product.weight_g = full.weight_g;
  product.meta_title = full.meta_title;
  product.meta_description = full.meta_description;
  product.images = q.all('SELECT id, url, thumb_url, alt, option_value FROM product_images WHERE product_id = ? ORDER BY sort', row.id);
  product.variants = q.all('SELECT id, sku, options, price, compare_price, stock FROM variants WHERE product_id = ? AND active = 1 ORDER BY sort', row.id)
    .map(v => ({ ...v, options: json(v.options, {}) }));
  const optionValues = {};
  for (const name of product.option_names) {
    optionValues[name] = [...new Set(product.variants.map(v => v.options[name]).filter(Boolean))];
  }
  product.option_values = optionValues;
  return product;
}

function reviewsFor(productId, { limit = 20, offset = 0 } = {}) {
  const rows = q.all(`SELECT id, author, city, rating, title, body, verified, created_at FROM reviews
                      WHERE product_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT ? OFFSET ?`, productId, limit, offset);
  const dist = [5, 4, 3, 2, 1].map(star => ({
    star, count: q.get(`SELECT COUNT(*) n FROM reviews WHERE product_id = ? AND status='published' AND rating = ?`, productId, star).n,
  }));
  return { rows, dist };
}

function related(product, limit = 4) {
  const rows = q.all(`${CARD_SQL} WHERE p.status = 'active' AND p.id != ? AND (p.category_id = (SELECT category_id FROM products WHERE id = ?))
                      ORDER BY (p.brand_id = (SELECT brand_id FROM products WHERE id = ?)) DESC, p.sold_count DESC LIMIT ?`,
  product.id, product.id, product.id, limit);
  return rows.map(shapeCard);
}

function categories() {
  return q.all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status='active') AS product_count
                FROM categories c WHERE c.active = 1 ORDER BY sort, name`).map(c => ({ ...c, spec_filters: json(c.spec_filters, []) }));
}
function category(slug) {
  const c = q.get('SELECT * FROM categories WHERE slug = ? AND active = 1', slug);
  return c ? { ...c, spec_filters: json(c.spec_filters, []) } : null;
}
function brands() {
  return q.all(`SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id AND p.status='active') AS product_count
                FROM brands b ORDER BY name`);
}

function suggest(text, limit = 6) {
  const res = listProducts({ q: text, perPage: limit });
  const cats = q.all(`SELECT slug, name FROM categories WHERE active = 1 AND name LIKE ? LIMIT 3`, `%${String(text).slice(0, 40)}%`);
  return {
    products: res.items.map(p => ({ name: p.name, slug: p.slug, price: p.price, image: p.image, brand: p.brand, in_stock: p.in_stock })),
    categories: cats,
    total: res.total,
  };
}

module.exports = { listProducts, facets, getProduct, reviewsFor, related, categories, category, brands, suggest, shapeCard, CARD_SQL, SORT_LABELS };

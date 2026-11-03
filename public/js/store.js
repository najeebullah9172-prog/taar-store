/* Taar storefront: shared behaviour. No framework, progressive enhancement:
   every link and form still works if this script fails to load. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const csrf = $('meta[name="csrf-token"]')?.content || '';
  const fmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
  const money = (n) => 'Rs ' + fmt.format(Math.round(n || 0));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function api(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || data.ok === false) throw new Error(data.message || 'Something went wrong. Please try again.');
    return data;
  }

  function toast(message, { error = false, link = null } = {}) {
    const box = $('[data-toasts]');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast' + (error ? ' err' : '');
    t.setAttribute('role', error ? 'alert' : 'status');
    t.innerHTML = `<span>${esc(message)}</span>${link ? `<a href="${esc(link.href)}">${esc(link.label)}</a>` : ''}`;
    box.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  // ---------- drawers ----------
  let lastFocus = null;
  function openDrawer(id) {
    const d = document.getElementById('drawer-' + id);
    if (!d) return false;
    lastFocus = document.activeElement;
    d.classList.add('is-open'); d.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    setTimeout(() => (d.querySelector('[data-close].icon-btn') || d.querySelector('button, a, input'))?.focus(), 50);
    d.dispatchEvent(new CustomEvent('drawer:open'));
    return true;
  }
  function closeDrawer(d) {
    d.classList.remove('is-open'); d.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    d.dispatchEvent(new CustomEvent('drawer:close'));
    lastFocus?.focus?.();
  }
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) {
      const id = opener.dataset.open;
      if (id === 'cart' && (location.pathname === '/cart' || location.pathname === '/checkout')) return;
      if (openDrawer(id)) { e.preventDefault(); if (id === 'cart') loadCart(); }
    }
    const closer = e.target.closest('[data-close]');
    if (closer) closeDrawer(closer.closest('.drawer'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const d = $('.drawer.is-open'); if (d) closeDrawer(d); }
    if (e.key === 'Tab') {
      const d = $('.drawer.is-open .drawer-panel');
      if (!d) return;
      const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea', d).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- cart ----------
  function setCount(sel, n) { $$(sel).forEach(el => { el.textContent = n ? n : ''; el.dataset.n = n; }); }

  function renderCart(cart) {
    setCount('[data-cart-count]', cart.count);
    const body = $('[data-cart-body]'); const foot = $('[data-cart-foot]');
    if (!body) return;
    if (!cart.lines.length) {
      body.innerHTML = `<div class="empty" style="background:none;padding:48px 0"><svg class="i"><use href="#i-bag"/></svg><h2>Your cart is empty</h2><p>Add something you like and it will wait here.</p><a class="btn btn-ink" href="/shop">Start shopping</a></div>`;
      foot.hidden = true; return;
    }
    const meter = cart.freeOver ? (cart.toFree > 0
      ? `<div class="free-meter"><p>Add <strong class="num">${money(cart.toFree)}</strong> more for free delivery.</p><div class="meter"><span style="width:${Math.min(100, Math.round((1 - cart.toFree / cart.freeOver) * 100))}%"></span></div></div>`
      : `<div class="free-meter"><p><strong>You qualify for free standard delivery.</strong></p><div class="meter done"><span style="width:100%"></span></div></div>`) : '';
    body.innerHTML = meter + cart.lines.map(l => `
      <div class="line" data-line="${l.variant_id}">
        <a class="line-img" href="/p/${esc(l.slug)}"><img src="${esc(l.image)}" alt=""></a>
        <div>
          <a class="line-name" href="/p/${esc(l.slug)}">${esc(l.name)}</a>
          ${l.variant_label ? `<div class="line-var">${esc(l.variant_label)}</div>` : ''}
          ${l.problem ? `<div class="line-problem">${esc(l.problem)}</div>` : ''}
          <div class="line-controls">
            <div class="qty qty-sm" data-line-qty="${l.variant_id}">
              <button type="button" data-qty-step="-1" aria-label="Decrease quantity"><svg class="i i-sm"><use href="#i-minus"/></svg></button>
              <input type="number" min="1" max="${Math.max(1, Math.min(l.stock, 99))}" value="${l.qty}" inputmode="numeric" aria-label="Quantity">
              <button type="button" data-qty-step="1" aria-label="Increase quantity" ${l.qty >= l.stock ? 'disabled' : ''}><svg class="i i-sm"><use href="#i-plus"/></svg></button>
            </div>
            <button class="remove-btn" type="button" data-remove="${l.variant_id}">Remove</button>
          </div>
        </div>
        <div class="line-price price">${money(l.line_total)}</div>
      </div>`).join('');
    foot.hidden = false;
    $('[data-cart-subtotal]').textContent = money(cart.subtotal);
    const dr = $('[data-cart-discount-row]');
    if (dr) { dr.hidden = !cart.discount; $('[data-cart-discount]').textContent = '−' + money(cart.discount); }
  }

  async function loadCart() {
    try { renderCart((await api('/api/cart')).cart); } catch (e) { toast(e.message, { error: true }); }
  }

  async function addToCart(variantId, qty = 1, { quiet = false } = {}) {
    const data = await api('/api/cart/items', { method: 'POST', body: { variant_id: variantId, qty } });
    renderCart(data.cart);
    if (!quiet) {
      if (data.message) toast(data.message);
      if (!openDrawer('cart')) toast('Added to cart', { link: { href: '/cart', label: 'View cart' } });
    }
    return data;
  }
  window.Taar = { api, toast, money, esc, addToCart, openDrawer, renderCart };

  const onCartPage = () => !!$('[data-cart-page]');
  async function changeLine(variantId, qty) {
    try {
      const data = qty > 0
        ? await api(`/api/cart/items/${variantId}`, { method: 'PATCH', body: { qty } })
        : await api(`/api/cart/items/${variantId}`, { method: 'DELETE' });
      if (onCartPage()) { location.reload(); return; }
      renderCart(data.cart);
      if (data.message) toast(data.message);
    } catch (e) { toast(e.message, { error: true }); }
  }

  document.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      add.classList.add('is-loading');
      try { await addToCart(Number(add.dataset.add)); } catch (err) { toast(err.message, { error: true }); }
      add.classList.remove('is-loading');
      return;
    }
    const step = e.target.closest('[data-line-qty] [data-qty-step]');
    if (step) {
      const box = step.closest('[data-line-qty]'); const input = $('input', box);
      const next = Math.max(0, Number(input.value) + Number(step.dataset.qtyStep));
      input.value = next || 1;
      changeLine(box.dataset.lineQty, next);
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { changeLine(rm.dataset.remove, 0); return; }
  });
  document.addEventListener('change', (e) => {
    const input = e.target.closest('[data-line-qty] input');
    if (input) changeLine(input.closest('[data-line-qty]').dataset.lineQty, Math.max(0, parseInt(input.value, 10) || 0));
  });

  // cart page: coupon and delivery estimate
  $('[data-coupon-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    if (!code) return;
    try { await api('/api/cart/coupon', { method: 'POST', body: { code } }); location.reload(); } catch (err) { toast(err.message, { error: true }); }
  });
  $('[data-coupon-remove]')?.addEventListener('click', async () => { await api('/api/cart/coupon', { method: 'DELETE' }); location.reload(); });
  $('[data-ship-city]')?.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try { await api('/api/cart/city', { method: 'POST', body: { city: e.target.value } }); location.reload(); } catch (err) { toast(err.message, { error: true }); }
  });

  // ---------- wishlist ----------
  async function syncWishButtons() {
    const btns = $$('[data-wish]');
    if (!btns.length) return;
    try {
      const { ids } = await api('/api/wishlist');
      const set = new Set(ids.map(String));
      btns.forEach(b => b.setAttribute('aria-pressed', set.has(b.dataset.wish) ? 'true' : 'false'));
    } catch { /* ignore */ }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wish]');
    if (!b) return;
    e.preventDefault();
    try {
      const data = await api('/api/wishlist/toggle', { method: 'POST', body: { product_id: Number(b.dataset.wish) } });
      $$(`[data-wish="${b.dataset.wish}"]`).forEach(x => x.setAttribute('aria-pressed', String(data.saved)));
      setCount('[data-wish-count]', data.count);
      toast(data.saved ? 'Saved to your wishlist' : 'Removed from your wishlist', data.saved ? { link: { href: '/wishlist', label: 'View' } } : {});
    } catch (err) { toast(err.message, { error: true }); }
  });
  syncWishButtons();

  // ---------- compare (stored in this browser) ----------
  const CMP = 'taar.compare';
  const readCmp = () => { try { return JSON.parse(localStorage.getItem(CMP) || '[]').filter(Number.isInteger); } catch { return []; } };
  const writeCmp = (ids) => { try { localStorage.setItem(CMP, JSON.stringify(ids.slice(-4))); } catch { /* storage blocked */ } renderCompareBar(); };
  function renderCompareBar() {
    let bar = $('.compare-bar');
    const ids = readCmp();
    $$('[data-compare-toggle]').forEach(b => b.setAttribute('aria-pressed', String(ids.includes(Number(b.dataset.compareToggle)))));
    if (location.pathname === '/compare' || ids.length === 0) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'compare-bar no-print'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>${ids.length} to compare</span><button type="button" data-compare-clear>Clear</button><a class="btn btn-primary btn-sm" href="/compare?ids=${ids.join(',')}">Compare now</a>`;
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-compare-toggle]');
    if (t) {
      const id = Number(t.dataset.compareToggle); let ids = readCmp();
      if (ids.includes(id)) ids = ids.filter(x => x !== id);
      else { if (ids.length >= 4) toast('You can compare up to four products. The oldest one was removed.'); ids.push(id); }
      writeCmp(ids);
    }
    if (e.target.closest('[data-compare-clear]')) writeCmp([]);
    const r = e.target.closest('[data-compare-remove]');
    if (r) { const ids = readCmp().filter(x => x !== Number(r.dataset.compareRemove)); writeCmp(ids); location.href = '/compare?ids=' + ids.join(','); }
  });
  if (location.pathname === '/compare') {
    const ids = new URLSearchParams(location.search).get('ids');
    if (!ids && readCmp().length) location.replace('/compare?ids=' + readCmp().join(','));
    else if (ids) writeCmp(ids.split(',').map(Number).filter(Number.isInteger));
  }
  renderCompareBar();

  // ---------- recently viewed ----------
  const RV = 'taar.recent';
  const readRecent = () => { try { return JSON.parse(localStorage.getItem(RV) || '[]').filter(Number.isInteger); } catch { return []; } };
  window.Taar.remember = (id) => { try { localStorage.setItem(RV, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, 12))); } catch { /* ignore */ } };
  const recentBox = $('[data-recent]');
  if (recentBox) {
    const exclude = Number(recentBox.dataset.exclude || 0);
    const ids = readRecent().filter(x => x !== exclude).slice(0, 8);
    if (ids.length) {
      api('/api/products?ids=' + ids.join(',')).then(({ products }) => {
        if (!products.length) return;
        recentBox.innerHTML = products.map(p => `
          <article class="pcard"><a class="pcard-media" href="/p/${esc(p.slug)}" tabindex="-1" aria-hidden="true"><img class="main" src="${esc(p.image)}" alt="" loading="lazy"></a>
          <div class="pcard-body"><div class="pcard-brand">${esc(p.brand)}</div><h3 class="pcard-name"><a href="/p/${esc(p.slug)}">${esc(p.name)}</a></h3>
          <div class="pcard-foot"><div class="pcard-price price"><span class="now">${money(p.price)}</span></div></div></div></article>`).join('');
        recentBox.closest('[data-recent-section]')?.classList.remove('hide');
      }).catch(() => {});
    }
  }

  // ---------- search suggestions ----------
  const form = $('[data-search]');
  if (form) {
    const input = $('input[name=q]', form); const box = $('#suggest', form);
    let timer = null; let active = -1; let lastQ = '';
    const close = () => { box.classList.add('hide'); input.setAttribute('aria-expanded', 'false'); active = -1; };
    const items = () => $$('.suggest-item', box);
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const qv = input.value.trim();
      if (qv.length < 2) { close(); return; }
      timer = setTimeout(async () => {
        lastQ = qv;
        try {
          const data = await api('/api/search/suggest?q=' + encodeURIComponent(qv));
          if (qv !== lastQ) return;
          if (!data.products.length) {
            box.innerHTML = `<div class="suggest-empty">No products match "${esc(qv)}". Try a brand or a product type, like "Samsung" or "earbuds".</div>`;
          } else {
            box.innerHTML = (data.categories.length ? `<div class="suggest-cats">${data.categories.map(c => `<a class="pill" href="/c/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}</div>` : '')
              + data.products.map((p, i) => `<a class="suggest-item" role="option" id="sg-${i}" aria-selected="false" href="/p/${esc(p.slug)}">
                  <img src="${esc(p.image)}" alt=""><span><span class="nm">${esc(p.name)}</span><br><span class="br">${esc(p.brand)}${p.in_stock ? '' : ', out of stock'}</span></span><span class="price num">${money(p.price)}</span></a>`).join('')
              + `<a class="suggest-foot" href="/search?q=${encodeURIComponent(qv)}">See all ${data.total} result${data.total === 1 ? '' : 's'}</a>`;
          }
          box.classList.remove('hide'); input.setAttribute('aria-expanded', 'true'); active = -1;
        } catch { close(); }
      }, 160);
    });
    input.addEventListener('keydown', (e) => {
      const list = items();
      if (box.classList.contains('hide') || !list.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list.forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
        input.setAttribute('aria-activedescendant', list[active].id);
      } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.href = list[active].href; }
      else if (e.key === 'Escape') close();
    });
    document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  }

  // ---------- listing filters ----------
  const filters = $('[data-filters]');
  if (filters) {
    filters.addEventListener('change', (e) => {
      if (e.target.matches('input[type=checkbox], input[type=radio]') && !filters.closest('[data-filters-drawer]')) filters.requestSubmit();
    });
    // Drop empty fields so URLs stay clean.
    filters.addEventListener('submit', () => { $$('input', filters).forEach(i => { if ((i.type === 'number' || i.type === 'radio') && !i.value) i.disabled = true; }); });
    const home = $('[data-filters-home]'); const drawerBody = $('[data-filters-drawer]');
    const drawer = $('#drawer-filters');
    drawer?.addEventListener('drawer:open', () => drawerBody.appendChild(filters));
    drawer?.addEventListener('drawer:close', () => home.appendChild(filters));
  }
  $('[data-sort] select')?.addEventListener('change', (e) => e.target.form.requestSubmit());

  // ---------- horizontal scrollers ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scroll]');
    if (!b) return;
    const sc = b.closest('.section, .deal-band')?.querySelector('[data-scroller]');
    sc?.scrollBy({ left: Number(b.dataset.scroll) * sc.clientWidth * 0.9, behavior: 'smooth' });
  });

  // ---------- hero stage tabs ----------
  const stage = $('[data-stage]');
  if (stage) {
    const tabs = $$('[role=tab]', stage);
    const select = (i) => {
      tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; });
      $$('.stage-slide', stage).forEach((s, j) => s.classList.toggle('is-active', i === j));
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          select(n); tabs[n].focus();
        }
      });
    });
  }

  // ---------- small things ----------
  $$('[data-newsletter]').forEach(f => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch(f.action, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(f)) });
    const data = await res.json().catch(() => ({}));
    toast(data.message || 'Something went wrong.', { error: !res.ok });
    if (res.ok) f.reset();
  }));
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-confirm]');
    if (f && !window.confirm(f.dataset.confirm)) e.preventDefault();
  });
  $('[data-print]')?.addEventListener('click', () => window.print());
})();

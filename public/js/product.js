/* Product page: variant picking, gallery with zoom and lightbox, buy actions. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const T = window.Taar;
  const data = JSON.parse($('#product-data').textContent);
  const form = $('[data-buy-form]');
  const optionNames = data.option_names;
  const sel = {};
  const initial = data.variants.find(v => String(v.id) === $('[data-variant-input]').value) || data.variants[0];
  Object.assign(sel, initial.options);
  T.remember(data.id);

  // ---------- variants ----------
  const findVariant = (opts) => data.variants.find(v => optionNames.every(n => v.options[n] === opts[n]));
  function current() { return findVariant(sel); }

  function refresh() {
    let v = current();
    if (!v) {
      // Keep the choice the shopper just made and pick the first valid match for the rest.
      v = data.variants.find(x => optionNames.every(n => !sel.__last || n !== sel.__last || x.options[n] === sel[n])) || data.variants[0];
      Object.assign(sel, v.options);
    }
    $('[data-variant-input]').value = v.id;
    $('[data-price]').textContent = T.money(v.price);
    $('[data-sticky-price]').textContent = T.money(v.price);
    const cmp = $('[data-compare]'); const save = $('[data-save]');
    const onSale = v.compare_price && v.compare_price > v.price;
    cmp.hidden = !onSale; save.hidden = !onSale;
    if (onSale) { cmp.textContent = T.money(v.compare_price); save.textContent = 'Save ' + T.money(v.compare_price - v.price); }
    const sku = $('[data-sku]'); if (sku) sku.textContent = v.sku;

    for (const n of optionNames) {
      const cur = $(`[data-opt-current="${CSS.escape(n)}"]`); if (cur) cur.textContent = sel[n];
      $$(`[data-opt="${CSS.escape(n)}"]`).forEach(b => {
        b.setAttribute('aria-checked', String(b.dataset.val === sel[n]));
        const probe = { ...sel, [n]: b.dataset.val };
        const match = findVariant(probe);
        b.classList.toggle('is-out', !match || match.stock <= 0);
      });
    }
    const line = $('[data-stock-line]');
    const qty = $('#qty');
    if (v.stock <= 0) {
      line.innerHTML = '<span class="out-stock row" style="gap:8px"><span class="dot"></span>Out of stock in this option</span>';
    } else if (v.stock <= 5) {
      line.innerHTML = `<span class="low-stock row" style="gap:8px"><span class="dot"></span>Only ${v.stock} left, order soon</span>`;
    } else {
      line.innerHTML = '<span class="in-stock row" style="gap:8px"><span class="dot"></span>In stock, ships from Lahore</span>';
    }
    qty.max = Math.max(1, Math.min(v.stock, 10));
    if (Number(qty.value) > Number(qty.max)) qty.value = qty.max;
    const disabled = v.stock <= 0;
    $('[data-add-btn]').disabled = disabled; $('[data-buy-now]').disabled = disabled; $('[data-sticky-add]').disabled = disabled;
    $('[data-add-btn]').textContent = disabled ? 'Out of stock' : 'Add to cart';
    if (sel.Color !== undefined && sel.Color !== shownColor) setImages(sel.Color);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    sel[b.dataset.opt] = b.dataset.val;
    sel.__last = b.dataset.opt;
    refresh();
    delete sel.__last;
  });
  // Arrow keys move within a radio group.
  $$('[role=radiogroup]').forEach(g => g.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const btns = $$('[role=radio]', g); const i = btns.indexOf(document.activeElement);
    const n = btns[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
    e.preventDefault(); n.focus(); n.click();
  }));

  // ---------- quantity ----------
  $('[data-qty]').addEventListener('click', (e) => {
    const s = e.target.closest('[data-qty-step]');
    if (!s) return;
    const q = $('#qty');
    q.value = Math.min(Number(q.max) || 10, Math.max(1, Number(q.value) + Number(s.dataset.qtyStep)));
  });

  // ---------- buying ----------
  async function add({ quiet = false } = {}) {
    const btn = $('[data-add-btn]');
    btn.classList.add('is-loading');
    try { await T.addToCart(Number($('[data-variant-input]').value), Math.max(1, Number($('#qty').value) || 1), { quiet }); return true; }
    catch (e) { T.toast(e.message, { error: true }); return false; }
    finally { btn.classList.remove('is-loading'); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); add(); });
  $('[data-buy-now]').addEventListener('click', async () => { if (await add({ quiet: true })) location.href = '/checkout'; });
  $('[data-sticky-add]').addEventListener('click', () => add());

  const sticky = $('[data-sticky-buy]');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      const show = !en.isIntersecting && en.boundingClientRect.top < 0;
      sticky.classList.toggle('is-shown', show); sticky.setAttribute('aria-hidden', String(!show));
    }).observe($('[data-add-btn]'));
  }

  // ---------- gallery ----------
  const main = $('[data-main]'); const mainImg = $('[data-main-img]'); const thumbs = $('[data-thumbs]');
  let imgs = []; let idx = 0; let shownColor;
  function setImages(color) {
    shownColor = color;
    const list = data.images.filter(i => !i.option_value || i.option_value === color);
    imgs = list.length ? list : data.images;
    thumbs.innerHTML = imgs.map((im, i) => `<button type="button" data-thumb="${i}" aria-current="${i === 0}" aria-label="Show photo ${i + 1}"><img src="${T.esc(im.thumb_url || im.url)}" alt=""></button>`).join('');
    show(0);
  }
  function show(i) {
    idx = (i + imgs.length) % imgs.length;
    mainImg.src = imgs[idx].url; mainImg.alt = imgs[idx].alt || data.name;
    $$('[data-thumb]', thumbs).forEach((b, j) => b.setAttribute('aria-current', String(j === idx)));
    if (lb.classList.contains('is-open')) $('[data-lb-img]').src = imgs[idx].url;
  }
  thumbs.addEventListener('click', (e) => { const b = e.target.closest('[data-thumb]'); if (b) show(Number(b.dataset.thumb)); });
  $$('[data-step]', main).forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); show(idx + Number(b.dataset.step)); }));

  // hover zoom follows the pointer on devices with a mouse
  if (matchMedia('(hover: hover)').matches) {
    main.addEventListener('mousemove', (e) => {
      const r = main.getBoundingClientRect();
      mainImg.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
      main.classList.add('zooming');
    });
    main.addEventListener('mouseleave', () => main.classList.remove('zooming'));
  }
  // swipe on touch screens
  let x0 = null;
  main.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
  });

  // lightbox
  const lb = $('[data-lightbox]');
  const openLb = () => { $('[data-lb-img]').src = imgs[idx].url; lb.classList.add('is-open'); document.body.classList.add('no-scroll'); $('[data-lb-close]').focus(); };
  const closeLb = () => { lb.classList.remove('is-open'); document.body.classList.remove('no-scroll'); main.focus(); };
  main.addEventListener('click', (e) => { if (!e.target.closest('[data-step]')) openLb(); });
  main.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(); } if (e.key === 'ArrowRight') show(idx + 1); if (e.key === 'ArrowLeft') show(idx - 1); });
  $('[data-lb-close]').addEventListener('click', closeLb);
  $$('[data-lb-step]').forEach(b => b.addEventListener('click', () => show(idx + Number(b.dataset.lbStep))));
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
  });

  // ---------- delivery estimate ----------
  const citySel = $('[data-city-select]');
  async function estimate(city) {
    if (!city) return;
    const v = current() || initial;
    const qty = Math.max(1, Number($('#qty').value) || 1);
    try {
      const r = await T.api(`/api/shipping?city=${encodeURIComponent(city)}&subtotal=${v.price * qty}`);
      const std = r.methods[0];
      const fast = r.methods[1];
      $('[data-eta]').textContent = `Delivery to ${city}: ${std.fee ? T.money(std.fee) : 'free'}, ${std.eta}`;
      $('[data-eta-detail]').textContent = fast ? `${fast.label} available for ${T.money(fast.fee)}. ` : (r.cod ? 'Cash on delivery available. ' : '');
      $('[data-city-pick]').textContent = 'Change';
      try { localStorage.setItem('taar.city', city); } catch { /* ignore */ }
    } catch (e) { T.toast(e.message, { error: true }); }
  }
  $('[data-city-pick]').addEventListener('click', async () => {
    const box = $('[data-city-form]');
    if (citySel.options.length <= 1) citySel.insertAdjacentHTML('beforeend', data.cities.map(c => `<option>${T.esc(c)}</option>`).join(''));
    box.classList.toggle('hide');
    citySel.focus();
  });
  citySel.addEventListener('change', () => { estimate(citySel.value); $('[data-city-form]').classList.add('hide'); });
  try { const saved = localStorage.getItem('taar.city'); if (saved) estimate(saved); } catch { /* ignore */ }

  setImages(initial.options.Color);
  refresh();
})();

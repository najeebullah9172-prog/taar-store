/* Checkout and address forms: city fills the province, totals update live. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const T = window.Taar;
  const form = $('[data-checkout]');
  if (!form) return;
  const city = $('[data-city]', form); const province = $('[data-province-select]', form);

  city?.addEventListener('change', () => {
    const p = city.selectedOptions[0]?.dataset.province;
    if (p && province) province.value = p;
    refresh();
  });

  // Saved address cards fill the fields.
  $$('[data-address]', form).forEach(btn => btn.addEventListener('click', () => {
    const a = JSON.parse(btn.dataset.address);
    for (const [k, v] of Object.entries(a)) { const el = form.elements[k]; if (el) el.value = v; }
    $$('[data-address]', form).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    refresh();
  }));

  $('[data-create-account]', form)?.addEventListener('change', (e) => {
    $('[data-account-password]').classList.toggle('hide', !e.target.checked);
  });

  const shipBox = $('[data-ship-options]', form);
  if (!shipBox) return; // address book page only needs the city helper

  form.addEventListener('change', (e) => {
    if (e.target.name === 'shipping_method' || e.target.name === 'payment_method') refresh();
  });

  let seq = 0;
  async function refresh() {
    const n = ++seq;
    const params = new URLSearchParams({
      city: city.value || '', shipping_method: form.querySelector('[name=shipping_method]:checked')?.value || 'standard',
      payment_method: form.querySelector('[name=payment_method]:checked')?.value || '',
    });
    try {
      const s = await T.api('/api/checkout/summary?' + params);
      if (n !== seq) return;
      if (!s.options.length) {
        shipBox.innerHTML = '<p class="muted small" style="margin:0">Choose your city above to see delivery options.</p>';
      } else {
        shipBox.innerHTML = s.options.map(m => `<label class="choice-opt"><input type="radio" name="shipping_method" value="${m.id}" ${m.id === s.method ? 'checked' : ''}>
          <div><div class="t">${T.esc(m.label)}</div><div class="d">${T.esc(m.eta)}</div></div><span class="r num">${m.fee ? T.money(m.fee) : 'Free'}</span></label>`).join('');
      }
      // COD availability depends on city and order size.
      for (const pm of s.payMethods) {
        const opt = $(`[data-pay="${pm.id}"]`, form); if (!opt) continue;
        const input = $('input', opt); const blocked = pm.id === 'cod' && (!s.cod || pm.disabled);
        input.disabled = !!blocked; opt.classList.toggle('is-disabled', !!blocked);
        $('[data-pay-note]', opt).textContent = pm.id === 'cod' && !s.cod ? 'Not available in this city' : (pm.disabled || pm.note);
        if (blocked && input.checked) input.checked = false;
      }
      const set = (k, v) => { const el = $(`[data-t="${k}"]`, form); if (el) el.textContent = v; };
      set('subtotal', T.money(s.subtotal));
      set('discount', '−' + T.money(s.discount)); $('[data-row="discount"]', form).hidden = !s.discount;
      set('shipping', s.method ? (s.shipping ? T.money(s.shipping) : 'Free') : 'Choose city');
      set('fee', T.money(s.paymentFee)); $('[data-row="fee"]', form).hidden = !s.paymentFee;
      set('total', T.money(s.total));
    } catch (e) { T.toast(e.message, { error: true }); }
  }

  // Simple client side checks so obvious mistakes are caught before the round trip.
  form.addEventListener('submit', (e) => {
    const missing = $$('[required]', form).filter(el => (el.type === 'checkbox' ? !el.checked : !String(el.value).trim()) && !el.disabled && el.offsetParent !== null);
    if (!form.querySelector('[name=payment_method]:checked')) missing.push($('[name=payment_method]', form));
    if (!form.querySelector('[name=shipping_method]:checked')) missing.push(city);
    if (missing.length) {
      e.preventDefault();
      missing[0]?.focus();
      missing.forEach(el => el?.closest('.field, .check')?.classList.add('has-error'));
      T.toast('Please fill in the highlighted fields.', { error: true });
      return;
    }
    const btn = $('[data-place-order]', form);
    btn.classList.add('is-loading'); btn.textContent = 'Placing your order';
  });
  $('[data-error-summary]')?.focus();
  if (city.value && !form.querySelector('[name=shipping_method]')) refresh();
})();

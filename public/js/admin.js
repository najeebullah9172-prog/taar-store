/* Admin dashboard behaviour: menu, chart tooltips, confirmations, product editor. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  $('[data-adm-menu]')?.addEventListener('click', () => $('[data-adm-side]').classList.toggle('is-open'));

  // Confirmations
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-confirm]');
    if (f && !confirm(f.dataset.confirm)) e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm-click]');
    if (b && !confirm(b.dataset.confirmClick)) e.preventDefault();
  });

  // Chart tooltips
  const chart = $('[data-chart]');
  if (chart) {
    const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; document.body.appendChild(tip);
    chart.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tip.hidden = true; return; }
      tip.textContent = t.dataset.tip; tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 38) + 'px';
    });
    chart.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  // ---------- product editor ----------
  const form = $('[data-product-form]');
  if (!form) return;

  const slug = $('[data-slug]'); const name = $('[data-name]'); const prev = $('[data-slug-preview]');
  const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/["']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  let slugTouched = !!slug.value;
  slug.addEventListener('input', () => { slugTouched = true; prev.textContent = slugify(slug.value); });
  name.addEventListener('input', () => { if (!slugTouched) prev.textContent = slugify(name.value); });

  $('[data-add-spec]').addEventListener('click', () => {
    $('[data-spec-rows]').insertAdjacentHTML('beforeend', `<div class="spec-row"><input class="input" name="spec_key" placeholder="Name"><input class="input" name="spec_val" placeholder="Value"><button class="icon-btn" type="button" data-remove-row aria-label="Remove row"><svg class="i i-sm"><use href="#i-trash"/></svg></button></div>`);
    $('[data-spec-rows]').lastElementChild.querySelector('input').focus();
  });
  form.addEventListener('click', (e) => {
    const r = e.target.closest('[data-remove-row]'); if (r) r.closest('.spec-row').remove();
    const v = e.target.closest('[data-remove-variant]');
    if (v) {
      if ($$('[data-var-row]').length === 1) { alert('A product needs at least one variant.'); return; }
      v.closest('[data-var-row]').remove(); reindex();
    }
  });

  const optInput = $('[data-option-names]');
  const names = () => optInput.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);

  function rowHtml(i, opts, v = {}) {
    return `<tr data-var-row>${opts.map(n => `<td><input class="input" data-opt-name="${esc(n)}" name="variants[${i}][opt][${esc(n)}]" value="${esc(v.opt?.[n] || '')}" required></td>`).join('')}
      <td><input type="hidden" name="variants[${i}][id]" value="${esc(v.id || '')}"><input class="input" name="variants[${i}][sku]" value="${esc(v.sku || '')}" placeholder="Auto"></td>
      <td><input class="input" name="variants[${i}][price]" type="number" min="0" required value="${esc(v.price ?? '')}"></td>
      <td><input class="input" name="variants[${i}][compare_price]" type="number" min="0" value="${esc(v.compare_price ?? '')}" placeholder="Optional"></td>
      <td><input class="input" name="variants[${i}][stock]" type="number" min="0" required value="${esc(v.stock ?? 0)}" style="min-width:70px"></td>
      <td><label class="check"><input type="checkbox" name="variants[${i}][active]" ${v.active === false ? '' : 'checked'}><span class="sr">Available</span></label></td>
      <td><button class="icon-btn" type="button" data-remove-variant aria-label="Remove variant"><svg class="i i-sm"><use href="#i-trash"/></svg></button></td></tr>`;
  }
  function readRows() {
    return $$('[data-var-row]').map(tr => {
      const get = (k) => tr.querySelector(`[name$="[${k}]"]`);
      const opt = {};
      $$('input[name*="[opt]"]', tr).forEach(inp => { const m = inp.name.match(/\[opt\]\[(.+)\]$/); if (m) opt[m[1]] = inp.value; });
      return { id: get('id').value, sku: get('sku').value, price: get('price').value, compare_price: get('compare_price').value, stock: get('stock').value, active: get('active').checked, opt };
    });
  }
  function rebuild() {
    const opts = names(); const rows = readRows();
    $('[data-var-head]').innerHTML = opts.map(n => `<th>${esc(n)}</th>`).join('') + '<th>SKU</th><th>Price (Rs)</th><th>Compare at</th><th>Stock</th><th>On sale</th><th></th>';
    $('[data-var-rows]').innerHTML = rows.map((v, i) => rowHtml(i, opts, v)).join('');
  }
  function reindex() { rebuild(); }
  optInput.addEventListener('change', rebuild);
  $('[data-add-variant]').addEventListener('click', () => {
    const rows = readRows(); const last = rows[rows.length - 1] || {};
    rows.push({ price: last.price, compare_price: last.compare_price, stock: 0, opt: { ...last.opt } });
    const opts = names();
    $('[data-var-rows]').innerHTML = rows.map((v, i) => rowHtml(i, opts, v)).join('');
    const lastRow = $$('[data-var-row]').pop(); (lastRow.querySelector('input:not([type=hidden])'))?.focus();
  });
})();

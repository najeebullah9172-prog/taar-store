"""Browser test of the full customer and admin journey.

Usage: start the server on a freshly seeded database, then
    python3 tests/e2e.py http://localhost:3000 [screenshot_dir]
Needs: pip install playwright && playwright install chromium
"""
import asyncio, os, re, sys
from playwright.async_api import async_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
CHROME = os.environ.get('CHROME_PATH')


async def shot(page, name, full=False):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=full)


async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await browser.new_context(viewport={'width': 1366, 'height': 900})
        page = await ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))

        # 1. Search with live suggestions
        await page.goto(BASE + '/')
        await page.fill('#q', 'airpods')
        await expect(page.locator('#suggest .suggest-item').first).to_be_visible()
        await shot(page, '01-search-suggest')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await page.wait_for_url(re.compile(r'/p/apple-airpods'))
        print('search suggestion opens the product')

        # 2. Category filters
        await page.goto(BASE + '/c/smartphones')
        await page.check('input[name=brand][value=samsung]')
        await page.wait_for_url(re.compile(r'brand=samsung'))
        await expect(page.locator('.toolbar .count')).to_have_text('3 products')
        await page.select_option('#sort-by', 'price_asc')
        await page.wait_for_url(re.compile(r'sort=price_asc'))
        first = await page.locator('.pcard-name a').first.inner_text()
        assert first == 'Samsung Galaxy A16', first
        await shot(page, '02-listing-filtered')
        print('filters and sorting work')

        # 3. Product page: variants, gallery, add to cart
        await page.goto(BASE + '/p/samsung-galaxy-s25-ultra')
        price = page.locator('[data-price]')
        await page.click('[data-opt="Storage"][data-val="512 GB"]')
        await expect(price).to_have_text('Rs 439,999')
        await page.click('[data-opt="Color"][data-val="Midnight"]')
        await expect(page.locator('[data-main-img]')).to_have_attribute('src', re.compile('midnight'))
        await page.click('[data-city-pick]')
        await page.select_option('[data-city-select]', 'Karachi')
        await expect(page.locator('[data-eta]')).to_contain_text('Karachi')
        await page.click('[data-add-btn]')
        await expect(page.locator('#drawer-cart')).to_have_class(re.compile('is-open'))
        await expect(page.locator('[data-cart-count]').first).to_have_text('1')
        await shot(page, '03-cart-drawer')
        await page.click('#drawer-cart .drawer-head [data-close]')
        print('variant picking and add to cart work')

        # 4. Quick add from a card and wishlist
        await page.goto(BASE + '/c/accessories')
        await page.locator('[data-add]').first.click()
        await expect(page.locator('[data-cart-count]').first).to_have_text('2')
        await page.click('#drawer-cart .drawer-head [data-close]')
        await page.locator('[data-wish]').first.click()
        await expect(page.locator('[data-wish-count]').first).to_have_text('1')
        print('quick add and wishlist work')

        # 5. Cart page: quantity and coupon
        await page.goto(BASE + '/cart')
        await page.locator('[data-line-qty] [data-qty-step="1"]').last.click()
        await page.wait_for_load_state('networkidle')
        await page.fill('#coupon', 'TAAR2000')
        await page.click('[data-coupon-form] button')
        await expect(page.locator('.coupon-tag')).to_contain_text('TAAR2000')
        await shot(page, '04-cart-page', True)
        print('cart quantity and coupon work')

        # 6. Checkout as a guest
        await page.click('a.btn-primary:has-text("Check out")')
        await page.wait_for_url(re.compile('/checkout'))
        await page.fill('[name=email]', 'e2e.shopper@example.com')
        await page.fill('[name=phone]', '0333 5557788')
        await page.fill('[name=full_name]', 'Sana Tariq')
        await page.fill('[name=line1]', 'House 21, Street 3, F-7/2')
        await page.select_option('[data-city]', 'Islamabad')
        await expect(page.locator('[data-province-select]')).to_have_value('Islamabad Capital Territory')
        await expect(page.locator('[data-ship-options] input')).to_have_count(2)
        total_std = await page.locator('[data-t="total"]').inner_text()
        await page.check('[name=shipping_method][value=express]')
        await expect(page.locator('[data-t="shipping"]')).to_have_text('Rs 799')
        assert await page.locator('[data-t="total"]').inner_text() != total_std
        # The cart is over the Rs 300,000 cash on delivery limit, so COD must be switched off.
        await expect(page.locator('[name=payment_method][value=cod]')).to_be_disabled()
        await page.check('[name=payment_method][value=card]')
        await shot(page, '05-checkout', True)
        await page.click('[data-place-order]')
        await expect(page.locator('[name=accept_terms]')).to_be_focused()
        await page.check('[name=accept_terms]')
        await page.click('[data-place-order]')
        await page.wait_for_url(re.compile(r'/pay/sandbox/'))
        await shot(page, '06a-test-gateway')
        await page.click('button[value=pay]')
        await page.wait_for_url(re.compile(r'/order/TR\d+'))
        await expect(page.locator('h1')).to_contain_text('Your order is in')
        await expect(page.locator('.pill-green:has-text("Paid")')).to_be_visible()
        number = re.search(r'/order/(TR\d+)', page.url).group(1)
        await shot(page, '06-order-confirmation', True)
        print('guest checkout placed', number)

        # 7. Admin processes the order
        admin = await (await browser.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        admin.on('pageerror', lambda e: errors.append('admin: ' + str(e)))
        admin.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await admin.goto(BASE + '/admin')
        await admin.fill('[name=email]', 'admin@taar.pk')
        await admin.fill('[name=password]', 'Admin!2026')
        await admin.click('button[type=submit]:has-text("Sign in")')
        await admin.wait_for_url(re.compile('/admin'))
        await expect(admin.locator('.adm-top h1')).to_have_text('Overview')
        await admin.hover('[data-chart] rect[data-tip] >> nth=-1')
        await expect(admin.locator('.chart-tip')).to_be_visible()
        await shot(admin, '07-admin-dashboard', True)
        await admin.goto(BASE + '/admin/orders?q=' + number)
        await admin.click(f'a.rowlink:has-text("{number}")')
        # Paid online orders are confirmed automatically.
        await expect(admin.locator('.panel-head .pill').first).to_have_text('confirmed')
        await admin.click('button[value=processing]')
        await expect(admin.locator('.alert-success')).to_contain_text('processing')
        await admin.select_option('[name=courier]', 'TCS')
        await admin.fill('[name=tracking]', '123456789012')
        await admin.click('button[value=shipped]')
        await expect(admin.locator('.alert-success')).to_contain_text('shipped')
        await shot(admin, '08-admin-order', True)
        print('admin packed and shipped the order')

        # 8. Customer sees the update
        await page.reload()
        await expect(page.locator('.progress-wire .done')).to_have_count(4)
        await expect(page.locator('text=123456789012')).to_be_visible()
        print('customer order page shows tracking')

        # 9. Admin edits a product and the store reflects it
        await admin.goto(BASE + '/admin/products')
        await admin.click('a.rowlink:has-text("JBL Flip 6")')
        await admin.fill('[name=short_desc]', 'A rugged portable speaker for rain, dust and pool days.')
        await admin.click('[data-add-variant]')
        rows = admin.locator('[data-var-row]')
        last = rows.last
        await last.locator('input[name$="[opt][Color]"]').fill('Forest')
        await last.locator('input[name$="[stock]"]').fill('6')
        await admin.click('.sticky-save button[type=submit]')
        await expect(admin.locator('.alert-success')).to_contain_text('Product saved')
        await page.goto(BASE + '/p/jbl-flip-6')
        await expect(page.locator('[data-opt="Color"][data-val="Forest"]')).to_be_visible()
        await shot(admin, '09-admin-product', True)
        print('product edit appears in the store')

        # 10. Mobile layout checks
        m = await (await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)).new_page()
        m.on('pageerror', lambda e: errors.append('mobile: ' + str(e)))
        await m.goto(BASE + '/c/laptops')
        await m.click('.filter-btn')
        await expect(m.locator('#drawer-filters')).to_have_class(re.compile('is-open'))
        await m.check('#drawer-filters input[name=stock]')
        await m.click('#drawer-filters button:has-text("Show results")')
        await m.wait_for_url(re.compile('stock=1'))
        overflow = await m.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        assert not overflow, 'horizontal scroll on mobile listing'
        await shot(m, '10-mobile-listing')
        await m.goto(BASE + '/p/sony-wh-1000xm5')
        await m.evaluate('window.scrollTo(0, 1600)')
        await expect(m.locator('[data-sticky-buy]')).to_have_class(re.compile('is-shown'))
        await shot(m, '11-mobile-product')
        for path in ['/', '/cart', '/checkout', '/account/login']:
            await m.goto(BASE + path)
            assert not await m.evaluate('document.documentElement.scrollWidth > window.innerWidth'), path
        print('mobile drawers, sticky buy bar and layout work')

        await browser.close()
    if errors:
        print('Browser errors:', *errors, sep='\n  ')
        sys.exit(1)
    print('E2E PASSED')

asyncio.run(main())

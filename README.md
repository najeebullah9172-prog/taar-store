# Taar electronics store

Taar is a complete online store for selling electronics in Pakistan. It has a customer storefront, a checkout that takes cash on delivery, bank transfers and online payments, customer accounts, and an admin dashboard for running the shop day to day. Prices are in rupees, addresses use Pakistani cities and provinces, and phone numbers are checked as Pakistani mobile numbers.

The sample catalogue (40 products, 114 variants, reviews and two months of orders) is there so the store looks and behaves like a real one from the first run. Prices and specifications in it are illustrative, so check them before you go live.

## Run it

You need Node.js 22.13 or newer. Nothing else: the database is SQLite through Node's built in driver, so there is no database server to install.

```
npm install
npm run seed      # creates data/taar.db with the sample catalogue and staff accounts
npm start         # http://localhost:3000
```

`npm run reset` wipes the database and seeds it again. `npm run dev` restarts the server when files change.

Sign in at `/account/login` with:

| Who | Email | Password | Can do |
|---|---|---|---|
| Admin | admin@taar.pk | Admin!2026 | Everything, including settings and staff |
| Manager | manager@taar.pk | Manager!2026 | Catalogue, orders, discounts, shipping, customers |
| Support | support@taar.pk | Support!2026 | Orders, customers, returns, reviews |
| Customer | ayesha@example.com | Customer!2026 | A shopper with a saved address and past orders |

These demo passwords only work when you run the store on your own computer. On a live server (`NODE_ENV=production`) the admin password comes from `ADMIN_PASSWORD` and the manager and support accounts get random passwords, so nobody can sign in with the ones listed here.

## Publish it on Render

This gives the store a normal public link (for example `https://taar-store.onrender.com`) that anyone can open and order from without signing in.

1. Sign in at [render.com](https://render.com) with your GitHub account.
2. Open `https://render.com/deploy?repo=https://github.com/najeebullah9172-prog/taar-store`, or choose **New**, then **Blueprint**, and pick this repository. Render reads `render.yaml`.
3. When asked for `ADMIN_PASSWORD`, enter the password you want for `admin@taar.pk`, then click **Apply** (or **Deploy Blueprint**).
4. The first build takes a few minutes. Your link appears at the top of the service page.

On Render's free plan the site sleeps after 15 minutes without visitors and takes about a minute to wake up. Free instances have no permanent storage, so the sample catalogue is reloaded on every start and orders placed are cleared when the site sleeps or redeploys. For a real shop, move the service to a paid plan, attach a disk mounted at `/data`, and set `DB_PATH=/data/taar.db` and `UPLOAD_DIR=/data/uploads`.

## Preview on GitHub Codespaces

Push this folder to a GitHub repository, then on the repository page click **Code**, open the **Codespaces** tab and choose **Create codespace on main**. The included `.devcontainer` setup installs everything, seeds the sample data and starts the store. A preview opens by itself; you can also open the **Ports** tab and click the globe icon next to port 3000 to view it in a full browser tab.

## What works

Every button and form in the store is connected to the server and the database. The test suite places real orders against a throwaway database to prove it.

**Storefront**
* Home page with a featured product stage, a category rail, price drops, staff picks, best sellers, new arrivals, brands, customer reviews and recently viewed products.
* Search with live suggestions as you type (SQLite full text search, prefix matching, keyboard navigation).
* Category, brand, deals, new arrivals and search listings with filters for brand, price, availability, rating and category specific specifications (RAM, storage, PTA status, screen size and so on), plus sorting and pagination.
* Product pages with a photo gallery (hover zoom, full screen view, swipe on phones), colour and storage variants that change price, stock and photos, delivery fee and arrival time for the shopper's city, specification table, reviews with a rating breakdown, related products and a sticky buy bar on phones.
* Cart that survives closing the browser (stored on the server for 30 days), slide out cart drawer, quantity limits based on stock, discount codes, a free delivery progress bar and a delivery estimate.
* Wishlist (moves to the account on sign in), product comparison of up to four products, recently viewed.
* Single page checkout for guests or signed in customers, saved address picker, live delivery and total updates, optional account creation, server side validation with clear messages.
* Order page with progress, tracking number, invoice, cancellation while pending, bank transfer instructions with a reference form, and a payment retry for failed card payments.
* Order tracking by order number plus email or phone.
* Accounts: register, sign in, password reset by email link, profile, address book, order history, return requests within the return window, reviews marked as verified purchases.
* Information pages for delivery, returns, warranty, payment methods, questions, privacy and terms, plus a contact form.

**Admin dashboard** at `/admin`
* Overview with revenue, orders, average order value and customers compared with the previous period, a daily revenue chart with tooltips and a table view, orders by status, payment method split, top products, categories and cities, low stock and a to do list.
* Orders: filter and search, full detail, status changes with emails to the customer, courier and tracking number required before shipping, payment status updates, staff notes, automatic restock on cancellation, cash marked as collected on delivery.
* Products: create, edit, duplicate, archive, variants with their own SKU, price, compare at price and stock, specifications, highlights, SEO title and description, photo upload (converted to WebP and resized), photos tied to a colour.
* Inventory: bulk stock and price editing. Categories and brands. Customers with order history and account disabling.
* Discounts: percentage, fixed and free delivery codes with minimum spend, maximum discount, total and per customer limits and date ranges.
* Shipping zones with standard and express fees, free delivery thresholds, weight charges, delivery times and cash on delivery availability per zone.
* Returns: approve, decline, receive (restocks the items) and refund. Reviews moderation. Contact messages and a log of every email the store sends.
* Settings for store details, announcement bar, payment methods, bank accounts and the cash on delivery limit and fee. Staff management with roles and an activity log.

## What needs your accounts before going live

| Item | Status | What to do |
|---|---|---|
| Cash on delivery | Working | Nothing. Set the fee and order limit in Settings. |
| Bank transfer | Working | Put your real bank account and IBAN in Settings. |
| Card and wallet payments | Working end to end with the built in **test gateway** only. It never charges anyone. | Open a merchant account with a Pakistani gateway such as Safepay, JazzCash, Easypaisa or PayFast, add the keys to `.env`, and finish the matching adapter in `src/lib/payments.js` against that provider's current API documentation. The order, payment and webhook plumbing is already in place. Then set `PAYMENT_SANDBOX=0`. |
| Email | Every email is written to Admin > Messages. | Set `SMTP_URL` to send them for real. |
| Courier booking | Staff enter the courier and tracking number by hand. | Connect TCS, Leopards or PostEx APIs later if you want automatic booking. |
| Product photos | The sample products use original drawings, not photos. | Upload real product photos from each product's admin page. |
| Policies | Sample wording | Have the return, privacy and terms pages in `src/routes/pages.js` reviewed for your business. |

## Security

* Passwords are hashed with bcrypt. Sign in rotates the session, sessions are stored as SHA-256 hashes, and changing a password signs out other devices.
* Every form and API write is protected against cross site request forgery. Cookies are httpOnly and SameSite.
* Helmet sets a strict Content Security Policy (no inline or third party scripts) and other security headers.
* All SQL uses bound parameters. All input is validated on the server with Zod; the server recalculates every price, discount and delivery fee, so nothing the browser sends can change what a customer pays.
* Stock is taken with a conditional update inside a transaction, so two people cannot buy the last unit.
* Role based access for admin, manager and support, with an audit log of staff actions.
* Rate limits on sign in, checkout and public forms. Uploaded images are decoded and re-encoded with Sharp, so anything that is not a real image is rejected.
* Payment callbacks are verified with an HMAC signature and the amount is checked against the order.

## Testing

```
npm test                                   # 13 server tests on a throwaway database
python3 tests/e2e.py http://localhost:3000 # browser test of the whole journey
```

The browser test needs `pip install playwright` and `playwright install chromium`. It searches, filters, picks variants, adds to cart, applies a code, checks out, pays on the test gateway, then signs in as admin, ships the order, edits a product and checks the phone layout.

## Going to production

1. Copy `.env.example` to `.env` and fill it in. `APP_SECRET` must be long and random.
2. Put the app behind Nginx or Caddy with HTTPS and set `TRUST_PROXY=1`.
3. Back up `data/taar.db` and the `uploads` folder every day. SQLite in WAL mode comfortably handles a store of this size on one server.
4. If you later run several app servers, move to PostgreSQL and give the rate limiter a Redis store. The queries are plain SQL in `src/lib` and the routes, so the move is contained.

A `Dockerfile` is included. Mount a volume at `/data` for the database and uploads.

## How the code is organised

```
server.js                 starts the app
src/app.js                Express setup, security headers, shared template data
src/db.js                 schema, migrations and query helpers
src/lib/                  auth, sessions and CSRF, catalogue queries, pricing (cart, coupons,
                          shipping), orders, payments, email, validation, Pakistan city data
src/routes/               storefront, API, checkout, account and admin routes
views/                    EJS templates (store, account, admin) and shared partials
public/                   CSS design system, small vanilla JavaScript files, fonts, images
scripts/                  seed data and the product drawing generator
tests/                    server tests and the browser journey test
```

The front end is server rendered HTML with a little JavaScript on top. Pages load fast, work without JavaScript for the basics, and search engines see the full content, including Product and Breadcrumb structured data, canonical URLs and a sitemap.

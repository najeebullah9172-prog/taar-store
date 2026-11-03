'use strict';
// Spins up the app on a throwaway database and gives tests a tiny cookie aware client.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function setupApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taar-test-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.DISABLE_RATE_LIMIT = '1';
  process.env.NODE_ENV = 'test';
  execFileSync(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'scripts', 'seed.js')], { env: process.env, stdio: 'ignore' });
  const { createApp } = require('../src/app');
  const app = createApp();
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, dir }));
  });
}

class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i); const v = pair.slice(i + 1);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) || v === '') this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }
  async req(method, url, { form, json, headers = {}, redirect = 'manual' } = {}) {
    const h = { cookie: this.cookieHeader(), ...headers };
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams({ _csrf: this.csrf || '', ...form }).toString(); }
    if (json) { h['content-type'] = 'application/json'; h.accept = 'application/json'; h['x-csrf-token'] = this.csrf || ''; body = JSON.stringify(json); }
    const res = await fetch(this.base + url, { method, headers: h, body, redirect });
    this.store(res);
    const text = await res.text();
    const m = text.match(/name="csrf-token" content="([^"]+)"/);
    if (m) this.csrf = m[1];
    let data = null;
    try { data = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, location: res.headers.get('location'), text, data };
  }
  get(url, o) { return this.req('GET', url, o); }
  post(url, form, o = {}) { return this.req('POST', url, { form, ...o }); }
  api(method, url, json) { return this.req(method, url, { json: json || {} }); }
}

module.exports = { setupApp, Client };

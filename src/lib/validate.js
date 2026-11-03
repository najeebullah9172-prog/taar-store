'use strict';
const { z } = require('zod');
const { CITIES, PROVINCES, normalizePhone } = require('./pk');

const str = (min, max, msg) => z.string({ error: msg }).trim().min(min, msg).max(max, `Keep this under ${max} characters.`);
const optStr = (max) => z.string().trim().max(max, `Keep this under ${max} characters.`).optional().transform(v => v || null);
const phone = z.string({ error: 'Enter a Pakistani mobile number, for example 0300 1234567.' }).trim().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) { ctx.addIssue({ code: 'custom', message: 'Enter a Pakistani mobile number, for example 0300 1234567.' }); return z.NEVER; }
  return n;
});
const email = z.string().trim().toLowerCase().max(160).email('Enter a valid email address, for example name@gmail.com.');
const password = z.string().min(8, 'Use at least 8 characters.').max(128)
  .refine(v => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number.');
const checkbox = z.any().optional().transform(v => v === 'on' || v === '1' || v === 'true' || v === true);
const intStr = (min = 0, max = 1e9) => z.coerce.number({ error: 'Enter a number.' }).int('Use a whole number.').min(min).max(max);

const address = {
  full_name: str(2, 80, 'Enter the full name for delivery.'),
  phone,
  line1: str(5, 160, 'Enter the house number, street and area.'),
  line2: optStr(120),
  city: z.string({ error: 'Choose your city from the list.' }).trim().refine(c => Object.prototype.hasOwnProperty.call(CITIES, c), 'Choose your city from the list.'),
  province: z.string({ error: 'Choose your province.' }).trim().refine(p => PROVINCES.includes(p), 'Choose your province.'),
  postal_code: z.string().trim().max(10).regex(/^\d{5}$|^$/, 'Postal codes in Pakistan have 5 digits.').optional().transform(v => v || null),
};

const schemas = {
  register: z.object({ name: str(2, 80, 'Enter your name.'), email, password, phone: phone.optional().or(z.literal('').transform(() => null)), marketing: checkbox }),
  login: z.object({ email: z.string().trim().min(1, 'Enter your email.'), password: z.string().min(1, 'Enter your password.') }),
  address: z.object({ ...address, label: optStr(40), is_default: checkbox }),
  checkout: z.object({
    email,
    ...address,
    shipping_method: z.enum(['standard', 'express'], { error: 'Choose a delivery option.' }),
    payment_method: z.enum(['cod', 'bank_transfer', 'card'], { error: 'Choose how you want to pay.' }),
    note: optStr(500),
    save_address: checkbox,
    create_account: checkbox,
    account_password: z.string().optional(),
    accept_terms: checkbox.refine(v => v, 'Please accept the terms to place your order.'),
  }),
  review: z.object({
    rating: intStr(1, 5),
    title: optStr(100),
    body: str(10, 2000, 'Write at least a sentence about the product.'),
  }),
  contact: z.object({ name: str(2, 80, 'Enter your name.'), email, phone: z.string().trim().max(20).optional(), subject: optStr(120), body: str(10, 3000, 'Tell us a little more so we can help.') }),
  track: z.object({ number: str(4, 30, 'Enter your order number.'), contact: str(4, 160, 'Enter the email or phone number used for the order.') }),
  returnRequest: z.object({ reason: z.enum(['defective', 'wrong_item', 'not_as_described', 'changed_mind', 'other'], { error: 'Choose a reason for the return.' }), details: optStr(1000), items: z.union([z.string(), z.array(z.string())]).transform(v => [].concat(v)) }),
};

/** Returns { data } on success or { errors: {field: message}, values } on failure. */
function check(schema, body) {
  const r = schema.safeParse(body || {});
  if (r.success) return { data: r.data };
  const errors = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { errors, values: body || {} };
}

module.exports = { z, schemas, check, str, optStr, phone, email, password, checkbox, intStr };

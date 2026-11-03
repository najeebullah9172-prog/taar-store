'use strict';
// Information pages. Edit the wording here; each section is a heading and paragraphs.
// These are sample policies. Have them reviewed for your business before launch.
module.exports = {
  about: {
    title: 'About Taar',
    summary: 'Taar sells genuine electronics across Pakistan with official warranty and cash on delivery.',
    sections: [
      { h: 'Who we are', p: ['Taar is an electronics store based in Lahore. We sell phones, laptops, audio, wearables and home electronics to customers in every province.', 'We started because buying electronics online in Pakistan often meant guessing whether a phone was PTA approved, whether the warranty was real, and whether the box would arrive sealed. We wanted a store where those answers are on the product page.'] },
      { h: 'What we promise', p: ['Every product is sourced from the brand or its authorised distributor in Pakistan. Phones are PTA approved. Warranty terms are listed on each product, and we handle claims for you if you prefer.', 'Prices on the site are the prices you pay. Delivery fees are shown before checkout and nothing is added at the door.'] },
    ],
  },
  shipping: {
    title: 'Delivery',
    summary: 'Delivery times and fees for Lahore, major cities and the rest of Pakistan.',
    sections: [
      { h: 'Where we deliver', p: ['We deliver to every city in Pakistan through TCS, Leopards and M&P. Lahore orders can be delivered the same day when placed before 1 pm.'] },
      { h: 'Fees and timing', p: ['Lahore: Rs 199 standard (1 to 2 working days) or Rs 499 same day.', 'Major cities including Karachi, Islamabad, Rawalpindi, Peshawar, Faisalabad, Multan and Quetta: Rs 299 standard (2 to 4 working days) or Rs 799 express.', 'Rest of Pakistan: Rs 449 (3 to 6 working days).', 'Delivery is free on orders over Rs 25,000 in Lahore and major cities, and over Rs 50,000 elsewhere. Heavy items such as TVs carry a small weight charge, shown at checkout.'] },
      { h: 'Checking your parcel', p: ['You can open the outer packaging in front of the rider to check the box is sealed and undamaged. Do not break the product seal before paying, as that affects returns. If anything looks wrong, refuse the parcel and call us.'] },
    ],
  },
  returns: {
    title: 'Returns and refunds',
    summary: 'Return a product within 7 days of delivery.',
    sections: [
      { h: '7 day returns', p: ['If a product is faulty, damaged in transit, or not what you ordered, request a return from your account within 7 days of delivery. We arrange the pickup at no cost.', 'If you changed your mind, we accept returns of unopened products with the seal intact within 7 days. A Rs 500 pickup fee applies.'] },
      { h: 'How refunds work', p: ['Once we receive and check the product, refunds are issued within 5 working days. Card and wallet payments go back to the original method. Cash on delivery and bank transfer orders are refunded to a bank account or wallet you choose.'] },
      { h: 'What we cannot accept', p: ['Products with physical damage caused after delivery, missing accessories, or software locks such as iCloud or Google account protection still active.'] },
    ],
  },
  warranty: {
    title: 'Warranty',
    summary: 'Official brand warranty on every product, with claims handled by us if you prefer.',
    sections: [
      { h: 'Official warranty', p: ['Every product carries the official warranty of the brand in Pakistan. The length is listed on each product page, usually 12 months for phones and laptops.'] },
      { h: 'Making a claim', p: ['You can take the product to the brand service centre with your invoice, or send it to us and we will handle the claim. Contact us with your order number and a short description of the fault.'] },
    ],
  },
  'payment-methods': {
    title: 'Payment methods',
    summary: 'Pay with cash on delivery, bank transfer, debit or credit card, JazzCash or Easypaisa.',
    sections: [
      { h: 'Cash on delivery', p: ['Available across Pakistan for orders up to Rs 300,000. Please keep the exact amount ready for the rider.'] },
      { h: 'Bank transfer', p: ['Transfer to our account after placing the order and add the transaction reference on your order page. We dispatch as soon as the payment is confirmed, usually within a few working hours.'] },
      { h: 'Cards and wallets', p: ['Pay with Visa, Mastercard, UnionPay, JazzCash or Easypaisa through our payment partner. Card details are entered on the payment partner\'s secure page and never touch our servers.'] },
    ],
  },
  faq: {
    title: 'Questions',
    summary: 'Answers to common questions about orders, delivery, PTA and warranty.',
    sections: [
      { h: 'Are your phones PTA approved?', p: ['Yes. Every phone we sell is PTA approved. You can check the IMEI on the PTA DIRBS website after delivery.'] },
      { h: 'Can I change or cancel my order?', p: ['You can cancel from your account while the order is pending or confirmed. Once it is packed, contact us and we will do our best.'] },
      { h: 'Do I need an account to order?', p: ['No. You can check out as a guest and track your order with the order number and your email or phone. An account lets you save addresses and see your order history.'] },
      { h: 'Do you give invoices?', p: ['Yes. A printed invoice comes in the box, and you can print one from your order page at any time.'] },
    ],
  },
  privacy: {
    title: 'Privacy',
    summary: 'What we collect and how we use it.',
    sections: [
      { h: 'What we collect', p: ['Your name, contact details and address so we can deliver your order, and your order history so you can track and return products. We use cookies to keep you signed in and to remember your cart.'] },
      { h: 'What we do not do', p: ['We do not sell your data. We do not store card numbers; payments are handled by our payment partner. We only share your address and phone number with the courier delivering your order.'] },
      { h: 'Your choices', p: ['You can update your details from your account, unsubscribe from emails with one click, or ask us to delete your account by contacting support.'] },
    ],
  },
  terms: {
    title: 'Terms of sale',
    summary: 'The terms that apply when you buy from Taar.',
    sections: [
      { h: 'Prices and availability', p: ['Prices are in Pakistani rupees and include applicable taxes. We may cancel an order if a product turns out to be unavailable or was listed at an obviously wrong price, and we refund any payment in full.'] },
      { h: 'Orders', p: ['An order is accepted when we confirm it. For cash on delivery orders we may call to confirm before dispatch.'] },
      { h: 'Liability', p: ['Our liability is limited to the price paid for the product. Nothing in these terms affects your rights under Pakistani consumer protection law.'] },
    ],
  },
};

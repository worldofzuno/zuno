/**
 * Checks on the checkout session builder, run with:
 *
 *     node --test tests/functions/create-checkout-session.test.mjs
 *
 * The point of these is narrow: the amount charged must come from the Stripe
 * catalogue and from nowhere else, and the promotion-code field must be
 * Stripe's rather than something this code invents.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.STRIPE_PRICE_CASTANO_200G = 'price_test_200';
process.env.STRIPE_PRICE_CASTANO_500G = 'price_test_500';
process.env.STRIPE_PRICE_FNF_CASTANO_200G = 'price_fnf_200';
process.env.STRIPE_PRICE_FNF_CASTANO_500G = 'price_fnf_500';
process.env.STRIPE_PRICE_GIFT_25 = 'price_gift_25';
process.env.STRIPE_PRICE_GIFT_50 = 'price_gift_50';
process.env.STRIPE_PRICE_GIFT_100 = 'price_gift_100';
process.env.STRIPE_PRODUCT_GIFT = 'prod_gift';
process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
process.env.FNF_CODES = JSON.stringify([{ code: 'FAMILY26' }]);

const { parseCart, parseCode, parseGift, subtotalRappen, physicalSubtotal, hasPhysical,
  shippingOption, sessionParams, build } = await import('../../netlify/functions/create-checkout-session.mjs');
const { FNF_CATALOGUE } = await import('../../netlify/functions/lib/fnf.mjs');
const { useMemoryStore } = await import('../../netlify/functions/lib/store.mjs');
const gc = await import('../../netlify/functions/lib/giftcard.mjs');

const PRICES = {
  price_test_200: { id: 'price_test_200', unit_amount: 1490, currency: 'chf' },
  price_test_500: { id: 'price_test_500', unit_amount: 2990, currency: 'chf' },
};

/* The Family & Friends amounts, as they exist in Stripe. */
const FNF_PRICES = {
  price_fnf_200: { id: 'price_fnf_200', unit_amount: 1100, currency: 'chf' },
  price_fnf_500: { id: 'price_fnf_500', unit_amount: 2000, currency: 'chf' },
};

/* Everything the API would return, for the tests that run `build`. */
const ALL_PRICES = {
  price_test_200: { id: 'price_test_200', unit_amount: 1490, currency: 'chf', product: 'prod_200' },
  price_test_500: { id: 'price_test_500', unit_amount: 2990, currency: 'chf', product: 'prod_500' },
  price_fnf_200: { id: 'price_fnf_200', unit_amount: 1100, currency: 'chf', product: 'prod_200' },
  price_fnf_500: { id: 'price_fnf_500', unit_amount: 2000, currency: 'chf', product: 'prod_500' },
  price_gift_25: { id: 'price_gift_25', unit_amount: 2500, currency: 'chf', product: 'prod_gift' },
  price_gift_50: { id: 'price_gift_50', unit_amount: 5000, currency: 'chf', product: 'prod_gift' },
  price_gift_100: { id: 'price_gift_100', unit_amount: 10000, currency: 'chf', product: 'prod_gift' },
};

/** Stripe, minus the network. Records what was asked of it. */
function fakeStripe() {
  const made = { coupons: [], sessions: [] };
  return {
    made,
    prices: {
      retrieve: async (id) => ALL_PRICES[id] || Promise.reject(new Error(`no price ${id}`)),
    },
    coupons: {
      create: async (p) => { made.coupons.push(p); return { id: 'co_' + made.coupons.length }; },
    },
    checkout: {
      sessions: {
        create: async (p) => { made.sessions.push(p); return { id: 'cs_1', url: 'https://checkout.stripe.com/x' }; },
      },
    },
  };
}

const ORIGIN = 'https://worldofzuno.com';

test('the promotion code field is Stripe\'s own', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com');
  assert.equal(p.allow_promotion_codes, true);
  // nothing in here may look like a discount this code worked out
  const blob = JSON.stringify(p);
  for (const word of ['discount', 'coupon', 'promotion_code"', 'percent_off']) {
    assert.ok(!blob.includes(word), `session must not carry ${word}`);
  }
});

test('line items carry a catalogue price id and a quantity, and nothing else', () => {
  const lines = parseCart({ items: [{ sku: 'castano-500g', qty: 3, grind: 'Pre-Ground' }] });
  const p = sessionParams(lines, 8970, 'https://worldofzuno.com');
  assert.deepEqual(p.line_items, [{ price: 'price_test_500', quantity: 3 }]);
});

test('an amount sent by the client for a product is ignored entirely', () => {
  const lines = parseCart({
    items: [{ sku: 'castano-200g', qty: 2, price: 0.01, unit_amount: 1, amount_total: 1, amount: 1 }],
  });
  assert.deepEqual(lines, [{ sku: 'castano-200g', qty: 2, grind: 'Whole Beans', amount: null }]);
  assert.equal(subtotalRappen(lines, PRICES), 2980);
  const p = sessionParams(lines, 2980, 'https://worldofzuno.com');
  assert.ok(!JSON.stringify(p).includes('0.01'));
});

test('only catalogue keys are products', () => {
  assert.throws(() => parseCart({ items: [{ sku: 'price_test_200', qty: 1 }] }), /not a product/);
  assert.throws(() => parseCart({ items: [{ sku: 'castano-1kg', qty: 1 }] }), /not a product/);
  assert.throws(() => parseCart({ items: [{ sku: '__proto__', qty: 1 }] }), /not a product/);
});

test('quantities are whole, positive and bounded', () => {
  for (const qty of [0, -1, 1.5, 21, 1e9, NaN, null, undefined, 'two', {}, []]) {
    assert.throws(() => parseCart({ items: [{ sku: 'castano-200g', qty }] }), /qty/);
  }
  assert.equal(parseCart({ items: [{ sku: 'castano-200g', qty: 20 }] })[0].qty, 20);
  // A JSON client may well send "2". Coercing it is safe because the integer
  // and range checks come after, and a quantity cannot carry an amount.
  assert.equal(parseCart({ items: [{ sku: 'castano-200g', qty: '2' }] })[0].qty, 2);
});

test('an empty or malformed cart is refused', () => {
  assert.throws(() => parseCart({ items: [] }), /non-empty/);
  assert.throws(() => parseCart({}), /non-empty/);
  assert.throws(() => parseCart(null), /object/);
  assert.throws(() => parseCart({ items: Array(11).fill({ sku: 'castano-200g', qty: 1 }) }),
    /too many/);
});

test('the same product and grind twice is refused rather than silently doubled', () => {
  assert.throws(() => parseCart({
    items: [{ sku: 'castano-200g', qty: 1 }, { sku: 'castano-200g', qty: 1 }],
  }), /duplicate/);
  // different grind is a different line, and allowed
  const ok = parseCart({
    items: [{ sku: 'castano-200g', qty: 1, grind: 'Whole Beans' },
            { sku: 'castano-200g', qty: 1, grind: 'Pre-Ground' }],
  });
  assert.equal(ok.length, 2);
});

test('an unrecognised grind falls back rather than reaching Stripe', () => {
  const [line] = parseCart({ items: [{ sku: 'castano-200g', qty: 1, grind: '<script>' }] });
  assert.equal(line.grind, 'Whole Beans');
});

test('free shipping turns on exactly at CHF 45.00', () => {
  assert.equal(shippingOption(4499).shipping_rate_data.fixed_amount.amount, 700);
  assert.equal(shippingOption(4500).shipping_rate_data.fixed_amount.amount, 0);
  assert.equal(shippingOption(4500).shipping_rate_data.display_name, 'Free shipping');
});

test('a price in the wrong currency or shape is refused', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  assert.throws(() => subtotalRappen(lines, {
    price_test_200: { unit_amount: 1490, currency: 'eur' },
  }), /not in CHF/);
  assert.throws(() => subtotalRappen(lines, {
    price_test_200: { currency: 'chf' },
  }), /unit_amount/);
});

test('the return pages are this site, not a caller-supplied url', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com');
  assert.ok(p.success_url.startsWith('https://worldofzuno.com/'));
  assert.ok(p.cancel_url.startsWith('https://worldofzuno.com/'));
  assert.ok(p.success_url.includes('{CHECKOUT_SESSION_ID}'));
});

test('delivery is limited to Switzerland and Liechtenstein', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com');
  assert.deepEqual(p.shipping_address_collection.allowed_countries, ['CH', 'LI']);
});

test('the grind reaches the person packing the order', () => {
  const lines = parseCart({ items: [{ sku: 'castano-500g', qty: 2, grind: 'Pre-Ground' }] });
  const p = sessionParams(lines, 5980, 'https://worldofzuno.com');
  assert.ok(p.metadata.lines.includes('Pre-Ground'));
  assert.ok(p.metadata.lines.length <= 500);
});

test('the parameters Checkout Studio fixed are the ones sent', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com');
  assert.equal(p.ui_mode, 'hosted_page');          // stripe@22, so not the pre-21 'hosted'
  assert.equal(p.mode, 'payment');
  assert.equal(p.billing_address_collection, 'auto');
  assert.deepEqual(p.phone_number_collection, { enabled: false });
  assert.deepEqual(p.automatic_tax, { enabled: false });
  assert.equal(p.submit_type, 'auto');
  assert.equal(p.origin_context, 'web');
  assert.equal(p.integration_identifier, 'hosted_web_0001');

  /* Two Studio values are deliberately absent. payment_method_collection can
     only be set in subscription mode — sending it here fails the call. And
     saved_payment_method_options needs a Customer and consent language for
     storing card details, neither of which this shop has. */
  assert.equal('payment_method_collection' in p, false);
  assert.equal('saved_payment_method_options' in p, false);

  /* Shipping and the grind are not Studio parameters, and removing them
     would take the CHF 7 postage and the grind off the order. */
  assert.ok(p.shipping_options.length);
  assert.ok(p.shipping_address_collection);
  assert.ok(p.metadata.lines);
});

/* --------------------------------------------------- Family & Friends code */

test('a cart with no code is the normal case, not a failed code', () => {
  assert.equal(parseCode({ items: [] }), null);
  assert.equal(parseCode({ code: '' }), null);
  assert.equal(parseCode({ code: null }), null);
  assert.equal(parseCode({}), null);
  assert.equal(parseCode({ code: 'FAMILY26' }), 'FAMILY26');
});

test('a code that is not a string, or absurdly long, is refused', () => {
  assert.throws(() => parseCode({ code: 42 }), /must be a string/);
  assert.throws(() => parseCode({ code: {} }), /must be a string/);
  assert.throws(() => parseCode({ code: 'x'.repeat(65) }), /not valid/);
});

test('a Family & Friends line points at the special price, not the regular one', () => {
  const lines = parseCart({
    items: [{ sku: 'castano-200g', qty: 1 }, { sku: 'castano-500g', qty: 1 }],
  });
  const p = sessionParams(lines, 4480, 'https://worldofzuno.com', 'FAMILY26');
  assert.deepEqual(p.line_items, [
    { price: 'price_fnf_200', quantity: 1 },
    { price: 'price_fnf_500', quantity: 1 },
  ]);
});

test('both sizes reach exactly CHF 11.00 and CHF 20.00', () => {
  const cat = FNF_CATALOGUE();
  const one = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const two = parseCart({ items: [{ sku: 'castano-500g', qty: 1 }] });
  assert.equal(subtotalRappen(one, FNF_PRICES, cat), 1100);
  assert.equal(subtotalRappen(two, FNF_PRICES, cat), 2000);
  // and the two reductions really are different, which is why one coupon
  // could never have produced both
  assert.equal(1490 - 1100, 390);
  assert.equal(2990 - 2000, 990);
});

test('quantities multiply the special price, not the regular one', () => {
  const lines = parseCart({ items: [{ sku: 'castano-500g', qty: 3 }] });
  assert.equal(subtotalRappen(lines, FNF_PRICES, FNF_CATALOGUE()), 6000);
  assert.equal(subtotalRappen(lines, PRICES), 8970);
});

test('a public promotion code cannot land on top of a Family & Friends price', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  assert.equal(sessionParams(lines, 1490, 'https://worldofzuno.com').allow_promotion_codes, true);
  assert.equal(
    sessionParams(lines, 1490, 'https://worldofzuno.com', 'FAMILY26').allow_promotion_codes,
    false
  );
});

test('the code is recorded where the redemption count can find it', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com', 'FAMILY26');
  assert.equal(p.metadata.fnf_code, 'FAMILY26');
  // Checkout Sessions cannot be searched by metadata; PaymentIntents can
  assert.equal(p.payment_intent_data.metadata.fnf_code, 'FAMILY26');
});

test('a regular cart carries no trace of the Family & Friends mechanism', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com');
  assert.equal('fnf_code' in p.metadata, false);
  assert.equal('payment_intent_data' in p, false);
  assert.deepEqual(p.line_items, [{ price: 'price_test_200', quantity: 1 }]);
});

test('a voucher code carries free shipping, however small the cart', () => {
  /* One 200 g bag: CHF 14.90 regular, CHF 11.00 with the code — nowhere near
     the CHF 45 threshold, and postage is waived anyway. */
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, 'https://worldofzuno.com', 'FAMILY26');
  const rate = p.shipping_options[0].shipping_rate_data;
  assert.equal(rate.fixed_amount.amount, 0);
  assert.equal(rate.display_name, 'Free shipping');
  // without the code the same cart pays postage
  assert.equal(
    sessionParams(lines, 1490, 'https://worldofzuno.com')
      .shipping_options[0].shipping_rate_data.fixed_amount.amount,
    700
  );
});

test('the threshold still governs a cart with no code', () => {
  assert.equal(shippingOption(4499).shipping_rate_data.fixed_amount.amount, 700);
  assert.equal(shippingOption(4500).shipping_rate_data.fixed_amount.amount, 0);
  // and the override is what a code uses, not a subtotal of its own
  assert.equal(shippingOption(0, true).shipping_rate_data.fixed_amount.amount, 0);
  assert.equal(shippingOption(0, true).shipping_rate_data.display_name, 'Free shipping');
});

test('a Family & Friends session still carries no discount of our own making', () => {
  const lines = parseCart({ items: [{ sku: 'castano-200g', qty: 2 }] });
  const blob = JSON.stringify(sessionParams(lines, 2980, 'https://worldofzuno.com', 'FAMILY26'));
  for (const word of ['coupon', 'percent_off', 'amount_off', 'discounts']) {
    assert.ok(!blob.includes(word), `session must not carry ${word}`);
  }
  // the reduction is a price id, and the amount behind it is Stripe's
  assert.ok(!blob.includes('11.00') && !blob.includes('1100'));
});

/* ---------------------------------------------------------- gift cards */

test('a gift card is a line like any other, but with its own amount', () => {
  const lines = parseCart({ items: [{ sku: 'gift-50', qty: 2 }] });
  assert.deepEqual(lines, [{ sku: 'gift-50', qty: 2, grind: null, amount: null }]);
  // a grind on a gift card would tell someone to grind a code
  assert.equal(parseCart({ items: [{ sku: 'gift-25', qty: 1, grind: 'Pre-Ground' }] })[0].grind, null);
});

test('a chosen amount is clamped, and is the one amount a client may send', () => {
  assert.equal(parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: 3500 }] })[0].amount, 3500);
  /* A quoted whole number is coerced, for the same reason a quantity of "2"
     is: the range check comes after, so there is nothing to smuggle through. */
  assert.equal(parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: '3500' }] })[0].amount, 3500);
  assert.throws(() => parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: '1' }] }), /amount must be/);

  for (const bad of [0, 1499, 20001, -5000, 1500.5, 'lots', null, undefined, NaN, 1e9, {}, []]) {
    assert.throws(
      () => parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: bad }] }),
      /amount must be/,
      `${JSON.stringify(bad)} must be refused`
    );
  }
  // the bounds themselves are allowed
  assert.equal(parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: 1500 }] })[0].amount, 1500);
  assert.equal(parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: 20000 }] })[0].amount, 20000);
});

test('two different chosen amounts are two lines, the same one is a duplicate', () => {
  assert.equal(parseCart({ items: [
    { sku: 'gift-custom', qty: 1, amount: 2000 },
    { sku: 'gift-custom', qty: 1, amount: 3000 },
  ] }).length, 2);
  assert.throws(() => parseCart({ items: [
    { sku: 'gift-custom', qty: 1, amount: 2000 },
    { sku: 'gift-custom', qty: 1, amount: 2000 },
  ] }), /duplicate/);
});

test('only coffee goes in a parcel', () => {
  const both = parseCart({ items: [{ sku: 'gift-50', qty: 1 }, { sku: 'castano-200g', qty: 1 }] });
  assert.equal(hasPhysical(both), true);
  assert.equal(hasPhysical(parseCart({ items: [{ sku: 'gift-50', qty: 1 }] })), false);
  // the gift card must not drag the cart over the free-shipping threshold
  assert.equal(subtotalRappen(both, ALL_PRICES), 6490);
  assert.equal(physicalSubtotal(both, ALL_PRICES), 1490);
});

test('a cart with nothing to post asks for no address and offers no postage', () => {
  const lines = parseCart({ items: [{ sku: 'gift-50', qty: 1 }] });
  const p = sessionParams(lines, 0, ORIGIN);
  assert.equal('shipping_options' in p, false);
  assert.equal('shipping_address_collection' in p, false, 'nothing to ship, nothing to ask');
});

test('a voucher code does not reduce a gift card', () => {
  const lines = parseCart({ items: [{ sku: 'gift-50', qty: 1 }, { sku: 'castano-200g', qty: 1 }] });
  const p = sessionParams(lines, 1490, ORIGIN, { fnfCode: 'FAMILY26' });
  assert.deepEqual(p.line_items, [
    { price: 'price_gift_50', quantity: 1 },
    { price: 'price_fnf_200', quantity: 1 },
  ], 'the gift card keeps its face value; selling credit at a discount is selling francs');
});

test('a chosen amount is sent inline, and in full', () => {
  const lines = parseCart({ items: [{ sku: 'gift-custom', qty: 1, amount: 3500 }] });
  const [item] = sessionParams(lines, 0, ORIGIN).line_items;
  assert.deepEqual(item, {
    price_data: { currency: 'chf', product: 'prod_gift', unit_amount: 3500, tax_behavior: 'inclusive' },
    quantity: 1,
  });
});

/* ------------------------------------------------- redeeming, end to end */

async function withCard(amount = 3000) {
  useMemoryStore();
  return gc.issue({ amount, issuedFor: 'cs_bought' });
}

test('a gift card pays for the coffee and holds exactly that much', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  const r = await build(s, {
    items: [{ sku: 'castano-200g', qty: 1 }],
    gift: card.code,
  }, ORIGIN);

  assert.equal(r.status, 200);
  const [coupon] = s.made.coupons;
  assert.equal(coupon.amount_off, 1490, 'the whole coffee, since the card covers it');
  assert.equal(coupon.currency, 'chf');
  assert.equal(coupon.max_redemptions, 1);
  assert.deepEqual(coupon.applies_to, { products: ['prod_200'] });
  assert.equal(gc.available(await gc.load(card.code)), 3000 - 1490);
});

test('a card smaller than the bill pays what it can', async () => {
  const card = await withCard(1000);
  const s = fakeStripe();
  await build(s, { items: [{ sku: 'castano-500g', qty: 1 }], gift: card.code }, ORIGIN);
  assert.equal(s.made.coupons[0].amount_off, 1000);
  assert.equal(gc.available(await gc.load(card.code)), 0);
});

test('the coupon is restricted to the coffee on the order, never the gift card', async () => {
  const card = await withCard(10000);
  const s = fakeStripe();
  await build(s, {
    items: [{ sku: 'gift-100', qty: 1 }, { sku: 'castano-200g', qty: 1 }],
    gift: card.code,
  }, ORIGIN);
  const [coupon] = s.made.coupons;
  assert.deepEqual(coupon.applies_to, { products: ['prod_200'] });
  assert.equal(coupon.amount_off, 1490, 'the coffee only — credit must not buy credit');
});

test('a gift card cannot pay for a gift card', async () => {
  const card = await withCard(10000);
  const s = fakeStripe();
  const r = await build(s, { items: [{ sku: 'gift-50', qty: 1 }], gift: card.code }, ORIGIN);
  assert.equal(r.status, 400);
  assert.equal(r.payload.reason, 'nothing-payable');
  assert.equal(s.made.coupons.length, 0, 'no coupon may be minted for it');
  assert.equal(gc.available(await gc.load(card.code)), 10000, 'and nothing may be held');
});

test('a gift card and a voucher work together, on the voucher price', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  const r = await build(s, {
    items: [{ sku: 'castano-200g', qty: 1 }],
    code: 'FAMILY26',
    gift: card.code,
  }, ORIGIN);
  assert.equal(r.status, 200);
  assert.equal(s.made.coupons[0].amount_off, 1100, 'what is actually owed, after the voucher');
  const [session] = s.made.sessions;
  assert.deepEqual(session.line_items, [{ price: 'price_fnf_200', quantity: 1 }]);
  assert.equal(session.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
});

test('a gift card takes the single discount slot, so no promotion field appears', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  await build(s, { items: [{ sku: 'castano-200g', qty: 1 }], gift: card.code }, ORIGIN);
  const [session] = s.made.sessions;
  assert.deepEqual(session.discounts, [{ coupon: 'co_1' }]);
  assert.equal('allow_promotion_codes' in session, false,
    'Stripe allows one of the two, never both');
});

test('the session carries what the webhook needs to settle the hold', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  await build(s, { items: [{ sku: 'castano-200g', qty: 1 }], gift: card.code }, ORIGIN);
  const { metadata } = s.made.sessions[0];
  assert.equal(metadata.gift_code, card.code);
  assert.equal(metadata.gift_hold, '1490');
  assert.ok(metadata.gift_ref, 'without a reference the hold cannot be found again');
});

test('an unknown or empty card is refused and nothing is held', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  assert.equal((await build(s, { items: [{ sku: 'castano-200g', qty: 1 }], gift: 'ZG-2222-3333-4444' }, ORIGIN)).status, 400);
  assert.equal((await build(s, { items: [{ sku: 'castano-200g', qty: 1 }], gift: 'nonsense' }, ORIGIN)).status, 400);

  await gc.hold(card.code, 'elsewhere', 3000);
  const r = await build(s, { items: [{ sku: 'castano-200g', qty: 1 }], gift: card.code }, ORIGIN);
  assert.equal(r.status, 400);
  assert.equal(r.payload.reason, 'empty');
  assert.equal(s.made.sessions.length, 0);
});

test('a session that could not be created gives the hold straight back', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  s.checkout.sessions.create = async () => { throw new Error('Stripe is down'); };
  const real = console.error;
  console.error = () => {};
  try {
    const r = await build(s, { items: [{ sku: 'castano-200g', qty: 1 }], gift: card.code }, ORIGIN);
    assert.equal(r.status, 502);
  } finally {
    console.error = real;
  }
  assert.equal(gc.available(await gc.load(card.code)), 3000,
    'a balance must not stay frozen for a checkout that never existed');
});

test('a cart with no gift card touches no balance and mints no coupon', async () => {
  const card = await withCard(3000);
  const s = fakeStripe();
  const r = await build(s, { items: [{ sku: 'castano-200g', qty: 1 }] }, ORIGIN);
  assert.equal(r.status, 200);
  assert.equal(s.made.coupons.length, 0);
  assert.equal(s.made.sessions[0].allow_promotion_codes, true);
  assert.equal(gc.available(await gc.load(card.code)), 3000);
});

/* ------------------------------------------------------------- accounts */

test('an order placed while signed in is tagged with the account', async () => {
  useMemoryStore();
  const auth = await import('../../netlify/functions/lib/auth.mjs');
  const made = await auth.createAccount({
    name: 'A Kundin', email: 'kundin@example.ch', password: 'a decent long passphrase',
  });
  const token = await auth.startSession(made.account.id);

  const s = fakeStripe();
  const r = await build(s, { items: [{ sku: 'castano-200g', qty: 1 }] }, ORIGIN, {
    cookie: `zuno_session=${encodeURIComponent(token)}`,
  });
  assert.equal(r.status, 200);
  assert.equal(s.made.sessions[0].metadata.account, made.account.id);
});

test('a guest order belongs to nobody', async () => {
  useMemoryStore();
  const s = fakeStripe();
  await build(s, { items: [{ sku: 'castano-200g', qty: 1 }] }, ORIGIN);
  assert.equal('account' in s.made.sessions[0].metadata, false);

  await build(s, { items: [{ sku: 'castano-200g', qty: 1 }] }, ORIGIN, { cookie: 'zuno_session=made-up' });
  assert.equal('account' in s.made.sessions[1].metadata, false, 'a forged cookie files nothing');
});

test('an account cannot be named by the client', async () => {
  useMemoryStore();
  const auth = await import('../../netlify/functions/lib/auth.mjs');
  const victim = await auth.createAccount({
    name: 'B', email: 'b@example.ch', password: 'a decent long passphrase',
  });
  const s = fakeStripe();
  /* Both of these are the client asking for someone else's account. */
  await build(s, {
    items: [{ sku: 'castano-200g', qty: 1 }],
    account: victim.account.id,
    accountId: victim.account.id,
  }, ORIGIN);
  assert.equal('account' in s.made.sessions[0].metadata, false,
    'only a cookie may say who you are');
});

test('a signed-in customer does not retype their email', async () => {
  useMemoryStore();
  const auth = await import('../../netlify/functions/lib/auth.mjs');
  const made = await auth.createAccount({
    name: 'A Kundin', email: 'kundin@example.ch', password: 'a decent long passphrase',
  });
  const token = await auth.startSession(made.account.id);

  const s = fakeStripe();
  await build(s, { items: [{ sku: 'castano-200g', qty: 1 }] }, ORIGIN, {
    cookie: `zuno_session=${encodeURIComponent(token)}`,
  });
  assert.equal(s.made.sessions[0].customer_email, 'kundin@example.ch');
});

test('a guest is asked for an email like anyone else', async () => {
  useMemoryStore();
  const s = fakeStripe();
  await build(s, { items: [{ sku: 'castano-200g', qty: 1 }] }, ORIGIN);
  assert.equal('customer_email' in s.made.sessions[0], false);
});

test('a client cannot put someone else address on the session', async () => {
  useMemoryStore();
  const s = fakeStripe();
  await build(s, {
    items: [{ sku: 'castano-200g', qty: 1 }],
    customer_email: 'victim@example.ch',
    email: 'victim@example.ch',
  }, ORIGIN);
  assert.equal('customer_email' in s.made.sessions[0], false,
    'the address comes from the session or not at all');
});

/* ------------------------------------------------------------------------
   The one class of mistake this file could not otherwise catch.

   Every test above hands build() a substitute for Stripe, because talking to
   the real one from a test is slower, flakier and costs money. The hole that
   leaves is precisely the call being substituted: sessions.create. The shop's
   first live checkout returned 502 because the session carried the Checkout
   Studio parameters — ui_mode "hosted_page", origin_context,
   integration_identifier — while the client pinned apiVersion 2024-06-20,
   which predates all three. Stripe refuses an unknown parameter; a stub
   accepts anything.

   These two checks are the closest a test without a network can get: the
   parameters must be ones the installed SDK declares, and the version the
   client asks for must be the one those declarations were generated from.
   ---------------------------------------------------------------------- */

import { readFileSync } from 'node:fs';

const SRC = new URL('../../netlify/functions/create-checkout-session.mjs', import.meta.url);
const SDK_TYPES = new URL('../../node_modules/stripe/cjs/resources/Checkout/Sessions.d.ts', import.meta.url);
const SDK_VERSION = new URL('../../node_modules/stripe/cjs/apiVersion.js', import.meta.url);

test('every session parameter is one this Stripe SDK declares', () => {
  let types;
  try {
    types = readFileSync(SDK_TYPES, 'utf8');
  } catch {
    return;                      // no SDK installed: nothing to check against
  }
  /* The create parameters, as the SDK's own declaration file lists them. */
  const block = types.slice(types.indexOf('interface SessionCreateParams'));
  const declared = new Set(
    [...block.slice(0, block.indexOf('\n    }')).matchAll(/^\s{8}(\w+)\??:/gm)].map((m) => m[1])
  );
  assert.ok(declared.size > 20, 'could not read the SDK parameter list');

  const params = sessionParams(
    [{ sku: 'castano-200g', qty: 1, grind: 'Whole Beans' }], 1490, ORIGIN, { fnfCode: 'FAMILY26' }
  );
  const unknown = Object.keys(params).filter((k) => !declared.has(k));
  assert.deepEqual(unknown, [], `Stripe would refuse: ${unknown.join(', ')}`);
});

test('the checkout client does not pin a version older than its parameters', () => {
  const src = readFileSync(SRC, 'utf8');
  const pinned = src.match(/new Stripe\([^)]*apiVersion:\s*'([^']+)'/);
  if (!pinned) return;           // unpinned: the SDK sends its own, which is the point

  let sdk;
  try {
    sdk = readFileSync(SDK_VERSION, 'utf8').match(/ApiVersion = '([^']+)'/);
  } catch {
    return;
  }
  assert.equal(pinned[1], sdk && sdk[1],
    'a pinned version that is not the SDK\'s own accepts a different set of parameters');
});

/**
 * Checks on the checkout session builder, run with:
 *
 *     node --test netlify/functions/create-checkout-session.test.mjs
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
process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';

const { parseCart, parseCode, subtotalRappen, shippingOption, sessionParams } =
  await import('./create-checkout-session.mjs');
const { FNF_CATALOGUE } = await import('./fnf.mjs');

const PRICES = {
  price_test_200: { id: 'price_test_200', unit_amount: 1490, currency: 'chf' },
  price_test_500: { id: 'price_test_500', unit_amount: 2990, currency: 'chf' },
};

/* The Family & Friends amounts, as they exist in Stripe. */
const FNF_PRICES = {
  price_fnf_200: { id: 'price_fnf_200', unit_amount: 1100, currency: 'chf' },
  price_fnf_500: { id: 'price_fnf_500', unit_amount: 2000, currency: 'chf' },
};

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

test('an amount sent by the client is ignored entirely', () => {
  const lines = parseCart({
    items: [{ sku: 'castano-200g', qty: 2, price: 0.01, unit_amount: 1, amount_total: 1 }],
  });
  assert.deepEqual(lines, [{ sku: 'castano-200g', qty: 2, grind: 'Whole Beans' }]);
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

test('shipping is decided by the regular subtotal, so family still ships free', () => {
  /* Two 500 g bags: CHF 59.80 at the shelf price, CHF 40.00 with the code.
     The threshold is measured against 5980, so postage stays free. */
  const lines = parseCart({ items: [{ sku: 'castano-500g', qty: 2 }] });
  const regular = subtotalRappen(lines, PRICES);
  const special = subtotalRappen(lines, FNF_PRICES, FNF_CATALOGUE());
  assert.equal(regular, 5980);
  assert.equal(special, 4000);
  const p = sessionParams(lines, regular, 'https://worldofzuno.com', 'FAMILY26');
  assert.equal(p.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
  // measured the other way it would have cost the customer CHF 7
  assert.equal(shippingOption(special).shipping_rate_data.fixed_amount.amount, 700);
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

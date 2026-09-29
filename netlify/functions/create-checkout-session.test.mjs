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
process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';

const { parseCart, subtotalRappen, shippingOption, sessionParams } =
  await import('./create-checkout-session.mjs');

const PRICES = {
  price_test_200: { id: 'price_test_200', unit_amount: 1490, currency: 'chf' },
  price_test_500: { id: 'price_test_500', unit_amount: 2990, currency: 'chf' },
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
  assert.equal(shippingOption(4499).shipping_rate_data.fixed_amount.amount, 490);
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

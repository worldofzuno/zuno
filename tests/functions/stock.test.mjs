/**
 * Checks on the stock count, run with:
 *
 *     node --test tests/functions/stock.test.mjs
 *
 * Two things matter. A shop that never sets a number must behave exactly as
 * it did before this existed — an inventory nobody maintains is not a
 * safeguard, it is a way to refuse orders you could have filled. And the
 * last bag must not be sold twice while someone is still typing their card
 * number.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useMemoryStore, store } = await import('../../netlify/functions/lib/store.mjs');
const st = await import('../../netlify/functions/lib/stock.mjs');

const quiet = async (fn) => {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
};

const fresh = async (qty) => {
  useMemoryStore();
  if (qty !== undefined) await st.setQty('castano-200g', qty);
};

const left = async (sku = 'castano-200g') => st.availableQty(await st.read(sku));

/* -------------------------------------------------------- not set at all */

test('a size with no number set has no limit', async () => {
  useMemoryStore();
  assert.deepEqual(await st.levels(), { 'castano-200g': null, 'castano-500g': null });
  const r = await st.hold('castano-200g', 'cs_1', 9999);
  assert.deepEqual([r.ok, r.unlimited, r.held], [true, true, 0]);
});

test('an unlimited size holds nothing, settles nothing, releases nothing', async () => {
  useMemoryStore();
  await st.hold('castano-200g', 'cs_1', 5);
  assert.equal(await st.settle('castano-200g', 'cs_1', 5), 'untracked');
  assert.equal(await st.release('castano-200g', 'cs_1'), 'untracked');
  assert.equal(await left(), null);
});

test('a whole cart of unlimited sizes always goes through', async () => {
  useMemoryStore();
  const r = await st.holdCart([
    { sku: 'castano-200g', qty: 50 }, { sku: 'castano-500g', qty: 50 },
  ], 'cs_1');
  assert.deepEqual(r, { ok: true, held: [] });
});

test('a gift card is never counted', async () => {
  await fresh(1);
  const r = await st.holdCart([{ sku: 'gift-50', qty: 99 }], 'cs_1');
  assert.equal(r.ok, true);
  assert.equal(await left(), 1, 'a gift card has no shelf');
});

/* --------------------------------------------------------- setting a number */

test('a number can be set, changed and taken away again', async () => {
  useMemoryStore();
  assert.deepEqual(await st.setQty('castano-200g', 12), { ok: true, qty: 12 });
  assert.equal(await left(), 12);
  await st.setQty('castano-200g', 3);
  assert.equal(await left(), 3);
  assert.deepEqual(await st.setQty('castano-200g', null), { ok: true, qty: null });
  assert.equal(await left(), null, 'back to unlimited');
});

test('zero is a number, and it means sold out', async () => {
  await fresh(0);
  assert.equal(await left(), 0);
  assert.equal((await st.hold('castano-200g', 'cs_1', 1)).ok, false);
});

test('nonsense is refused rather than stored', async () => {
  useMemoryStore();
  for (const bad of [-1, 1.5, 0.5, 100001, NaN, 'lots', undefined, {}, [], '', '  ', true, false]) {
    assert.equal((await st.setQty('castano-200g', bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal((await st.setQty('gift-50', 5)).reason, 'unknown-sku');
  assert.equal(await left(), null, 'nothing of that must have been written');
});

test('changing the number keeps the holds standing', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'cs_1', 4);
  await st.setQty('castano-200g', 20);
  assert.equal(await left(), 16, 'four are still spoken for');
});

/* ---------------------------------------------------------------- holding */

test('a hold takes bags out of reach without selling them', async () => {
  await fresh(10);
  assert.deepEqual(await st.hold('castano-200g', 'cs_1', 3), { ok: true, held: 3, unlimited: false });
  assert.equal(await left(), 7);
  assert.equal((await st.read('castano-200g')).qty, 10, 'nothing has left the shelf yet');
});

test('more than there are is refused, and says how many there are', async () => {
  await fresh(2);
  const r = await st.hold('castano-200g', 'cs_1', 3);
  assert.deepEqual([r.ok, r.reason, r.available], [false, 'short', 2]);
  assert.equal(await left(), 2, 'a refused hold must take nothing');
});

test('the last bag cannot be sold twice', async () => {
  await fresh(1);
  assert.equal((await st.hold('castano-200g', 'cs_a', 1)).ok, true);
  assert.equal((await st.hold('castano-200g', 'cs_b', 1)).ok, false);
});

test('five checkouts racing for three bags share them out exactly', async () => {
  await fresh(3);
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => st.hold('castano-200g', 'cs_' + i, 1))
  );
  assert.equal(results.filter((r) => r.ok).length, 3, 'never more than the shelf holds');
  assert.equal(await left(), 0);
});

test('the same checkout asking twice gets the same hold', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'cs_1', 3);
  const again = await st.hold('castano-200g', 'cs_1', 3);
  assert.equal(again.held, 3);
  assert.equal(await left(), 7, 'only one hold may stand');
});

test('a hold nobody resolved stops stranding the stock', async () => {
  await fresh(5);
  const t0 = Date.now();
  await st.hold('castano-200g', 'cs_lost', 5, t0);
  assert.equal(st.availableQty(await st.read('castano-200g'), t0), 0);
  const later = t0 + st.HOLD_TTL_MS + 1000;
  assert.equal(st.availableQty(await st.read('castano-200g'), later), 5);
});

/* --------------------------------------------------------------- settling */

test('settling takes the bags off the shelf for good', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'cs_1', 3);
  assert.equal(await st.settle('castano-200g', 'cs_1'), 'settled');
  assert.equal((await st.read('castano-200g')).qty, 7);
  assert.equal(await left(), 7);
});

test('a replayed webhook settles once', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'cs_1', 3);
  assert.equal(await st.settle('castano-200g', 'cs_1'), 'settled');
  assert.equal(await st.settle('castano-200g', 'cs_1'), 'already');
  assert.equal((await st.read('castano-200g')).qty, 7, 'the shelf may only be debited once');
});

test('a payment landing after its hold expired still takes the bags', async () => {
  await fresh(5);
  const t0 = Date.now();
  await st.hold('castano-200g', 'cs_slow', 2, t0);
  const late = t0 + st.HOLD_TTL_MS + 1000;
  assert.equal(await quiet(() => st.settle('castano-200g', 'cs_slow', 2, late)), 'settled-late');
  assert.equal((await st.read('castano-200g')).qty, 3);
});

test('a count never goes below zero', async () => {
  await fresh(1);
  await quiet(() => st.settle('castano-200g', 'cs_1', 5));
  assert.equal((await st.read('castano-200g')).qty, 0);
});

/* -------------------------------------------------------------- releasing */

test('an abandoned checkout puts the bags back', async () => {
  await fresh(5);
  await st.hold('castano-200g', 'cs_1', 5);
  assert.equal(await left(), 0);
  assert.equal(await st.release('castano-200g', 'cs_1'), 'released');
  assert.equal(await left(), 5);
});

test('what was sold is not released by a late expiry', async () => {
  await fresh(5);
  await st.hold('castano-200g', 'cs_1', 2);
  await st.settle('castano-200g', 'cs_1');
  assert.equal(await st.release('castano-200g', 'cs_1'), 'already-sold');
  assert.equal((await st.read('castano-200g')).qty, 3, 'sold bags must not come back');
});

/* ------------------------------------------------------------ whole carts */

test('a cart is held whole or not at all', async () => {
  useMemoryStore();
  await st.setQty('castano-200g', 5);
  await st.setQty('castano-500g', 1);

  const r = await st.holdCart([
    { sku: 'castano-200g', qty: 2 }, { sku: 'castano-500g', qty: 3 },
  ], 'cs_1');
  assert.deepEqual([r.ok, r.sku, r.available], [false, 'castano-500g', 1]);
  assert.equal(await left('castano-200g'), 5,
    'the line that fitted must be given back, or the shop leaks stock on every failed cart');
});

test('a cart that fits is held, settled and reflected in both counts', async () => {
  useMemoryStore();
  await st.setQty('castano-200g', 5);
  await st.setQty('castano-500g', 4);
  const lines = [{ sku: 'castano-200g', qty: 2 }, { sku: 'castano-500g', qty: 1 }];

  assert.equal((await st.holdCart(lines, 'cs_1')).ok, true);
  assert.deepEqual(await st.levels(), { 'castano-200g': 3, 'castano-500g': 3 });

  await st.settleCart(lines, 'cs_1');
  assert.deepEqual(await st.levels(), { 'castano-200g': 3, 'castano-500g': 3 });
  assert.equal((await st.read('castano-200g')).qty, 3, 'and the shelf itself is down');
});

test('releasing a cart gives every line back', async () => {
  useMemoryStore();
  await st.setQty('castano-200g', 5);
  await st.setQty('castano-500g', 4);
  const lines = [{ sku: 'castano-200g', qty: 2 }, { sku: 'castano-500g', qty: 1 }];
  await st.holdCart(lines, 'cs_1');
  await st.releaseCart(lines, 'cs_1');
  assert.deepEqual(await st.levels(), { 'castano-200g': 5, 'castano-500g': 4 });
});

test('a mixed cart counts the coffee and ignores the gift card', async () => {
  useMemoryStore();
  await st.setQty('castano-200g', 2);
  const lines = [{ sku: 'gift-50', qty: 5 }, { sku: 'castano-200g', qty: 2 }];
  assert.equal((await st.holdCart(lines, 'cs_1')).ok, true);
  assert.equal(await left(), 0);
  await st.settleCart(lines, 'cs_1');
  assert.equal((await st.read('castano-200g')).qty, 0);
});

test('a whole number typed as a string is still a whole number', async () => {
  useMemoryStore();
  assert.deepEqual(await st.setQty('castano-200g', '12'), { ok: true, qty: 12 });
  assert.equal(await left(), 12);
});

/* ------------------------------------------------- which order took it --- */

/**
 * The ledger used to record only `ref`, the internal hold reference, which
 * answers nothing when somebody asks which order took the last bag. The
 * gift card ledger had the same hole and it was closed there first.
 */
test('a sale records the order it belonged to', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'pre_abc', 2);
  assert.equal(await st.settle('castano-200g', 'pre_abc', 2, Date.now(), 'cs_test_ORDER01'), 'settled');

  const rec = await st.read('castano-200g');
  assert.equal(rec.sold.pre_abc.qty, 2);
  assert.equal(rec.sold.pre_abc.order, 'cs_test_ORDER01');
});

test('a sale with no order recorded says nothing rather than null', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'pre_def', 1);
  await st.settle('castano-200g', 'pre_def', 1);

  const rec = await st.read('castano-200g');
  assert.equal('order' in rec.sold.pre_def, false,
    'an entry without one reads as absent, not as an order called null');
});

test('the whole cart carries the same order number', async () => {
  useMemoryStore();
  await st.setQty('castano-200g', 10);
  await st.setQty('castano-500g', 10);
  const lines = [{ sku: 'castano-200g', qty: 1 }, { sku: 'castano-500g', qty: 2 }];
  await st.holdCart(lines, 'pre_cart');
  await st.settleCart(lines, 'pre_cart', Date.now(), 'cs_test_CART01');

  for (const sku of ['castano-200g', 'castano-500g']) {
    const rec = await st.read(sku);
    assert.equal(rec.sold.pre_cart.order, 'cs_test_CART01', `${sku} knows its order`);
  }
});

/* ------------------------------------------- when an order is refunded --- */

test('a refunded order puts the bags back', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'pre_ref', 3);
  await st.settle('castano-200g', 'pre_ref', 3, Date.now(), 'cs_order');
  assert.equal(await left(), 7);

  const r = await st.unsettle('castano-200g', 'pre_ref');
  assert.equal(r.outcome, 'returned');
  assert.equal(r.qty, 3);
  assert.equal(await left(), 10);
});

test('the return is written down, and happens once', async () => {
  await fresh(10);
  await st.hold('castano-200g', 'pre_ref', 2);
  await st.settle('castano-200g', 'pre_ref', 2);

  assert.equal((await st.unsettle('castano-200g', 'pre_ref')).outcome, 'returned');
  assert.equal((await st.unsettle('castano-200g', 'pre_ref')).outcome, 'already');
  assert.equal(await left(), 10, 'not 12');

  const rec = await st.read('castano-200g');
  assert.equal(rec.sold.pre_ref.qty, 2, 'the sale is still readable');
  assert.equal(rec.sold.pre_ref.reversed.reason, 'refunded');
});

test('an untracked size has nothing to give back', async () => {
  useMemoryStore();
  assert.equal((await st.unsettle('castano-200g', 'pre_x')).outcome, 'untracked');
});

test('the whole cart comes back together', async () => {
  useMemoryStore();
  await st.setQty('castano-200g', 10);
  await st.setQty('castano-500g', 10);
  const lines = [{ sku: 'castano-200g', qty: 1 }, { sku: 'castano-500g', qty: 2 }];
  await st.holdCart(lines, 'pre_cart');
  await st.settleCart(lines, 'pre_cart', Date.now(), 'cs_order');
  await st.unsettleCart(lines, 'pre_cart');

  assert.equal(await left('castano-200g'), 10);
  assert.equal(await left('castano-500g'), 10);
});

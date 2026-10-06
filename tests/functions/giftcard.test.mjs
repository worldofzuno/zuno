/**
 * Checks on gift cards, run with:
 *
 *     node --test tests/functions/giftcard.test.mjs
 *
 * A gift card is money, so the tests are about the ways money goes wrong: the
 * same balance spent twice, a balance frozen by a hold nobody released, a
 * replayed webhook minting a second card, an amount that drifts through a
 * float. None of those may be possible.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useMemoryStore, store } = await import('../../netlify/functions/lib/store.mjs');
const gc = await import('../../netlify/functions/lib/giftcard.mjs');

const quiet = async (fn) => {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
};

/** A card worth `amount`, in a clean store. */
async function card(amount = 5000) {
  useMemoryStore();
  return gc.issue({ amount, issuedFor: 'cs_buy_1' });
}

/* ------------------------------------------------------------ the code --- */

test('a code reads and types cleanly', () => {
  /* Many codes, not one: a single draw misses a forbidden character about
     two times in three and would pass by luck. */
  for (let i = 0; i < 2000; i++) {
    const c = gc.newCode();
    assert.match(c, /^ZG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/, c);
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      assert.ok(!c.slice(3).includes(bad), `${bad} must not appear in a code: ${c}`);
    }
  }
});

test('every character of the alphabet can actually come up', () => {
  /* A generator that quietly never emits its last character has a smaller
     search space than it claims. */
  const seen = new Set();
  for (let i = 0; i < 5000; i++) for (const ch of gc.newCode().slice(3).replace(/-/g, '')) seen.add(ch);
  assert.equal(seen.size, 31, [...seen].sort().join(''));
});

test('codes do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(gc.newCode());
  assert.equal(seen.size, 500);
});

test('a code is recognised however it was typed', async () => {
  const c = await card();
  for (const typed of [c.code, c.code.toLowerCase(), c.code.replace(/-/g, ''),
                       ' ' + c.code.replace(/-/g, ' ') + ' ']) {
    assert.ok(gc.looksLikeCode(typed), `${JSON.stringify(typed)} must be recognised`);
    assert.ok(await gc.load(typed), `${JSON.stringify(typed)} must find the card`);
  }
});

test('something that is not a code is refused before it reaches the store', () => {
  for (const bad of ['', 'ZG', 'FAMILY26', 'ZG-0000-0000-0000', 'ZG-ABCD-EFGH-JKLMN', null, 42]) {
    assert.equal(gc.looksLikeCode(bad), false, `${JSON.stringify(bad)} must not look like a code`);
  }
});

test('an unknown code loads as nothing rather than throwing', async () => {
  useMemoryStore();
  assert.equal(await gc.load('ZG-2222-3333-4444'), null);
  assert.equal(await gc.load('rubbish'), null);
});

/* ------------------------------------------------------------- issuing --- */

test('a new card is worth what was paid, and nothing is spent', async () => {
  const c = await card(5000);
  assert.equal(c.issued, 5000);
  assert.equal(gc.available(c), 5000);
  assert.equal(gc.spent(c), 0);
  assert.equal(c.currency, 'chf');
});

test('an amount that is not a positive whole number is refused', async () => {
  useMemoryStore();
  for (const bad of [0, -100, NaN, null, undefined, 'fifty']) {
    await assert.rejects(() => gc.issue({ amount: bad, issuedFor: 'x' }), /positive amount/);
  }
});

test('the same purchase does not mint a second card', async () => {
  useMemoryStore();
  const first = await gc.issue({ amount: 5000, issuedFor: 'cs_once' });
  // the caller checks before issuing; this is the check
  const found = await gc.cardFor('cs_once');
  assert.equal(found.code, first.code);
  assert.equal(await gc.cardFor('cs_never'), null);
});

test('what a customer is shown is the balance, not the ledger', async () => {
  const c = await card(5000);
  const v = gc.publicView(c);
  assert.deepEqual(Object.keys(v).sort(), ['balance', 'code', 'currency', 'issued']);
  assert.equal(v.currency, 'CHF');
  assert.equal(v.balance, 5000);
});

/* --------------------------------------------------------------- holds --- */

test('a hold takes the balance out of reach without spending it', async () => {
  const c = await card(5000);
  const h = await gc.hold(c.code, 'cs_1', 2000);
  assert.deepEqual([h.ok, h.amount], [true, 2000]);

  const after = await gc.load(c.code);
  assert.equal(gc.available(after), 3000);
  assert.equal(gc.spent(after), 0, 'a hold is not a spend');
});

test('a hold is capped at what the card has', async () => {
  const c = await card(3000);
  const h = await gc.hold(c.code, 'cs_1', 9999);
  assert.equal(h.amount, 3000, 'the caller must use what came back, not what it asked for');
  assert.equal(gc.available(await gc.load(c.code)), 0);
});

test('the same balance cannot be held twice', async () => {
  const c = await card(5000);
  assert.equal((await gc.hold(c.code, 'cs_1', 5000)).amount, 5000);
  const second = await gc.hold(c.code, 'cs_2', 5000);
  assert.deepEqual([second.ok, second.reason, second.amount], [false, 'empty', 0]);
});

test('five checkouts racing for one balance share it out exactly', async () => {
  const c = await card(5000);
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => gc.hold(c.code, 'cs_' + i, 2000))
  );
  const total = results.reduce((t, r) => t + r.amount, 0);
  assert.equal(total, 5000, 'a race must never hand out more than the card holds');
  assert.equal(gc.available(await gc.load(c.code)), 0);
});

test('the same session asking twice gets the same hold, not a second one', async () => {
  const c = await card(5000);
  const a = await gc.hold(c.code, 'cs_1', 2000);
  const b = await gc.hold(c.code, 'cs_1', 2000);
  assert.equal(a.amount, 2000);
  assert.equal(b.amount, 2000);
  assert.equal(gc.available(await gc.load(c.code)), 3000, 'only one hold may stand');
});

test('a hold nobody ever settled stops freezing the balance', async () => {
  const c = await card(5000);
  const t0 = Date.now();
  await gc.hold(c.code, 'cs_lost', 5000, t0);
  const later = t0 + gc.HOLD_TTL_MS + 1000;
  assert.equal(gc.available(await gc.load(c.code), t0), 0);
  assert.equal(gc.available(await gc.load(c.code), later), 5000, 'a stale hold must expire');
});

test('holding on an unknown or empty code says which', async () => {
  const c = await card(1000);
  assert.equal((await gc.hold('ZG-2222-3333-4444', 'cs_1', 100)).reason, 'unknown');
  assert.equal((await gc.hold('rubbish', 'cs_1', 100)).reason, 'unknown');
  assert.equal((await gc.hold(c.code, 'cs_1', 0)).reason, 'nothing-to-hold');
});

/* ------------------------------------------------------------- settling --- */

test('settling turns a hold into a spend', async () => {
  const c = await card(5000);
  await gc.hold(c.code, 'cs_1', 2000);
  const r = await gc.settle(c.code, 'cs_1');
  assert.deepEqual([r.outcome, r.amount], ['settled', 2000]);

  const after = await gc.load(c.code);
  assert.equal(gc.spent(after), 2000);
  assert.equal(gc.available(after), 3000, 'the rest is still there to spend');
});

test('a spend says which order took the money', async () => {
  const c = await card(5000);
  await gc.hold(c.code, 'pre_abc', 2000);
  await gc.settle(c.code, 'pre_abc', 0, Date.now(), 'cs_test_12345');

  const after = await gc.load(c.code);
  assert.equal(after.spends['pre_abc'].order, 'cs_test_12345',
    'the ledger is keyed by the hold reference, which answers nothing on its own');
  assert.equal(after.spends['pre_abc'].amount, 2000);
});

test('a spend with no order given is still a spend', async () => {
  const c = await card(5000);
  await gc.hold(c.code, 'pre_abc', 2000);
  await gc.settle(c.code, 'pre_abc');

  const spend = (await gc.load(c.code)).spends['pre_abc'];
  assert.equal(spend.amount, 2000);
  assert.equal('order' in spend, false, 'absent, not an empty string pretending to be one');
});

test('a replayed webhook settles once', async () => {
  const c = await card(5000);
  await gc.hold(c.code, 'cs_1', 2000);
  assert.equal((await gc.settle(c.code, 'cs_1')).outcome, 'settled');
  const again = await gc.settle(c.code, 'cs_1');
  assert.deepEqual([again.outcome, again.amount], ['already', 2000]);
  assert.equal(gc.spent(await gc.load(c.code)), 2000, 'the card may only be debited once');
});

test('a payment that lands after its hold expired is still recorded', async () => {
  const c = await card(5000);
  const t0 = Date.now();
  await gc.hold(c.code, 'cs_slow', 2000, t0);
  const late = t0 + gc.HOLD_TTL_MS + 1000;
  const r = await quiet(() => gc.settle(c.code, 'cs_slow', 2000, late));
  assert.equal(r.outcome, 'settled-late');
  assert.equal(r.amount, 2000);
  assert.equal(gc.spent(await gc.load(c.code)), 2000, 'money taken must appear in the ledger');
});

test('a balance can never read below zero, even overdrawn', async () => {
  const c = await card(1000);
  await quiet(() => gc.settle(c.code, 'cs_a', 1500));   // more than the card holds
  const after = await gc.load(c.code);
  assert.equal(gc.spent(after), 1500);
  assert.equal(gc.available(after), 0, 'never a negative balance on the shop floor');
});

test('settling an unknown code or nothing at all is harmless', async () => {
  const c = await card(1000);
  assert.equal((await gc.settle('ZG-2222-3333-4444', 'cs_1')).outcome, 'unknown');
  assert.equal((await gc.settle(c.code, 'cs_never')).outcome, 'nothing');
});

/* ------------------------------------------------------------ releasing --- */

test('an abandoned checkout gives the money back', async () => {
  const c = await card(5000);
  await gc.hold(c.code, 'cs_1', 5000);
  assert.equal(gc.available(await gc.load(c.code)), 0);
  assert.equal(await gc.release(c.code, 'cs_1'), 'released');
  assert.equal(gc.available(await gc.load(c.code)), 5000);
});

test('a spend is not released by a late expiry event', async () => {
  const c = await card(5000);
  await gc.hold(c.code, 'cs_1', 2000);
  await gc.settle(c.code, 'cs_1');
  assert.equal(await gc.release(c.code, 'cs_1'), 'already-spent');
  assert.equal(gc.spent(await gc.load(c.code)), 2000, 'paid money must not come back');
});

test('releasing what was never held is harmless', async () => {
  const c = await card(5000);
  assert.equal(await gc.release(c.code, 'cs_nope'), 'no-hold');
  assert.equal(await gc.release('ZG-2222-3333-4444', 'cs_1'), 'unknown');
});

/* ----------------------------------------------------------- arithmetic --- */

test('a card spent down in pieces lands on exactly zero', async () => {
  const c = await card(5000);
  for (const [i, amount] of [1990, 1990, 1020].entries()) {
    await gc.hold(c.code, 'cs_' + i, amount);
    await gc.settle(c.code, 'cs_' + i);
  }
  const after = await gc.load(c.code);
  assert.equal(gc.spent(after), 5000);
  assert.equal(gc.available(after), 0);
});

test('amounts stay whole rappen', async () => {
  useMemoryStore();
  const c = await gc.issue({ amount: 1499.7, issuedFor: 'cs_x' });
  assert.equal(c.issued, 1499, 'truncated, never rounded up into money nobody paid');
  const h = await gc.hold(c.code, 'cs_1', 10.9);
  assert.equal(h.amount, 10);
  assert.equal(Number.isInteger(gc.available(await gc.load(c.code))), true);
});

test('test and live cards are distinguishable', async () => {
  useMemoryStore();
  const t = await gc.issue({ amount: 1000, issuedFor: 'cs_t', livemode: false });
  const l = await gc.issue({ amount: 1000, issuedFor: 'cs_l', livemode: true });
  assert.equal(t.livemode, false);
  assert.equal(l.livemode, true);
});

/* ------------------------------------------- when an order is refunded --- */

test('a refunded order gives the credit back', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gc.hold(card.code, 'cs_order', 2000);
  await gc.settle(card.code, 'cs_order', 0, Date.now(), 'cs_order');
  assert.equal(gc.available(await gc.load(card.code)), 3000, 'spent, as it should be');

  const r = await gc.unsettle(card.code, 'cs_order');
  assert.equal(r.outcome, 'reversed');
  assert.equal(r.amount, 2000);
  assert.equal(gc.available(await gc.load(card.code)), 5000, 'and back again');
});

test('the reversal is written down, not erased', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gc.hold(card.code, 'cs_order', 2000);
  await gc.settle(card.code, 'cs_order', 0, Date.now(), 'cs_order');
  await gc.unsettle(card.code, 'cs_order', 'refunded');

  const after = await gc.load(card.code);
  const spend = after.spends.cs_order;
  assert.equal(spend.amount, 2000, 'the spend is still there to read');
  assert.equal(spend.reversed.reason, 'refunded');
  assert.ok(spend.reversed.at, 'and when');
});

test('reversing twice is reversing once, because Stripe redelivers', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gc.hold(card.code, 'cs_order', 2000);
  await gc.settle(card.code, 'cs_order', 0, Date.now(), 'cs_order');

  assert.equal((await gc.unsettle(card.code, 'cs_order')).outcome, 'reversed');
  assert.equal((await gc.unsettle(card.code, 'cs_order')).outcome, 'already');
  assert.equal(gc.available(await gc.load(card.code)), 5000, 'not 7000');
});

test('there is nothing to reverse on an order that never spent anything', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  assert.equal((await gc.unsettle(card.code, 'cs_nothing')).outcome, 'no-spend');
  assert.equal((await gc.unsettle('ZG-0000-0000-0000', 'cs_x')).outcome, 'unknown');
});

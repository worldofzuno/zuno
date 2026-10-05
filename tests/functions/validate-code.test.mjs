/**
 * Checks on the code-validation endpoint, run with:
 *
 *     node --test tests/functions/validate-code.test.mjs
 *
 * This endpoint exists so the cart can show the price it will be charged. It
 * must therefore never report a reduction it cannot back up — an unconfigured
 * price, an expired code or a Stripe outage all have to come back as a
 * refusal, not as a cheaper cart.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
process.env.STRIPE_PRICE_FNF_CASTANO_200G = 'price_fnf_200';
process.env.STRIPE_PRICE_FNF_CASTANO_500G = 'price_fnf_500';
process.env.FNF_CODES = JSON.stringify([
  { code: 'FAMILY26' },
  { code: 'GONE', expires: '2020-01-01' },
  { code: 'CAPPED', maxRedemptions: 2 },
]);

const { resetLimiter } = await import('../../netlify/functions/lib/fnf.mjs');
const mod = await import('../../netlify/functions/validate-code.mjs');
const { check } = mod;
const handler = mod.default;

/* Stripe stands in for the network. The price amounts are the real sandbox
   ones, so what this asserts is what the shop would display. */
const AMOUNTS = { price_fnf_200: 1100, price_fnf_500: 2000 };

function fakeStripe({ amounts = AMOUNTS, succeeded = 0, searchThrows = false } = {}) {
  return {
    prices: {
      retrieve: async (id) => {
        if (!(id in amounts)) throw new Error(`no such price: ${id}`);
        const a = amounts[id];
        return typeof a === 'object' ? { id, ...a } : { id, unit_amount: a, currency: 'chf' };
      },
    },
    paymentIntents: {
      search: async () => {
        if (searchThrows) throw new Error('search is down');
        return { data: Array(succeeded).fill({ id: 'pi' }), next_page: null };
      },
    },
  };
}

const post = (body, ip = '1.1.1.1') =>
  handler(new Request('https://worldofzuno.com/.netlify/functions/validate-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));

/* The decision, without the HTTP wrapper. */
const ask = (code, stub = fakeStripe()) => check(stub, code);

/* ------------------------------------------------------------- the basics */

test('anything but POST is refused', async () => {
  const res = await handler(new Request('https://worldofzuno.com/x', { method: 'GET' }));
  assert.equal(res.status, 405);
});

test('a body that is not JSON is a client error, not a bad code', async () => {
  resetLimiter();
  const res = await post('not json');
  assert.equal(res.status, 400);
});

test('nothing is cached, because a code can stop being valid', async () => {
  resetLimiter();
  const res = await post({ code: 'ZUNO15' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

/* ------------------------------------------------------------- the answers */

test('a valid code answers with the amounts Stripe holds', async () => {
  const body = await ask('FAMILY26');
  assert.equal(body.valid, true);
  assert.equal(body.kind, 'fnf');
  assert.equal(body.currency, 'chf');
  assert.deepEqual(body.prices, { 'castano-200g': 1100, 'castano-500g': 2000 });
});

test('the code is accepted as typed, spacing and case included', async () => {
  for (const typed of ['family26', ' FAMILY 26 ', 'Family26']) {
    const body = await ask(typed);
    assert.equal(body.valid, true, `${JSON.stringify(typed)} must be accepted`);
  }
});

test('an unknown code is refused with something a customer can read', async () => {
  const body = await ask('ZUNO15');
  assert.equal(body.valid, false);
  assert.equal(body.reason, 'unknown');
  assert.ok(body.message && body.message.length > 0);
});

test('an expired code is refused, and says so', async () => {
  const body = await ask('GONE');
  assert.equal(body.valid, false);
  assert.equal(body.reason, 'expired');
});

test('a code at its limit is refused', async () => {
  const body = await ask('CAPPED', fakeStripe({ succeeded: 2 }));
  assert.equal(body.valid, false);
  assert.equal(body.reason, 'exhausted');
});

test('a code below its limit is still good', async () => {
  const body = await ask('CAPPED', fakeStripe({ succeeded: 1 }));
  assert.equal(body.valid, true);
});

test('an empty field is not a wrong code', async () => {
  assert.equal((await ask('')).reason, 'empty');
  assert.equal((await ask(undefined)).reason, 'empty');
});

/* ---------------------------------------- never a reduction we cannot keep */

test('a valid code with no prices behind it is refused rather than applied', async () => {
  delete process.env.STRIPE_PRICE_FNF_CASTANO_500G;
  try {
    const body = await ask('FAMILY26');
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'unconfigured');
  } finally {
    process.env.STRIPE_PRICE_FNF_CASTANO_500G = 'price_fnf_500';
  }
});

test('a price in the wrong currency throws rather than being displayed', async () => {
  const broken = fakeStripe({
    amounts: { price_fnf_200: { unit_amount: 1100, currency: 'eur' }, price_fnf_500: 2000 },
  });
  await assert.rejects(() => ask('FAMILY26', broken), /unusable/);
});

test('a price that is missing in Stripe throws rather than being displayed', async () => {
  await assert.rejects(() => ask('FAMILY26', fakeStripe({ amounts: {} })), /no such price/);
});

test('an unreadable price becomes a 502, not a cheap cart', async () => {
  resetLimiter();
  const real = console.error;
  console.error = () => {};
  try {
    /* The handler builds a real Stripe client with a key that is not one, so
       the price lookup fails the way an outage would. */
    const res = await post({ code: 'FAMILY26' });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.valid, undefined, 'a failure must never read as valid');
  } finally {
    console.error = real;
  }
});

test('no reply ever carries the configured codes or a secret', async () => {
  const ok = await ask('FAMILY26');
  const bad = await ask('WRONG-GUESS');
  for (const body of [ok, bad]) {
    const blob = JSON.stringify(body);
    assert.ok(!blob.includes('CAPPED'));
    assert.ok(!blob.includes('GONE'));
    assert.ok(!blob.includes('sk_test'));
    assert.ok(!blob.includes('price_fnf'));
  }
  // and a wrong guess is not told which codes exist
  assert.equal(bad.kind, null);
});

/* --------------------------------------------------------------- the limit */

test('a client guessing repeatedly is slowed down', async () => {
  resetLimiter();
  for (let i = 0; i < 10; i++) {
    const res = await post({ code: 'GUESS-' + i }, '9.9.9.9');
    assert.equal(res.status, 200, `attempt ${i + 1} should still be answered`);
  }
  const blocked = await post({ code: 'GUESS-11' }, '9.9.9.9');
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.valid, false);
  // someone else is not punished for it
  const other = await post({ code: 'ANOTHER-GUESS' }, '8.8.8.8');
  assert.equal(other.status, 200);
});

/* --------------------------------------------------------- gift cards */

const { useMemoryStore } = await import('../../netlify/functions/lib/store.mjs');
const gc = await import('../../netlify/functions/lib/giftcard.mjs');

test('a gift card answers with its balance, and says it is a gift card', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  const body = await check(fakeStripe(), card.code);
  assert.equal(body.valid, true);
  assert.equal(body.kind, 'gift');
  assert.equal(body.balance, 5000);
  assert.equal(body.code, card.code);
});

test('a partly spent card reports what is left, not what it was', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  await gc.hold(card.code, 'cs_x', 2000);
  await gc.settle(card.code, 'cs_x');
  assert.equal((await check(fakeStripe(), card.code)).balance, 3000);
});

test('a card held by another checkout is not offered twice', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  await gc.hold(card.code, 'cs_elsewhere', 5000);
  const body = await check(fakeStripe(), card.code);
  assert.equal(body.valid, false);
  assert.equal(body.reason, 'empty');
});

test('a gift card is recognised however it was typed', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  for (const typed of [card.code.toLowerCase(), card.code.replace(/-/g, ''), ' ' + card.code + ' ']) {
    assert.equal((await check(fakeStripe(), typed)).valid, true, typed);
  }
});

test('a gift card that does not exist is answered as a gift card, not as a voucher', async () => {
  useMemoryStore();
  const body = await check(fakeStripe(), 'ZG-2345-6789-ABCD');
  assert.equal(body.valid, false);
  assert.equal(body.kind, 'gift', 'the message must be about the thing the customer typed');
});

test('a voucher code is still a voucher code', async () => {
  useMemoryStore();
  const body = await check(fakeStripe(), 'FAMILY26');
  assert.equal(body.kind, 'fnf');
  assert.equal(body.valid, true);
});

test('no reply carries the ledger behind a card', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_secret', buyer: 'someone@example.ch' });
  await gc.hold(card.code, 'cs_other', 1000);
  const blob = JSON.stringify(await check(fakeStripe(), card.code));
  for (const leak of ['cs_secret', 'someone@example.ch', 'holds', 'spends', 'issuedFor']) {
    assert.ok(!blob.includes(leak), `a reply must not carry ${leak}`);
  }
});

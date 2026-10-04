/**
 * Checks on the confirmation endpoint, run with:
 *
 *     npm run test:functions
 *
 * The point is narrow: "paid" must mean Stripe says paid. Everything else —
 * a session still clearing, one that expired, a made-up id — must not be
 * able to produce a confirmation, because the page empties a cart on it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';

const { stateOf, publicView } = await import('../functions/checkout-status.mjs');
const handler = (await import('../functions/checkout-status.mjs')).default;

const get = (qs) =>
  handler(new Request('https://worldofzuno.com/.netlify/functions/checkout-status' + qs));

test('paid is the only thing that counts as paid', () => {
  assert.equal(stateOf({ payment_status: 'paid', status: 'complete' }), 'paid');
  assert.equal(stateOf({ payment_status: 'no_payment_required', status: 'complete' }), 'paid');
  assert.equal(stateOf({ payment_status: 'unpaid', status: 'complete' }), 'pending');
  assert.equal(stateOf({ payment_status: 'unpaid', status: 'open' }), 'open');
  assert.equal(stateOf({ payment_status: 'unpaid', status: 'expired' }), 'expired');
  assert.equal(stateOf(null), 'unknown');
});

test('a session still clearing is not a failure and not a success', () => {
  const v = publicView({ payment_status: 'unpaid', status: 'complete', amount_total: 4298, currency: 'chf' });
  assert.equal(v.state, 'pending');
  assert.equal(v.paid, false);
});

test('an amount is only quoted once the money is in', () => {
  const unpaid = publicView({ payment_status: 'unpaid', status: 'open', amount_total: 4298, currency: 'chf' });
  assert.equal(unpaid.total, null);
  assert.equal(unpaid.currency, null);
  const paid = publicView({ payment_status: 'paid', status: 'complete', amount_total: 4298, currency: 'chf' });
  assert.equal(paid.total, '42.98');
  assert.equal(paid.currency, 'CHF');
});

test('nothing personal is ever returned', () => {
  const v = publicView({
    payment_status: 'paid', status: 'complete', amount_total: 4298, currency: 'chf',
    customer_details: { email: 'kundin@example.ch', name: 'A Kundin' },
    collected_information: { shipping_details: { address: { line1: 'Musterweg 1' } } },
    metadata: { lines: '[["castano-200g",1,"Whole Beans"]]' },
  });
  const blob = JSON.stringify(v);
  for (const leak of ['kundin', 'Kundin', 'Musterweg', 'castano', 'Whole Beans']) {
    assert.ok(!blob.includes(leak), `must not return ${leak}`);
  }
  assert.deepEqual(Object.keys(v).sort(), ['currency', 'paid', 'state', 'total']);
});

test('a string that cannot be a session id never reaches Stripe', async () => {
  for (const bad of ['', 'x', 'pi_123', 'cs_test_', 'cs_dev_abcdefghij',
                     '../../secret', 'cs_test_' + 'a'.repeat(700)]) {
    const res = await get('?session_id=' + encodeURIComponent(bad));
    assert.equal(res.status, 400, `${bad} should be refused outright`);
  }
});

test('a plausible id is accepted by the guard', async () => {
  // it will fail later for want of a real key, but not at the guard
  const res = await get('?session_id=cs_test_' + 'a'.repeat(40));
  assert.notEqual(res.status, 400);
});

test('anything but GET is refused', async () => {
  const res = await handler(new Request('https://worldofzuno.com/x', { method: 'POST' }));
  assert.equal(res.status, 405);
});

test('the answer is never cached', async () => {
  const res = await get('?session_id=nope');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

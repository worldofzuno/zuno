/**
 * Checks on the webhook, run with:
 *
 *     node --test netlify/functions/stripe-webhook.test.mjs
 *
 * Two things matter here. Nothing without a valid Stripe signature may be
 * treated as an order — otherwise the endpoint is a public form for
 * inventing them. And a payment that succeeded must produce a record even
 * when the customer never came back to the site, which is the whole reason
 * the webhook exists.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_not_a_real_secret';

const { orderFrom, summarise } = await import('./stripe-webhook.mjs');
const mod = await import('./stripe-webhook.mjs');
const handler = mod.default;

const stripe = new Stripe('sk_test_not_a_real_key', { apiVersion: '2024-06-20' });

/* A session as Stripe returns it once line items and products are expanded. */
const SESSION = {
  id: 'cs_test_paid_1',
  object: 'checkout.session',
  livemode: false,
  payment_status: 'paid',
  currency: 'chf',
  amount_subtotal: 4480,
  amount_total: 4508,   // 4480 - 672 discount + 700 shipping
  total_details: { amount_discount: 672, amount_shipping: 700, amount_tax: 0 },
  metadata: {
    lines: '[["castano-200g",1,"Whole Beans"],["castano-500g",1,"Pre-Ground"]]',
    shipping_threshold: 'before',
  },
  customer_details: { email: 'kundin@example.ch', name: 'A Kundin' },
  collected_information: {
    shipping_details: {
      name: 'A Kundin',
      address: { line1: 'Musterweg 1', postal_code: '3000', city: 'Bern', country: 'CH' },
    },
  },
  line_items: {
    data: [
      {
        description: 'ZUNO Castano — 200 g',
        quantity: 1,
        amount_total: 1490,
        price: { product: { name: 'ZUNO Castano — 200 g', metadata: { sku: 'castano-200g' } } },
      },
      {
        description: 'ZUNO Castano — 500 g',
        quantity: 1,
        amount_total: 2990,
        price: { product: { name: 'ZUNO Castano — 500 g', metadata: { sku: 'castano-500g' } } },
      },
    ],
  },
};

const signed = (body, secret = 'whsec_test_not_a_real_secret', at = Math.floor(Date.now() / 1000)) =>
  stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp: at });

const post = (body, header) =>
  handler(new Request('https://worldofzuno.com/.netlify/functions/stripe-webhook', {
    method: 'POST',
    headers: header ? { 'stripe-signature': header } : {},
    body,
  }));

const eventBody = (type, session = SESSION) =>
  JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), type, data: { object: session } });

/* ------------------------------------------------------------- signature */

test('a request with no signature is refused', async () => {
  const res = await post(eventBody('checkout.session.completed'));
  assert.equal(res.status, 400);
});

test('a forged signature is refused', async () => {
  const body = eventBody('checkout.session.completed');
  const res = await post(body, signed(body, 'whsec_the_wrong_secret'));
  assert.equal(res.status, 400);
});

test('a body altered after signing is refused', async () => {
  const body = eventBody('checkout.session.completed');
  const header = signed(body);
  const tampered = body.replace('4508', '1');
  assert.notEqual(tampered, body);
  const res = await post(tampered, header);
  assert.equal(res.status, 400);
});

test('a replayed signature from long ago is refused', async () => {
  const body = eventBody('checkout.session.completed');
  const old = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
  const res = await post(body, signed(body, undefined, old));
  assert.equal(res.status, 400);
});

test('anything but POST is refused', async () => {
  const res = await handler(new Request('https://worldofzuno.com/x', { method: 'GET' }));
  assert.equal(res.status, 405);
});

/* ------------------------------------------------------- order extraction */

test('the order carries what is needed to pack the parcel', () => {
  const o = orderFrom(SESSION);
  assert.equal(o.paid, true);
  assert.equal(o.currency, 'CHF');
  assert.equal(o.total, '45.08');
  assert.equal(o.subtotal, '44.80');
  assert.equal(o.discount, '6.72');
  assert.equal(o.shipping, '7.00');
  assert.equal(o.email, 'kundin@example.ch');
  assert.equal(o.address.postal_code, '3000');
  assert.deepEqual(o.items.map((i) => [i.sku, i.qty, i.grind]), [
    ['castano-200g', 1, 'Whole Beans'],
    ['castano-500g', 1, 'Pre-Ground'],
  ]);
});

test('the grind survives, because it is not in the price', () => {
  const o = orderFrom(SESSION);
  assert.ok(summarise(o).includes('Pre-Ground'));
  assert.ok(summarise(o).includes('Whole Beans'));
});

test('malformed metadata loses the grind, never the order', () => {
  const o = orderFrom({ ...SESSION, metadata: { lines: 'not json' } });
  assert.equal(o.total, '45.08');
  assert.equal(o.items.length, 2);
  assert.equal(o.items[0].grind, null);
});

test('a session with no shipping details still produces an order', () => {
  const bare = { ...SESSION, collected_information: undefined, shipping_details: undefined };
  const o = orderFrom(bare);
  assert.equal(o.address, null);
  assert.ok(summarise(o).includes('no address'));
});

test('a Family & Friends order says so, because the discount field cannot', () => {
  /* The reduction is a different Price, not a coupon, so total_details shows
     no discount at all. Without the code the books would show a low total
     with nothing to explain it. */
  const fnf = {
    ...SESSION,
    amount_subtotal: 3100,
    amount_total: 3800,
    total_details: { amount_discount: 0, amount_shipping: 700, amount_tax: 0 },
    metadata: { ...SESSION.metadata, fnf_code: 'FAMILY26' },
  };
  const o = orderFrom(fnf);
  assert.equal(o.fnfCode, 'FAMILY26');
  assert.equal(o.discount, '0.00');
  assert.ok(summarise(o).includes('F&F FAMILY26'));
});

test('a regular order carries no code and is not tagged', () => {
  const o = orderFrom(SESSION);
  assert.equal(o.fnfCode, null);
  assert.ok(!summarise(o).includes('F&F'));
});

test('an unpaid session is not an order', () => {
  assert.equal(orderFrom({ ...SESSION, payment_status: 'unpaid' }).paid, false);
});

test('live and test orders are distinguishable', () => {
  assert.equal(orderFrom(SESSION).livemode, false);
  assert.equal(orderFrom({ ...SESSION, livemode: true }).livemode, true);
});

test('amounts are never floated into rounding error', () => {
  const o = orderFrom({ ...SESSION, amount_total: 1, amount_subtotal: 0 });
  assert.equal(o.total, '0.01');
  assert.equal(o.subtotal, '0.00');
});

/* ------------------------------------------------ what happens to an event

   A stub in place of Stripe, so the branch that matters — a paid order — is
   reachable without the network. It also records what was asked for, which
   is how we know the line items were expanded rather than assumed. */

function stub(session) {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        retrieve: async (id, opts) => {
          calls.push({ id, opts });
          return { ...session, id };
        },
      },
    },
  };
}

function captureLog(fn) {
  const lines = [];
  const real = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return Promise.resolve(fn()).finally(() => { console.log = real; }).then((r) => [r, lines]);
}

test('a paid session is read back in full and recorded', async () => {
  const s = stub({ ...SESSION, id: 'cs_paid_a' });
  const [result, lines] = await captureLog(() =>
    mod.handleEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_paid_a' } } }, s));

  assert.equal(result, 'paid');
  // the line items were expanded, not guessed at
  assert.deepEqual(s.calls[0].opts, { expand: ['line_items.data.price.product'] });
  const rec = lines.find((l) => l.startsWith('[order:paid]'));
  assert.ok(rec, 'the order must reach the log even with no endpoint configured');
  assert.ok(rec.includes('CHF 45.08'));
  assert.ok(rec.includes('Pre-Ground'));
  assert.ok(rec.includes('3000'));
});

test('the same session twice is recorded once', async () => {
  const s = stub({ ...SESSION, id: 'cs_paid_dup' });
  const ev = { type: 'checkout.session.completed', data: { object: { id: 'cs_paid_dup' } } };
  assert.equal(await mod.handleEvent(ev, s), 'paid');
  assert.equal(await mod.handleEvent(ev, s), 'duplicate');
});

test('a completed but unpaid session waits rather than shipping', async () => {
  const s = stub({ ...SESSION, id: 'cs_pending', payment_status: 'unpaid' });
  const ev = { type: 'checkout.session.completed', data: { object: { id: 'cs_pending' } } };
  assert.equal(await mod.handleEvent(ev, s), 'pending');
});

test('a delayed payment that later succeeds is an order', async () => {
  const s = stub({ ...SESSION, id: 'cs_async_ok' });
  const ev = { type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_async_ok' } } };
  assert.equal(await mod.handleEvent(ev, s), 'paid');
});

test('a failed payment is reported, not silently dropped', async () => {
  const s = stub({ ...SESSION, id: 'cs_async_bad', payment_status: 'unpaid' });
  const ev = { type: 'checkout.session.async_payment_failed', data: { object: { id: 'cs_async_bad' } } };
  assert.equal(await mod.handleEvent(ev, s), 'failed');
});

test('an expired session is noted and nothing is shipped', async () => {
  const s = stub({ ...SESSION, id: 'cs_gone', payment_status: 'unpaid' });
  const ev = { type: 'checkout.session.expired', data: { object: { id: 'cs_gone' } } };
  assert.equal(await mod.handleEvent(ev, s), 'expired');
});

test('an event we do not handle is ignored without calling Stripe', async () => {
  const s = stub(SESSION);
  assert.equal(await mod.handleEvent({ type: 'payment_intent.created', data: { object: { id: 'pi_1' } } }, s),
    'ignored');
  assert.equal(s.calls.length, 0);
});

test('a configured endpoint receives the order as JSON', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('ok', { status: 200 }); };
  process.env.ORDER_NOTIFY_URL = 'https://example.test/orders';
  try {
    const s = stub({ ...SESSION, id: 'cs_notify' });
    await mod.handleEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_notify' } } }, s);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ORDER_NOTIFY_URL;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://example.test/orders');
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.kind, 'paid');
  assert.equal(body.order.total, '45.08');
  assert.equal(body.order.items[1].grind, 'Pre-Ground');
});

test('an endpoint that is down does not lose the order or retry the payment', async () => {
  const lines = [];
  const realFetch = globalThis.fetch;
  const realErr = console.error;
  globalThis.fetch = async () => { throw new Error('connection refused'); };
  console.error = (...a) => lines.push(a.join(' '));
  process.env.ORDER_NOTIFY_URL = 'https://example.test/down';
  let result;
  try {
    const s = stub({ ...SESSION, id: 'cs_notify_down' });
    result = await mod.handleEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_notify_down' } } }, s);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realErr;
    delete process.env.ORDER_NOTIFY_URL;
  }
  // the event still succeeds, so Stripe is not asked to redeliver a payment
  // that was fine; the failure is recorded instead
  assert.equal(result, 'paid');
  assert.ok(lines.some((l) => l.includes('notify-failed')));
});

test('a validly signed request is accepted end to end', async () => {
  /* The real handler builds its own Stripe client, so this asserts the
     signature path rather than the fulfilment path: a good signature must
     not be turned away. Reaching Stripe then fails without a network, which
     is a 500 — a state Stripe retries, and the right answer to "we could
     not look the order up". */
  const body = eventBody('checkout.session.completed');
  const res = await post(body, signed(body));
  assert.notEqual(res.status, 400, 'a valid signature must never be rejected');
  assert.ok([200, 500].includes(res.status));
});

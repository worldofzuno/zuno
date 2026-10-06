/**
 * Checks on the webhook, run with:
 *
 *     node --test tests/functions/stripe-webhook.test.mjs
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

const { orderFrom, summarise } = await import('../../netlify/functions/stripe-webhook.mjs');
const mod = await import('../../netlify/functions/stripe-webhook.mjs');
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

/* ---------------------------------------------------------- gift cards */

const { useMemoryStore } = await import('../../netlify/functions/lib/store.mjs');
const gc = await import('../../netlify/functions/lib/giftcard.mjs');

const GIFT_LINE = (amount, qty = 1) => ({
  description: 'ZUNO Gift Card',
  quantity: qty,
  amount_total: amount,
  price: { product: { name: 'ZUNO Gift Card', metadata: { kind: 'giftcard', sku: 'gift' } } },
});

const withGift = (over = {}) => ({
  ...SESSION,
  id: 'cs_gift_' + Math.random().toString(36).slice(2, 8),
  line_items: { data: [GIFT_LINE(5000)] },
  ...over,
});

test('the amount paid is split across the cards it bought, to the rappen', () => {
  assert.deepEqual(mod.splitAmount(5000, 1), [5000]);
  assert.deepEqual(mod.splitAmount(5000, 2), [2500, 2500]);
  // the remainder goes somewhere rather than being dropped
  assert.deepEqual(mod.splitAmount(2125, 3), [709, 708, 708]);
  assert.equal(mod.splitAmount(2125, 3).reduce((a, b) => a + b, 0), 2125);
});

test('buying a gift card mints one worth what was paid', async () => {
  useMemoryStore();
  const session = withGift();
  const s = stub(session);
  await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.completed', data: { object: { id: session.id } } }, s));

  const codes = await (await (await import('../../netlify/functions/lib/store.mjs')).store()).list('gift/');
  assert.equal(codes.length, 1);
  const card = await gc.load(codes[0].replace('gift/', ''));
  assert.equal(card.issued, 5000);
  assert.equal(gc.available(card), 5000);
  assert.equal(card.buyer, 'kundin@example.ch');
});

test('a discounted gift card is worth what was paid, not what it says', async () => {
  useMemoryStore();
  /* Otherwise a 15% code on a CHF 50 card is a way to buy francs at 85. */
  const session = withGift({ line_items: { data: [GIFT_LINE(4250)] } });
  await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.completed', data: { object: { id: session.id } } }, stub(session)));

  const st = await (await import('../../netlify/functions/lib/store.mjs')).store();
  const card = await gc.load((await st.list('gift/'))[0].replace('gift/', ''));
  assert.equal(card.issued, 4250);
});

test('three cards on one line become three cards', async () => {
  useMemoryStore();
  const session = withGift({ line_items: { data: [GIFT_LINE(7500, 3)] } });
  await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.completed', data: { object: { id: session.id } } }, stub(session)));

  const st = await (await import('../../netlify/functions/lib/store.mjs')).store();
  const keys = await st.list('gift/');
  assert.equal(keys.length, 3);
  for (const k of keys) assert.equal((await st.read(k)).value.issued, 2500);
});

test('a replayed event does not mint a second card', async () => {
  useMemoryStore();
  const session = withGift();
  const s = stub(session);
  const ev = { type: 'checkout.session.completed', data: { object: { id: session.id } } };
  await captureLog(() => mod.handleEvent(ev, s));
  await captureLog(() => mod.handleEvent(ev, s));

  const st = await (await import('../../netlify/functions/lib/store.mjs')).store();
  assert.equal((await st.list('gift/')).length, 1, 'a redelivery must not make money');
});

test('an order with no gift card mints nothing', async () => {
  useMemoryStore();
  const s = stub({ ...SESSION, id: 'cs_coffee_only' });
  await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.completed', data: { object: { id: 'cs_coffee_only' } } }, s));
  const st = await (await import('../../netlify/functions/lib/store.mjs')).store();
  assert.deepEqual(await st.list('gift/'), []);
});

test('paying with a gift card debits it once', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gc.hold(card.code, 'pre_abc', 2000);

  const session = {
    ...SESSION,
    id: 'cs_spend',
    metadata: { ...SESSION.metadata, gift_code: card.code, gift_ref: 'pre_abc', gift_hold: '2000' },
  };
  const ev = { type: 'checkout.session.completed', data: { object: { id: 'cs_spend' } } };
  await captureLog(() => mod.handleEvent(ev, stub(session)));
  assert.equal(gc.spent(await gc.load(card.code)), 2000);

  await captureLog(() => mod.handleEvent(ev, stub(session)));
  assert.equal(gc.spent(await gc.load(card.code)), 2000, 'a redelivery must not debit twice');
  assert.equal(gc.available(await gc.load(card.code)), 3000);

  /* The entry is keyed by the hold reference, which tells nobody which
     order took the money. The order id has to travel with it. */
  assert.equal((await gc.load(card.code)).spends['pre_abc'].order, 'cs_spend');
});

test('an expired session gives the held balance back', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gc.hold(card.code, 'pre_xyz', 5000);
  assert.equal(gc.available(await gc.load(card.code)), 0);

  const session = {
    ...SESSION,
    id: 'cs_gone',
    payment_status: 'unpaid',
    metadata: { ...SESSION.metadata, gift_code: card.code, gift_ref: 'pre_xyz', gift_hold: '5000' },
  };
  await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.expired', data: { object: { id: 'cs_gone' } } }, stub(session)));
  assert.equal(gc.available(await gc.load(card.code)), 5000);
});

test('a failed delayed payment gives the balance back too', async () => {
  useMemoryStore();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gc.hold(card.code, 'pre_f', 3000);
  const session = {
    ...SESSION,
    id: 'cs_failed',
    payment_status: 'unpaid',
    metadata: { ...SESSION.metadata, gift_code: card.code, gift_ref: 'pre_f', gift_hold: '3000' },
  };
  await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.async_payment_failed', data: { object: { id: 'cs_failed' } } },
    stub(session)));
  assert.equal(gc.available(await gc.load(card.code)), 5000);
});

test('an unpaid session neither mints nor debits', async () => {
  useMemoryStore();
  const session = withGift({ payment_status: 'unpaid' });
  const r = await captureLog(() => mod.handleEvent(
    { type: 'checkout.session.completed', data: { object: { id: session.id } } }, stub(session)));
  assert.equal(r[0], 'pending');
  const st = await (await import('../../netlify/functions/lib/store.mjs')).store();
  assert.deepEqual(await st.list('gift/'), []);
});

/* ------------------------------------------------------------------ mail */

test('the order mail says what was bought and what it cost', () => {
  const o = orderFrom(SESSION);
  const text = mod.orderMailText(o);
  assert.ok(text.includes('ZUNO Castano — 200 g'));
  assert.ok(text.includes('Pre-Ground'));
  assert.ok(text.includes('CHF 45.08'));
  assert.ok(text.includes('Musterweg 1'));
  assert.ok(text.includes('3000 Bern'));
});

test('the mail carries the gift card codes and how to use them', () => {
  const o = { ...orderFrom(SESSION), giftCards: [{ code: 'ZG-2345-6789-ABCD', amount: 5000 }] };
  const text = mod.orderMailText(o);
  assert.ok(text.includes('ZG-2345-6789-ABCD'));
  assert.ok(text.includes('CHF 50.00'));
  assert.ok(text.includes('Voucher code'));
});

test('an order with nothing to ship says so instead of leaving a blank', () => {
  const o = { ...orderFrom({ ...SESSION, collected_information: undefined }), giftCards: [] };
  const text = mod.orderMailText(o);
  assert.ok(text.includes('Nothing to ship'));
  assert.ok(!text.includes('undefined'));
  assert.ok(!text.includes('null'));
});

test('a gift card used as payment appears on the bill', () => {
  const o = { ...orderFrom(SESSION), giftSpent: { code: 'ZG-2345-6789-ABCD', amount: 2000 } };
  assert.ok(mod.orderMailText(o).includes('Gift card ZG-2345-6789-ABCD   -CHF 20.00'));
});

test('the mail is not sent anywhere when no provider is configured', async () => {
  useMemoryStore();
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('', { status: 200 }); };
  try {
    const s = stub({ ...SESSION, id: 'cs_nomail' });
    await captureLog(() => mod.handleEvent(
      { type: 'checkout.session.completed', data: { object: { id: 'cs_nomail' } } }, s));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, false, 'with no key there is nobody to send through');
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

/* ------------------------------------------------------- the order mail --- */

const ORDER = {
  session: 'cs_test_abcdefghij1234567890',
  currency: 'CHF', total: '61.90', shipping: '7.00', discount: '0.00',
  name: 'Davide Felice', email: 'kundin@example.ch',
  address: { line1: '30 Waldhoeheweg', line2: null, postal_code: '3013', city: 'Bern', country: 'CH' },
  items: [
    { name: 'ZUNO Castano — 500 g', grind: 'Pre-Ground', qty: 1, amount: '29.90' },
    { name: 'ZUNO Gift Card', grind: null, qty: 1, amount: '25.00' },
  ],
  giftCards: [{ code: 'ZG-H3AJ-U23E-96EH', amount: 2500 }],
  giftSpent: null,
};

test('the order mail carries the figures and the codes', () => {
  const html = mod.orderMailHtml(ORDER);
  for (const needle of ['J1234567890'.slice(-8).toUpperCase(), 'CHF 61.90', 'CHF 29.90',
    'Pre-Ground', 'ZG-H3AJ-U23E-96EH', '3013 Bern', 'Shipping']) {
    assert.ok(html.includes(needle), `the mail should say ${needle}`);
  }
});

test('a gift-only order is not asked for an address it does not have', () => {
  const html = mod.orderMailHtml({ ...ORDER, address: null, shipping: '0.00' });
  assert.ok(html.includes('Nothing to ship'));
  assert.equal(html.includes('Shipping to'), false);
});

test('what a customer typed cannot become markup', () => {
  /* The name and the street come from whoever filled in the checkout. A
     confirmation assembled from them is a mail someone else could write. */
  const html = mod.orderMailHtml({
    ...ORDER,
    name: '<script>alert(1)</script>',
    address: { ...ORDER.address, line1: '<img src=x onerror=alert(2)>', city: '"><b>bold' },
  });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('"><b>bold'), false);
  assert.ok(html.includes('&lt;script&gt;'), 'escaped, not dropped — the address still reads back');
});

test('the mail is one document, and the only thing it loads is the wordmark', () => {
  const html = mod.orderMailHtml(ORDER);
  assert.ok(html.startsWith('<!doctype html>'));
  /* No stylesheet and no web font: a client that blocks what it likes
     still shows a complete order. */
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/@font-face/i.test(html), false);

  /* Exactly one image, and it is the logo. Every other part of the mail
     has to read with images off. */
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  assert.equal(imgs.length, 1);
  assert.ok(imgs[0].includes('/img/zuno-wordmark-mail.png'));
  assert.ok(/alt="ZUNO"/.test(imgs[0]), 'blocked images still say who sent this');

  assert.equal(/https?:\/\/(?!worldofzuno)/i.test(html.replace(/mailto:[^"]*/g, '')), false,
    'nothing is fetched from anywhere but the shop itself');
});

/* ---------------------------------------------------------- the alarm --- */

/**
 * A confirmation that never left used to be one line in a log nobody reads.
 * The shop found out when the customer wrote in.
 */
test('a refused order confirmation raises an alarm at the shop', async () => {
  const { useMemoryStore, resetStore } = await import('../../netlify/functions/lib/store.mjs');
  useMemoryStore();
  const realFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: false, status: 403, text: async () => '{"message":"domain is not verified"}' };
  };
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.MAIL_TO = 'info@worldofzuno.com';

  try {
    const s = stub({ ...SESSION, id: 'cs_test_MAILFAIL' });
    const real = console.error;
    console.error = () => {};
    try {
      await captureLog(() => mod.handleEvent(
        { type: 'checkout.session.completed', data: { object: { id: 'cs_test_MAILFAIL' } } }, s));
    } finally { console.error = real; }

    const raised = sent.find((m) => String(m.subject).includes('order confirmation not sent'));
    assert.ok(raised, 'the shop is told the customer never heard from us');
    assert.equal(raised.to[0], 'info@worldofzuno.com');
    assert.ok(raised.text.includes('MAILFAIL'), 'and which order it was');
    assert.ok(raised.text.includes('kundin@example.ch'), 'and who never heard from us');
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_TO;
    resetStore();
  }
});

test('with no provider at all, no alarm is raised per order', async () => {
  const { useMemoryStore, resetStore } = await import('../../netlify/functions/lib/store.mjs');
  useMemoryStore();
  process.env.MAIL_TO = 'info@worldofzuno.com';
  const real = console.error;
  const errs = [];
  console.error = (...a) => errs.push(a.join(' '));
  try {
    const s = stub({ ...SESSION, id: 'cs_no_provider' });
    await captureLog(() => mod.handleEvent(
      { type: 'checkout.session.completed', data: { object: { id: 'cs_no_provider' } } }, s));
  } finally { console.error = real; delete process.env.MAIL_TO; resetStore(); }

  /* Not configured is a state the whole shop is in, not something that went
     wrong with this order. It belongs in the log, once per order, not in an
     inbox. */
  assert.equal(errs.some((l) => l.startsWith('[alarm]')), false);
  assert.ok(errs.some((l) => l.includes('customer-mail-unsent')));
});

/* --------------------------------------------------- when money goes back --- */

const { useMemoryStore: freshStore, store: theStore } =
  await import('../../netlify/functions/lib/store.mjs');
const gcard = await import('../../netlify/functions/lib/giftcard.mjs');
const stk = await import('../../netlify/functions/lib/stock.mjs');

/** Stripe, as far as a refund is concerned. */
function refundStub(session) {
  return {
    checkout: {
      sessions: {
        list: async () => ({ data: session ? [session] : [] }),
        retrieve: async () => session,
      },
    },
  };
}

const charge = (over = {}) => ({
  id: 'ch_1', payment_intent: 'pi_1', currency: 'chf',
  amount: 2190, amount_refunded: 2190, ...over,
});

const refundEvent = (over) => ({ type: 'charge.refunded', data: { object: charge(over) } });

/** A paid session for one 200 g bag, as the shop would have written it. */
const SOLD = {
  id: 'cs_test_REFUND01', object: 'checkout.session', livemode: false,
  payment_status: 'paid', currency: 'chf', amount_total: 2190,
  total_details: { amount_discount: 0, amount_shipping: 700, amount_tax: 0 },
  customer_details: { email: 'kundin@example.ch', name: 'A Kundin' },
  metadata: { lines: '[["castano-200g",1,"Whole Beans"]]', stock_ref: 'pre_refund' },
  line_items: { data: [] },
};

test('a refund puts the bags back on the shelf', async () => {
  freshStore();
  await stk.setQty('castano-200g', 10);
  await stk.holdCart([{ sku: 'castano-200g', qty: 1 }], 'pre_refund');
  await stk.settleCart([{ sku: 'castano-200g', qty: 1 }], 'pre_refund', Date.now(), SOLD.id);
  assert.equal(stk.availableQty(await stk.read('castano-200g')), 9);

  const [out] = await captureLog(() => mod.handleEvent(refundEvent(), refundStub(SOLD)));
  assert.equal(out, 'refunded');
  assert.equal(stk.availableQty(await stk.read('castano-200g')), 10);
});

test('a refund gives back the credit the customer had redeemed', async () => {
  freshStore();
  const card = await gcard.issue({ amount: 5000, issuedFor: 'cs_elsewhere' });
  await gcard.hold(card.code, 'cs_test_REFUND01', 1000);
  await gcard.settle(card.code, 'cs_test_REFUND01', 0, Date.now(), 'cs_test_REFUND01');
  assert.equal(gcard.available(await gcard.load(card.code)), 4000);

  const session = { ...SOLD, metadata: { ...SOLD.metadata, gift_code: card.code, gift_ref: 'cs_test_REFUND01' } };
  await captureLog(() => mod.handleEvent(refundEvent(), refundStub(session)));

  assert.equal(gcard.available(await gcard.load(card.code)), 5000,
    'refunded their money and their voucher');
});

/* Buy a card, write the code down, ask for the money back. Without this it
   is free money, repeatable. */
test('a gift card bought in a refunded order stops being spendable', async () => {
  freshStore();
  const minted = await gcard.issue({ amount: 10000, issuedFor: SOLD.id });
  const s = await theStore();
  await s.create(`issued/${SOLD.id}`, { codes: [{ code: minted.code, amount: 10000 }], done: true });
  assert.equal(gcard.available(await gcard.load(minted.code)), 10000);

  await captureLog(() => mod.handleEvent(refundEvent(), refundStub(SOLD)));

  const after = await gcard.load(minted.code);
  assert.equal(after.voided, true);
  assert.equal(gcard.available(after), 0);
  assert.ok(/refunded/i.test(after.voidReason));
});

test('a partial refund reverses nothing, and says so', async () => {
  freshStore();
  await stk.setQty('castano-200g', 10);
  await stk.holdCart([{ sku: 'castano-200g', qty: 1 }], 'pre_refund');
  await stk.settleCart([{ sku: 'castano-200g', qty: 1 }], 'pre_refund');
  assert.equal(stk.availableQty(await stk.read('castano-200g')), 9);

  const [out, lines] = await captureLog(() =>
    mod.handleEvent(refundEvent({ amount_refunded: 500 }), refundStub(SOLD)));

  assert.equal(out, 'refunded-part');
  assert.equal(stk.availableQty(await stk.read('castano-200g')), 9, 'untouched on purpose');
  assert.ok(lines.some((l) => l.includes('refunded-part')));
});

test('a redelivered refund does not reverse twice', async () => {
  freshStore();
  await stk.setQty('castano-200g', 10);
  await stk.holdCart([{ sku: 'castano-200g', qty: 1 }], 'pre_refund');
  await stk.settleCart([{ sku: 'castano-200g', qty: 1 }], 'pre_refund');

  assert.equal((await captureLog(() => mod.handleEvent(refundEvent(), refundStub(SOLD))))[0], 'refunded');
  assert.equal((await captureLog(() => mod.handleEvent(refundEvent(), refundStub(SOLD))))[0], 'duplicate');
  assert.equal(stk.availableQty(await stk.read('castano-200g')), 10, 'not 11');
});

test('a refund with no order behind it is reported, not swallowed', async () => {
  freshStore();
  const real = console.error;
  console.error = () => {};
  try {
    const [out] = await captureLog(() => mod.handleEvent(refundEvent(), refundStub(null)));
    assert.equal(out, 'refund-unmatched');
  } finally { console.error = real; }
});

test('the refund record is what the back office reads', async () => {
  freshStore();
  await captureLog(() => mod.handleEvent(refundEvent(), refundStub(SOLD)));
  const { value } = await (await theStore()).read(mod.refundKey(SOLD.id));
  assert.ok(value, 'written under refund/<session>');
  assert.equal(value.whole, true);
  assert.equal(value.charge, 'ch_1');
  assert.equal(value.amount, 2190);
});

test('the refund mail says the amount once', async () => {
  freshStore();
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ id: 'm1' }) }; };
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.MAIL_TO = 'info@worldofzuno.com';
  const real = console.error; console.error = () => {};
  try {
    await captureLog(() => mod.handleEvent(refundEvent(), refundStub(SOLD)));
    const mail = sent.find((m) => String(m.subject).startsWith('Refunded'));
    assert.ok(mail, 'the shop is told');
    assert.ok(mail.subject.includes('CHF 21.90'));
    assert.equal(/CHF\s+CHF/.test(mail.subject + mail.text), false, 'once, not twice');
  } finally {
    console.error = real; global.fetch = realFetch;
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_TO;
  }
});

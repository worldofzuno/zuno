/**
 * Receives Stripe's notifications about a checkout.
 *
 * The other function in this folder talks to Stripe. This one listens. Stripe
 * calls it when a payment resolves, which is the only account of an order
 * that can be trusted: the browser redirect to the success page is a wish,
 * not a fact. With TWINT enabled the customer leaves the browser for the
 * TWINT app and has to come back, so "paid but never returned" stopped being
 * a rare case the day that went live.
 *
 *   POST /.netlify/functions/stripe-webhook
 *   stripe-signature: t=...,v1=...
 *
 * Every request is rejected unless it carries a signature Stripe could have
 * produced. Without that the endpoint is a public form for inventing orders.
 */

import Stripe from 'stripe';

/* ------------------------------------------------------------------ config */

/**
 * Where a finished order is sent. Any service that accepts a JSON POST works
 * — an email relay, an automation tool, a spreadsheet endpoint.
 *
 * [PLACEHOLDER: notification endpoint — leave unset until you have chosen one]
 *
 * Unset is a supported state, not a broken one: the order is still written to
 * the function log, where it can be read and replayed. What it is not is a
 * message in anyone's inbox, so this file does not pretend otherwise.
 *
 * Read per call rather than once at import, so changing the variable takes
 * effect on the next invocation instead of the next cold start.
 */
const notifyUrl = () => process.env.ORDER_NOTIFY_URL;

/** Events worth acting on. Everything else is acknowledged and dropped. */
const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

/* ------------------------------------------------------- pure, and tested */

const rappen = (n) => (n == null ? null : (n / 100).toFixed(2));

/**
 * Everything needed to pack a parcel, and nothing else.
 *
 * The grind rides in metadata rather than in the price, because it does not
 * change what the order costs — but it does change what goes in the bag, so
 * it has to survive as far as whoever fills it.
 */
export function orderFrom(session) {
  const meta = session.metadata || {};
  let grinds = [];
  try {
    grinds = JSON.parse(meta.lines || '[]');
  } catch {
    /* metadata is a string field; a malformed one must not lose the order */
  }
  const grindFor = (sku) => (grinds.find((g) => g[0] === sku) || [])[2] || null;

  const items = (session.line_items?.data || []).map((li) => {
    const sku = li.price?.product?.metadata?.sku || null;
    return {
      sku,
      name: li.description || li.price?.product?.name || 'unknown',
      qty: li.quantity,
      grind: sku ? grindFor(sku) : null,
      amount: rappen(li.amount_total),
    };
  });

  const d = session.customer_details || {};
  const ship = session.collected_information?.shipping_details
    || session.shipping_details
    || {};

  return {
    session: session.id,
    livemode: session.livemode === true,
    paid: session.payment_status === 'paid',
    currency: (session.currency || '').toUpperCase(),
    subtotal: rappen(session.amount_subtotal),
    discount: rappen(session.total_details?.amount_discount),
    shipping: rappen(session.total_details?.amount_shipping),
    total: rappen(session.amount_total),
    email: d.email || null,
    name: ship.name || d.name || null,
    address: ship.address || d.address || null,
    items,
  };
}

/** One line per order, so the log is skimmable without a parser. */
export function summarise(order) {
  const what = order.items
    .map((i) => `${i.qty}x ${i.name}${i.grind ? ` (${i.grind})` : ''}`)
    .join(', ');
  const where = order.address
    ? `${order.name || ''} ${order.address.postal_code || ''} ${order.address.city || ''}`.trim()
    : 'no address';
  return `${order.currency} ${order.total} — ${what} — ${where} — ${order.email || 'no email'}`;
}

/* ------------------------------------------------------------ side effects */

/**
 * Stripe retries a delivery it did not get a 2xx for, and can send the same
 * event twice even when it did. This catches the common case — a retry
 * reaching an instance that is still warm — and nothing more: a cold start
 * or a second instance has an empty set. Real deduplication needs somewhere
 * to write, which this function deliberately does not have yet, so anything
 * downstream should treat a repeated session id as the same order.
 */
const seen = new Set();
function firstTime(id) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  return true;
}

async function notify(kind, order) {
  /* The log is the floor, not the ceiling: it happens whether or not a
     notification endpoint is configured, so an order is never only in a
     request that may have failed. */
  console.log(`[order:${kind}] ${summarise(order)} ${JSON.stringify(order)}`);
  const url = notifyUrl();
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, order }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    /* A notification that fails must not fail the webhook. Returning non-2xx
       would make Stripe retry the whole event, and the order is already in
       the log above. */
    console.error(`[order:notify-failed] ${order.session}: ${e && e.message}`);
  }
}

/* ----------------------------------------------------------------- handler */

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) {
    console.error('webhook is not configured: missing key or signing secret');
    return new Response('not configured', { status: 500 });
  }

  /* The raw text, never a parsed object. The signature covers the exact
     bytes Stripe sent, so re-serialising JSON breaks it even when the
     result looks identical. */
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
  } catch (e) {
    console.error('rejected an unsigned or altered webhook:', e && e.message);
    return new Response('bad signature', { status: 400 });
  }

  try {
    await handleEvent(event, stripe);
  } catch (e) {
    /* Non-2xx asks Stripe to deliver again, which is what we want when the
       failure was ours and might not repeat. */
    console.error('webhook handling failed:', e && e.message);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

/**
 * What to do about a verified event. Separate from the handler above so it
 * can be exercised without a signature and without the network — the branch
 * that matters most, a paid order, is otherwise only reachable by calling
 * Stripe for real.
 */
export async function handleEvent(event, stripe) {
  if (!HANDLED.has(event.type)) return 'ignored';

  /* The event carries a Checkout Session without its line items, and the
     product behind each price is a reference rather than an object. Both are
     needed to say what to put in the parcel, so the session is read back in
     full rather than guessed at from metadata. */
  const full = await stripe.checkout.sessions.retrieve(event.data.object.id, {
    expand: ['line_items.data.price.product'],
  });
  const order = orderFrom(full);

  if (event.type === 'checkout.session.expired') {
    console.log(`[order:expired] ${full.id}`);
    return 'expired';
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    await notify('failed', order);
    return 'failed';
  }
  /* Both completed and async_payment_succeeded land here. A completed
     session is not always a paid one — a delayed method reports completed
     while the money is still in flight — so the decision is made on
     payment_status, not on the event name. */
  if (!order.paid) {
    console.log(`[order:pending] ${full.id} payment_status=${full.payment_status}`);
    return 'pending';
  }
  if (!firstTime(full.id)) return 'duplicate';
  await notify('paid', order);
  return 'paid';
}

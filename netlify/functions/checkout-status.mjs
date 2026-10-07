/**
 * Answers one question about a Checkout Session: was it paid?
 *
 *   GET /.netlify/functions/checkout-status?session_id=cs_test_...
 *   -> { "paid": true, "state": "paid", "total": "42.98", "currency": "CHF" }
 *
 * The success page used to believe the redirect. Anyone could open
 * /?checkout=success and be shown a confirmation, and their cart would be
 * emptied on the strength of a URL they typed themselves. Stripe's own
 * guidance says not to: "Malicious users could directly access the
 * success_url without paying". So the page now asks here, and here asks
 * Stripe.
 *
 * This is a confirmation, not an order record — that is the webhook's job,
 * because a customer who never comes back never loads this page at all.
 *
 * What comes back is deliberately thin. A session id is unguessable but it
 * does travel in a URL, so this returns whether the money arrived and how
 * much it was, and no name, address, email or line items.
 */

import Stripe from 'stripe';
import { isPaid } from './lib/session.mjs';

/* Stripe's own format. Checked before spending a call on a string that
   cannot be a session id, and so a malformed one cannot reach the API. */
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,600}$/;

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Stripe's payment_status, reduced to what the page has to say.
 *
 * `unpaid` is not a failure: a delayed payment method leaves a session
 * completed and unpaid for days while the transfer clears. Telling that
 * customer their payment failed would be wrong, so it gets its own state.
 */
export function stateOf(session) {
  if (!session) return 'unknown';
  /* Both "paid" and "no_payment_required", from the one definition the
     webhook and the back office also read. See lib/session.mjs. */
  if (isPaid(session)) return 'paid';
  if (session.status === 'expired') return 'expired';
  if (session.status === 'open') return 'open';
  return 'pending';
}

export function publicView(session) {
  const state = stateOf(session);
  const paid = state === 'paid';
  return {
    state,
    paid,
    /* Only once the money is in. Before that an amount is a quote, and
       quoting it next to a half-finished payment invites confusion. */
    total: paid && session.amount_total != null
      ? (session.amount_total / 100).toFixed(2) : null,
    currency: paid ? (session.currency || '').toUpperCase() : null,
  };
}

export default async function handler(req) {
  if (req.method !== 'GET') return json(405, { error: 'GET only' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'checkout is not configured' });

  const id = new URL(req.url).searchParams.get('session_id') || '';
  if (!SESSION_ID.test(id)) return json(400, { error: 'not a session id' });

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    return json(200, publicView(session));
  } catch (e) {
    /* A session id that does not exist is indistinguishable from one that
       belongs to someone else's account, and both get the same answer. */
    if (e && e.statusCode === 404) return json(404, { error: 'no such session' });
    console.error('checkout-status failed:', e && e.message);
    return json(502, { error: 'could not check the payment' });
  }
}

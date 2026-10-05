/**
 * Checks a code the customer typed, so the cart can show the price it will
 * actually be charged before leaving for Stripe.
 *
 *   POST /.netlify/functions/validate-code
 *   { "code": "FAMILY26" }
 *   -> { "valid": true, "kind": "fnf", "currency": "chf",
 *        "prices": { "castano-200g": 1100, "castano-500g": 2000 } }
 *
 * The amounts come back from the Stripe Price objects, not from a constant
 * here, so what the cart displays and what Stripe charges cannot drift apart.
 * This endpoint is a courtesy to the UI; it decides nothing. The session
 * creation validates the code again for itself, and that is where the money
 * is settled.
 *
 * `kind` is how two unrelated code systems stay apart. A Family & Friends
 * code answers "fnf". A gift card is stored value redeemed as payment, not a
 * price reduction, so when that is built it answers "gift" and takes a
 * different path. An unrecognised code answers `kind: null` rather than an
 * error claiming the F&F code was wrong.
 */

import Stripe from 'stripe';
import { codes, matchCode, exhausted, allow, FNF_CATALOGUE, fnfConfigured } from './lib/fnf.mjs';
import * as gift from './lib/giftcard.mjs';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const REFUSED = {
  empty: 'Please enter a code.',
  unknown: 'That code is not valid.',
  expired: 'That code has expired.',
  exhausted: 'That code has reached its limit.',
  unconfigured: 'Codes are not available just now.',
};

const no = (reason) => ({ valid: false, kind: null, reason, message: REFUSED[reason] });

/**
 * The answer for one code. Separated from the handler so the decisions —
 * unknown, expired, exhausted, unconfigured, good — are reachable in a test
 * without the network, the same way the webhook's handleEvent is.
 *
 * Throws only when Stripe is unusable; the caller turns that into a 502.
 */
export async function check(stripe, code) {
  /* A gift card first, and by shape rather than by trying it: the two code
     formats cannot be confused, so a mistyped gift card is answered as a
     broken gift card instead of being reported as an unknown voucher. */
  if (gift.looksLikeCode(code)) {
    const card = await gift.load(code);
    if (!card) return { valid: false, kind: 'gift', reason: 'unknown', message: REFUSED.unknown };
    const balance = gift.available(card);
    if (balance <= 0) {
      return { valid: false, kind: 'gift', reason: 'empty', message: 'That gift card is empty.' };
    }
    return { valid: true, kind: 'gift', currency: 'chf', code: card.code, balance };
  }

  const match = matchCode(code, codes());
  if (!match.ok) return no(match.reason);

  /* A valid code with no prices behind it must be refused. Letting it through
     would charge the full price on a cart that had just shown a reduced one. */
  if (!fnfConfigured()) return no('unconfigured');

  if (await exhausted(stripe, match.entry)) return no('exhausted');

  const catalogue = FNF_CATALOGUE();
  const entries = await Promise.all(
    Object.entries(catalogue).map(async ([sku, id]) => {
      const price = await stripe.prices.retrieve(id);
      if (price.currency !== 'chf' || typeof price.unit_amount !== 'number') {
        throw new Error(`the Family & Friends price for ${sku} is unusable`);
      }
      return [sku, price.unit_amount];
    })
  );
  return { valid: true, kind: 'fnf', currency: 'chf', prices: Object.fromEntries(entries) };
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  /* Netlify puts the caller's address here; the fallbacks keep the limiter
     working under `netlify dev` and in the local harness. */
  const ip = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || 'anonymous';
  if (!allow(ip)) {
    return json(429, { valid: false, kind: null, reason: 'rate', message: 'Too many attempts. Please wait a moment.' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }
  if (!body || typeof body !== 'object') return json(400, { error: 'body must be an object' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(200, no('unconfigured'));

  try {
    return json(200, await check(new Stripe(key), body.code));
  } catch (e) {
    console.error('validate-code failed:', e && e.message);
    return json(502, { error: 'could not check that code' });
  }
}

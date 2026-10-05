/**
 * Family & Friends codes.
 *
 * A F&F code does not discount the cart — it swaps the Stripe Price the line
 * item points at. The two sizes are reduced by different amounts (14.90 ->
 * 11.00 is -26.17%, 29.90 -> 20.00 is -33.11%), and no single coupon can do
 * that: a Checkout Session takes at most one discount ("Currently, only up to
 * one may be specified"), a promotion code points at exactly one coupon, and
 * `coupon.applies_to` restricts by product, not by price. So the special
 * price is a price, and the server decides which one applies.
 *
 * Nothing in this file is reachable from the browser. The codes themselves
 * live in an environment variable, so they can be rotated, dated or switched
 * off without a code change.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/* A code is uppercase letters, digits and hyphens. Narrow on purpose: the
   redemption count is looked up with a Stripe search query that interpolates
   the code, and a character set that cannot contain a quote makes that query
   safe by construction rather than by escaping. */
const SHAPE = /^[A-Z0-9-]{3,64}$/;

/** Uppercase, and whitespace removed — a code typed on a phone may arrive
    with a stray space, and that should not be a failed redemption. */
export function normalise(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
}

const digest = (s) => createHash('sha256').update(normalise(s), 'utf8').digest();

/** Compares two codes without leaking how far they matched. The digests are
    always 32 bytes, so the comparison is also free of a length signal. */
export function sameCode(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Reads FNF_CODES, which is JSON:
 *
 *   [{ "code": "FAMILY26", "expires": "2026-12-31", "maxRedemptions": 100 }]
 *
 * `expires` and `maxRedemptions` are optional. Malformed input yields no
 * codes at all, never every code: a typo in the variable must close the door,
 * not open it.
 */
export function parseCodes(raw) {
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('FNF_CODES is not valid JSON; no Family & Friends code is active');
    return [];
  }
  if (!Array.isArray(data)) {
    console.error('FNF_CODES must be a JSON array; no Family & Friends code is active');
    return [];
  }
  return data.reduce((out, entry) => {
    if (!entry || typeof entry !== 'object') return out;
    const code = normalise(entry.code);
    if (!SHAPE.test(code)) {
      console.error('FNF_CODES holds an unusable code; it was skipped');
      return out;
    }
    const expires = typeof entry.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.expires)
      ? entry.expires
      : null;
    /* Coerced from a number or a quoted number only. `Number(true)` is 1,
       which would turn a careless `"maxRedemptions": true` into a code that
       dies after one use — not what anyone writing that meant. */
    const given = entry.maxRedemptions;
    const max = (typeof given === 'number' || typeof given === 'string') ? Number(given) : NaN;
    out.push({
      code,
      expires,
      maxRedemptions: Number.isInteger(max) && max > 0 ? max : null,
    });
    return out;
  }, []);
}

/** Read fresh each call rather than at module load, so a changed environment
    takes effect on the next cold start without a stale copy surviving in a
    warm one. */
export const codes = () => parseCodes(process.env.FNF_CODES);

/** A dated code is good until the end of that day. Measured in UTC, which is
    an hour or two past Swiss midnight — generous in the customer's favour
    rather than cutting them off early. */
function past(expires, now) {
  return Date.parse(expires + 'T23:59:59Z') < now.getTime();
}

/**
 * Matches what the customer typed against the configured codes.
 *
 * Every configured code is compared, with no early exit, so the time taken
 * does not depend on which one matched.
 */
export function matchCode(input, list, now = new Date()) {
  const given = normalise(input);
  if (!given) return { ok: false, reason: 'empty' };
  if (!SHAPE.test(given)) return { ok: false, reason: 'unknown' };

  let hit = null;
  for (const entry of list) {
    if (sameCode(given, entry.code)) hit = entry;
  }
  if (!hit) return { ok: false, reason: 'unknown' };
  if (hit.expires && past(hit.expires, now)) return { ok: false, reason: 'expired' };
  return { ok: true, entry: hit };
}

/* ------------------------------------------------------------- rate limiting

   A code field is a guessing oracle, so the endpoint in front of it is
   capped. This counter lives in the function instance, which means it limits
   per instance rather than globally — it blunts a single client hammering one
   warm instance, and it is not a defence against a distributed attempt. The
   real protection is a code long enough not to be guessed; see the note in
   STRIPE_INTEGRATION_TODO.md. */

const SEEN = new Map();
const WINDOW_MS = 60_000;
const PER_WINDOW = 10;
const MAX_KEYS = 5000;   // bounded, so a stream of addresses cannot grow it without end

export function allow(key, now = Date.now()) {
  const id = String(key || 'anonymous');
  if (SEEN.size > MAX_KEYS) SEEN.clear();
  const hits = (SEEN.get(id) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PER_WINDOW) {
    SEEN.set(id, hits);
    return false;
  }
  hits.push(now);
  SEEN.set(id, hits);
  return true;
}

/** Only for the tests; a fresh instance starts empty anyway. */
export function resetLimiter() {
  SEEN.clear();
}

/* ------------------------------------------------------- redemption counting

   Netlify functions keep no state between invocations, so the count cannot
   live here. It lives in Stripe: every F&F payment carries the code in the
   PaymentIntent's metadata, and succeeded PaymentIntents carrying it are the
   redemptions. That is authoritative and needs no second store, at the cost
   of Stripe's search index lagging by up to a minute — a burst of orders in
   that window could overshoot the limit slightly. */

export async function exhausted(stripe, entry) {
  if (!entry || !entry.maxRedemptions) return false;

  const query = `status:'succeeded' AND metadata['fnf_code']:'${entry.code}'`;
  let count = 0;
  let page;

  try {
    for (let i = 0; i < 20; i++) {
      const res = await stripe.paymentIntents.search(
        page ? { query, limit: 100, page } : { query, limit: 100 }
      );
      count += res.data.length;
      if (count >= entry.maxRedemptions) return true;
      if (!res.next_page) return false;
      page = res.next_page;
    }
  } catch (e) {
    /* Deliberately permissive: a search outage must not turn a valid code
       away from a family member. The overshoot is a few bags of coffee; the
       alternative is a shop that refuses its own code. */
    console.error('fnf: could not count redemptions, allowing the code:', e && e.message);
    return false;
  }
  return false;
}

/* --------------------------------------------------------------- catalogue */

/** SKU -> Family & Friends Price ID, from the environment for the same reason
    the regular ones are: test and live mode have different ids. */
export const FNF_CATALOGUE = () => ({
  'castano-200g': process.env.STRIPE_PRICE_FNF_CASTANO_200G,
  'castano-500g': process.env.STRIPE_PRICE_FNF_CASTANO_500G,
});

/** Whether the F&F prices are configured at all. Without them a code must be
    refused rather than quietly charging the full price. */
export function fnfConfigured() {
  return Object.values(FNF_CATALOGUE()).every(Boolean);
}

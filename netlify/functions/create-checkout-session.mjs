/**
 * Creates a Stripe Checkout Session.
 *
 * The client sends what the customer chose, never what it costs. Every amount
 * on this page comes out of the Stripe catalogue or out of the constants
 * below; nothing a browser sends is trusted with money.
 *
 *   POST /.netlify/functions/create-checkout-session
 *   { "items": [ { "sku": "castano-500g", "qty": 2, "grind": "Whole Beans" } ] }
 *   -> { "url": "https://checkout.stripe.com/..." }
 *
 * The promotion-code field is Stripe's own. `allow_promotion_codes: true` is
 * the whole of it: Stripe renders the field, validates the code against the
 * coupons defined in the Dashboard, and computes the final amount. There is
 * deliberately no discount logic here — a discount this function could
 * calculate is a discount a customer could forge.
 *
 * A Family & Friends code is a different mechanism and is handled here rather
 * than by Stripe: it does not discount the cart, it selects a different
 * Stripe Price per size. See fnf.mjs for why a coupon cannot do that. When
 * one is in force the public promotion-code field is switched off, because
 * the special price is already the reduction and stacking the two would
 * compound them.
 */

import Stripe from 'stripe';
import { codes, matchCode, exhausted, FNF_CATALOGUE, fnfConfigured } from './fnf.mjs';

/* ------------------------------------------------------------------ config */

/**
 * SKU -> Stripe Price ID. The client may only name a key of this map.
 *
 * The ids come from the environment rather than from here, because test and
 * live mode have different ones and the same file has to serve both. See
 * .env.example for the sandbox values and the products behind them; both
 * prices are CHF with tax_behavior "inclusive", which Stripe will not let
 * us change later — CHF 14.90 is what the shelf says, tax and all.
 */
const CATALOGUE = {
  'castano-200g': process.env.STRIPE_PRICE_CASTANO_200G,
  'castano-500g': process.env.STRIPE_PRICE_CASTANO_500G,
};

const GRINDS = ['Whole Beans', 'Pre-Ground'];
const MAX_QTY = 20;                 // per line; a shop this size has no reason for more
const SHIPPING_RAPPEN = 700;        // CHF 7.00 flat
const FREE_SHIPPING_FROM = 4500;    // CHF 45.00

/**
 * Whether the free-shipping threshold is measured before or after a promotion
 * code is applied.
 *
 * 'before' (the default) means the threshold is decided from the cart, which
 * is what the customer saw when they added the last item. With a 15% code
 * that gives a band — a subtotal between CHF 45.00 and CHF 52.94 keeps free
 * shipping even though the customer ends up paying less than 45.
 *
 * 'after' is not implementable here: Stripe applies the coupon after this
 * function has already chosen the shipping option, and it does not
 * re-evaluate. To charge for shipping under 45 post-discount, the free
 * shipping has to become a Stripe coupon rule of its own rather than an
 * arithmetic decision in this file.
 *
 * A voucher code does not reach this rule at all: it carries free postage
 * outright, whatever the cart is worth. The threshold below applies only to
 * a cart without a code.
 */
const THRESHOLD = 'before';

const ALLOWED_COUNTRIES = ['CH', 'LI'];

/* ------------------------------------------------------- pure, and tested */

export function parseCart(body) {
  if (!body || typeof body !== 'object') throw new Error('body must be an object');
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw new Error('items must be a non-empty array');
  if (items.length > 10) throw new Error('too many lines');

  const seen = new Set();
  return items.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`items[${i}] must be an object`);
    const sku = String(raw.sku || '');
    if (!Object.prototype.hasOwnProperty.call(CATALOGUE, sku)) {
      throw new Error(`items[${i}].sku is not a product`);
    }
    const grind = GRINDS.includes(raw.grind) ? raw.grind : GRINDS[0];
    const key = sku + '|' + grind;
    if (seen.has(key)) throw new Error('duplicate line; merge the quantities');
    seen.add(key);

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new Error(`items[${i}].qty must be a whole number from 1 to ${MAX_QTY}`);
    }
    return { sku, qty, grind };
  });
}

/** Subtotal in rappen, from the catalogue's own amounts — never the client's. */
export function subtotalRappen(lines, priceById, catalogue = CATALOGUE) {
  return lines.reduce((sum, l) => {
    const price = priceById[catalogue[l.sku]];
    if (!price || typeof price.unit_amount !== 'number') {
      throw new Error(`price for ${l.sku} has no unit_amount; is it a recurring price?`);
    }
    if (price.currency !== 'chf') throw new Error(`price for ${l.sku} is not in CHF`);
    return sum + price.unit_amount * l.qty;
  }, 0);
}

/** The code, if the client sent one at all. An absent field is the normal
    case and must not look like a failed code. */
export function parseCode(body) {
  const raw = body && body.code;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error('code must be a string');
  if (raw.length > 64) throw new Error('that code is not valid');
  return raw;
}

/**
 * @param subtotal   in rappen
 * @param alwaysFree true when something other than the subtotal has already
 *                   decided that postage is waived — a voucher code does
 */
export function shippingOption(subtotal, alwaysFree = false) {
  const free = alwaysFree || subtotal >= FREE_SHIPPING_FROM;
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: free ? 0 : SHIPPING_RAPPEN, currency: 'chf' },
      display_name: free ? 'Free shipping' : 'Standard shipping',
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 1 },
        maximum: { unit: 'business_day', value: 3 },
      },
    },
  };
}

/**
 * @param lines    what the customer chose
 * @param subtotal in rappen, at the REGULAR prices — this decides shipping
 * @param origin   this site, for the return pages
 * @param fnfCode  a validated Family & Friends code, or null
 */
export function sessionParams(lines, subtotal, origin, fnfCode = null) {
  /* The only thing a F&F code changes about the session is which Price each
     line points at. The amounts still come from Stripe, and the client still
     never sends one. */
  const catalogue = fnfCode ? FNF_CATALOGUE() : CATALOGUE;

  const params = {
    mode: 'payment',
    ui_mode: 'hosted_page',
    line_items: lines.map((l) => ({ price: catalogue[l.sku], quantity: l.qty })),
    /* Stripe's own field, and nothing here validates or applies a code for
       it. Off while a F&F price is in force: that reduction is already in the
       line item, and letting a public code land on top would compound two
       reductions that were never meant to meet. */
    allow_promotion_codes: !fnfCode,
    shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
    /* A voucher code carries free postage, whatever the cart is worth. */
    shipping_options: [shippingOption(subtotal, !!fnfCode)],
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    /* The prices carry tax_behavior "inclusive" — CHF 14.90 is what the shelf
       says, VAT and all — so Stripe must not add tax on top. */
    automatic_tax: { enabled: false },
    submit_type: 'auto',
    origin_context: 'web',
    integration_identifier: 'hosted_web_0001',
    // The grind does not change the price, so it is not a separate price in
    // the catalogue; it still has to reach whoever packs the order.
    metadata: {
      lines: JSON.stringify(lines.map((l) => [l.sku, l.qty, l.grind])).slice(0, 480),
      shipping_threshold: THRESHOLD,
    },
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}#cart`,
    cancel_url: `${origin}/?checkout=cancelled#cart`,
  };

  if (fnfCode) {
    params.metadata.fnf_code = fnfCode;
    /* Also on the PaymentIntent, because that is what the redemption count is
       read from: PaymentIntents can be searched by metadata, Checkout
       Sessions cannot. */
    params.payment_intent_data = { metadata: { fnf_code: fnfCode } };
  }
  return params;
}

/* ----------------------------------------------------------------- handler */

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'checkout is not configured' });
  const missing = Object.entries(CATALOGUE).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return json(500, { error: 'checkout is not configured' });

  let lines;
  let code;
  try {
    const body = await req.json();
    lines = parseCart(body);
    code = parseCode(body);
  } catch (e) {
    return json(400, { error: e.message });
  }

  /* The success and cancel pages are this site's own, never a URL the caller
     supplied — otherwise the endpoint is an open redirect with Stripe's name
     on it. URL is only used for its origin. */
  const origin = new URL(req.url).origin;

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  /* The code is checked here as well as in validate-code, because that
     endpoint is a courtesy to the cart display and this one settles the
     money. A bad code refuses the session outright rather than falling back
     to the regular price: the customer last saw a reduced total, and quietly
     charging the full one is worse than an error. */
  let fnf = null;
  if (code !== null) {
    const match = matchCode(code, codes());
    if (!match.ok) {
      return json(400, { error: 'That code is not valid.', reason: match.reason });
    }
    if (!fnfConfigured()) {
      return json(500, { error: 'Codes are not available just now.', reason: 'unconfigured' });
    }
    try {
      if (await exhausted(stripe, match.entry)) {
        return json(400, { error: 'That code has reached its limit.', reason: 'exhausted' });
      }
    } catch (e) {
      console.error('checkout: redemption check failed:', e && e.message);
    }
    fnf = match.entry.code;
  }

  try {
    /* The amounts are read back from Stripe rather than kept in a second copy
       here, so the shipping threshold is decided against the same numbers the
       customer is charged. A cart with a voucher code skips the threshold
       entirely — postage is waived — but the regular prices are still read,
       because they are what validates the cart. */
    const ids = [...new Set(lines.map((l) => CATALOGUE[l.sku]))];
    const prices = await Promise.all(ids.map((id) => stripe.prices.retrieve(id)));
    const priceById = Object.fromEntries(prices.map((p) => [p.id, p]));
    const regularSubtotal = subtotalRappen(lines, priceById);

    /* The F&F prices are not needed to charge — the Price id is what the line
       item carries — but they are checked, so a price left in the wrong
       currency or made recurring fails here rather than halfway through a
       customer's checkout. */
    if (fnf) {
      const fnfCatalogue = FNF_CATALOGUE();
      const fnfIds = [...new Set(lines.map((l) => fnfCatalogue[l.sku]))];
      const fnfPrices = await Promise.all(fnfIds.map((id) => stripe.prices.retrieve(id)));
      subtotalRappen(lines, Object.fromEntries(fnfPrices.map((p) => [p.id, p])), fnfCatalogue);
    }

    const session = await stripe.checkout.sessions.create(
      sessionParams(lines, regularSubtotal, origin, fnf)
    );
    return json(200, { url: session.url });
  } catch (e) {
    console.error('checkout session failed:', e && e.message);
    return json(502, { error: 'could not start checkout' });
  }
}

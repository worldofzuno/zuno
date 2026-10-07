/**
 * Creates a Stripe Checkout Session.
 *
 * The client sends what the customer chose, never what it costs. Every amount
 * on this page comes out of the Stripe catalogue or out of the constants
 * below; nothing a browser sends is trusted with money.
 *
 *   POST /.netlify/functions/create-checkout-session
 *   { "items": [ { "sku": "castano-500g", "qty": 2, "grind": "Whole Beans" } ],
 *     "code": "FAMILY26", "gift": "ZG-ABCD-EFGH-JKLM" }
 *   -> { "url": "https://checkout.stripe.com/..." }
 *
 * There are three separate money mechanisms here and they are deliberately
 * not the same thing:
 *
 *   promotion code  Stripe's own. `allow_promotion_codes: true` is the whole
 *                   of it — Stripe renders the field, validates the code and
 *                   computes the amount. There is no discount logic here,
 *                   because a discount this function could calculate is a
 *                   discount a customer could forge.
 *
 *   voucher code    A different Stripe Price per size. See fnf.mjs for why a
 *                   coupon cannot express two different reductions under one
 *                   code. It also carries free postage.
 *
 *   gift card       Money already paid, held against a balance and applied as
 *                   a single-use coupon for exactly the amount held. It pays
 *                   for coffee only — never for another gift card, and never
 *                   for postage, which is a limit of Stripe coupons rather
 *                   than a decision.
 *
 * A Checkout Session takes at most one discount, so a gift card and a public
 * promotion code cannot both be used on one order. A voucher code and a gift
 * card can, because the voucher is a price rather than a discount.
 */

import Stripe from 'stripe';
import { codes, matchCode, exhausted, allow, FNF_CATALOGUE, fnfConfigured } from './lib/fnf.mjs';
import * as gift from './lib/giftcard.mjs';
import { sessionAccount, readCookie } from './lib/auth.mjs';
import * as stock from './lib/stock.mjs';

/* ------------------------------------------------------------------ config */

/**
 * SKU -> Stripe Price ID. The client may only name a key of this map, or the
 * one custom SKU below.
 *
 * The ids come from the environment rather than from here, because test and
 * live mode have different ones and the same file has to serve both. See
 * .env.example for the sandbox values. Every price is CHF with tax_behavior
 * "inclusive", which Stripe will not let us change later — CHF 14.90 is what
 * the shelf says, tax and all.
 */
const CATALOGUE = () => ({
  'castano-200g': process.env.STRIPE_PRICE_CASTANO_200G,
  'castano-500g': process.env.STRIPE_PRICE_CASTANO_500G,
  'gift-25': process.env.STRIPE_PRICE_GIFT_25,
  'gift-50': process.env.STRIPE_PRICE_GIFT_50,
  'gift-100': process.env.STRIPE_PRICE_GIFT_100,
});

/** What gets packed into a parcel. Everything else is delivered by email. */
export const PHYSICAL = new Set(['castano-200g', 'castano-500g']);

/**
 * The gift card for an amount the buyer chooses.
 *
 * This one line is not in the catalogue, because its amount comes from the
 * client — the only amount on this page that does. That is safe where a
 * product price would not be: the customer pays exactly the figure they
 * typed and receives exactly that much credit, so there is nothing to gain by
 * lying about it. The server still clamps it, and the card is issued from
 * what Stripe says was *paid*, never from what was requested.
 *
 * An upper bound is not optional. Without one the shop is a way to move any
 * sum of money through a coffee brand.
 */
const CUSTOM_GIFT = 'gift-custom';
const GIFT_MIN = 1500;    // CHF 15.00 — below the smallest bag is a card that buys nothing
const GIFT_MAX = 20000;   // CHF 200.00
const GIFT_PRODUCT = () => process.env.STRIPE_PRODUCT_GIFT;

/**
 * The smallest amount Stripe will charge in CHF.
 *
 * It matters because a gift card is applied as a coupon for the amount it
 * can cover, and a card a few rappen short of the cart leaves a remainder
 * Stripe refuses: 59.80 of coffee with free postage against a 59.50 card
 * asked for 0.30 and the customer could not pay at all, while their
 * balance and the bags stayed reserved for the day. Either the card covers
 * the whole total — which is fine, Stripe then asks for no payment at all
 * — or it leaves at least this much to charge.
 */
const STRIPE_MIN_RAPPEN = 50;

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
 * outright, whatever the cart is worth. Nor does a gift card, which is a
 * payment rather than a price and leaves the threshold where it was.
 */
const THRESHOLD = 'before';

const ALLOWED_COUNTRIES = ['CH', 'LI'];

/* ------------------------------------------------------- pure, and tested */

export function parseCart(body) {
  if (!body || typeof body !== 'object') throw new Error('body must be an object');
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw new Error('items must be a non-empty array');
  if (items.length > 10) throw new Error('too many lines');

  const catalogue = CATALOGUE();
  const seen = new Set();
  return items.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`items[${i}] must be an object`);
    const sku = String(raw.sku || '');
    const known = Object.prototype.hasOwnProperty.call(catalogue, sku) || sku === CUSTOM_GIFT;
    if (!known) throw new Error(`items[${i}].sku is not a product`);

    /* A grind is a property of coffee. On a gift card it is noise, and
       carrying it into the order would tell whoever packs the parcel to grind
       something that does not exist. */
    const grind = PHYSICAL.has(sku)
      ? (GRINDS.includes(raw.grind) ? raw.grind : GRINDS[0])
      : null;

    let amount = null;
    if (sku === CUSTOM_GIFT) {
      amount = Number(raw.amount);
      if (!Number.isInteger(amount) || amount < GIFT_MIN || amount > GIFT_MAX) {
        throw new Error(
          `items[${i}].amount must be a whole number of rappen from ${GIFT_MIN} to ${GIFT_MAX}`
        );
      }
    }

    const key = `${sku}|${grind}|${amount}`;
    if (seen.has(key)) throw new Error('duplicate line; merge the quantities');
    seen.add(key);

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new Error(`items[${i}].qty must be a whole number from 1 to ${MAX_QTY}`);
    }
    return { sku, qty, grind, amount };
  });
}

/** The code, if the client sent one at all. An absent field is the normal
    case and must not look like a failed code. */
function oneCode(raw, what) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error(`${what} must be a string`);
  if (raw.length > 64) throw new Error(`that ${what} is not valid`);
  return raw;
}

export const parseCode = (body) => oneCode(body && body.code, 'code');
export const parseGift = (body) => oneCode(body && body.gift, 'gift card');

/** What one line costs, in rappen, from the catalogue's own amounts. */
function unitAmount(line, priceById, catalogue) {
  if (line.sku === CUSTOM_GIFT) return line.amount;
  const price = priceById[catalogue[line.sku]];
  if (!price || typeof price.unit_amount !== 'number') {
    throw new Error(`price for ${line.sku} has no unit_amount; is it a recurring price?`);
  }
  if (price.currency !== 'chf') throw new Error(`price for ${line.sku} is not in CHF`);
  return price.unit_amount;
}

/** Subtotal in rappen, never the client's arithmetic. */
export function subtotalRappen(lines, priceById, catalogue = CATALOGUE()) {
  return lines.reduce((sum, l) => sum + unitAmount(l, priceById, catalogue) * l.qty, 0);
}

/** The same, over the lines that go in a parcel. */
export function physicalSubtotal(lines, priceById, catalogue = CATALOGUE()) {
  return subtotalRappen(lines.filter((l) => PHYSICAL.has(l.sku)), priceById, catalogue);
}

export const hasPhysical = (lines) => lines.some((l) => PHYSICAL.has(l.sku));

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
 * How much credit to reserve, so that what is left is chargeable.
 *
 * Returns the smaller of what the cart needs and what the card holds —
 * except when that would leave a remainder between a rappen and 49, in
 * which case it asks for less and leaves Stripe its minimum. It cannot ask
 * for more: a card thirty rappen short of the cart has not got the thirty
 * rappen, so trimming is the only direction available. The rappen it does
 * not use stay on the card.
 *
 * @param payable  what the coffee on this order costs, in rappen
 * @param balance  what the card can spend right now
 * @param postage  what will be charged for shipping, which is part of the
 *                 bill and so part of what keeps the total chargeable
 */
export function creditToAsk(payable, balance, postage, min = STRIPE_MIN_RAPPEN) {
  const cover = Math.min(payable, Math.max(0, balance));
  const rest = payable - cover + postage;
  if (rest === 0 || rest >= min) return cover;
  const trimmed = cover - (min - rest);
  return trimmed > 0 ? trimmed : 0;
}

/** Which Price a line points at. A voucher price exists for coffee only, so a
    gift card keeps its own price whatever code is in force. */
function priceIdFor(line, fnfCode) {
  const special = fnfCode ? FNF_CATALOGUE()[line.sku] : null;
  return special || CATALOGUE()[line.sku];
}

/**
 * @param lines    what the customer chose
 * @param subtotal in rappen, at the REGULAR prices of the physical lines —
 *                 this decides shipping
 * @param origin   this site, for the return pages
 * @param opts     { fnfCode, coupon, now } — a validated voucher code, the id
 *                 of a single-use coupon standing for a gift card balance,
 *                 and the clock, so the expiry is testable
 */
export function sessionParams(lines, subtotal, origin, opts = {}) {
  const { fnfCode = null, coupon = null, now = Date.now() } =
    typeof opts === 'string' ? { fnfCode: opts } : opts;
  const ships = hasPhysical(lines);

  const params = {
    mode: 'payment',
    ui_mode: 'hosted_page',
    /* Thirty minutes, which is the least Stripe permits. Until this was
       set a session lived for 24 hours, and so did everything it had
       reserved: six started-and-abandoned checkouts emptied a shelf of six
       for a day, costing nothing and showing nowhere. A customer who walks
       away now costs the shop half an hour, and one who is still typing
       their card number has longer than they need. */
    expires_at: Math.floor(now / 1000) + 30 * 60,
    line_items: lines.map((l) => (l.sku === CUSTOM_GIFT
      ? {
        /* The only inline amount on this page, and the only one the customer
           chose. It was clamped in parseCart and is paid in full. */
        price_data: {
          currency: 'chf',
          product: GIFT_PRODUCT(),
          unit_amount: l.amount,
          tax_behavior: 'inclusive',
        },
        quantity: l.qty,
      }
      : { price: priceIdFor(l, fnfCode), quantity: l.qty })),
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    /* The prices carry tax_behavior "inclusive" — CHF 14.90 is what the shelf
       says, VAT and all — so Stripe must not add tax on top. */
    automatic_tax: { enabled: false },
    /* Every amount in this shop is whole rappen of CHF: the gift card
       ledger, the coupon standing for a balance, the figures in the mails.
       Adaptive Pricing, which is on by default on the account, can present
       and settle a session in the customer's own currency instead — and a
       CHF coupon does not belong to a session in euros. Pinned here rather
       than only switched off in the Dashboard, so a change there cannot
       quietly bring it back. */
    adaptive_pricing: { enabled: false },
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

  /* Nothing to deliver means nothing to ask an address for. A gift card goes
     to an inbox, and a shipping form in front of it is a question with no
     answer. */
  if (ships) {
    params.shipping_address_collection = { allowed_countries: ALLOWED_COUNTRIES };
    params.shipping_options = [shippingOption(subtotal, !!fnfCode)];
  }

  /* Stripe allows `discounts` or `allow_promotion_codes`, never both, and at
     most one discount either way. A gift card occupies that slot. */
  if (coupon) {
    params.discounts = [{ coupon }];
  } else {
    /* Off while a voucher price is in force: that reduction is already in the
       line item, and letting a public code land on top would compound two
       reductions that were never meant to meet. */
    params.allow_promotion_codes = !fnfCode;
  }

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

  /* Before anything else, because every call past this point reserves
     stock, reads a voucher code and may create a Stripe coupon. The limit
     next door on validate-code was worth nothing while the same codes
     could be tried here without one. Ten in five minutes: starting a
     checkout is a rarer thing than mistyping a code, so the window is
     longer than the code fields' minute. Like theirs it lives in the
     function instance and blunts one client rather than a distributed
     attempt — the shorter reservation is what actually protects the shelf. */
  const ip = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || 'anonymous';
  if (!allow('checkout:' + ip, Date.now(), 10, 5 * 60_000)) {
    return json(429, { error: 'Too many attempts. Please wait a moment.', reason: 'rate' });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, { error: 'checkout is not configured' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  /* No pinned apiVersion here, deliberately. The session this function
     creates carries the Checkout Studio parameters — ui_mode "hosted_page",
     origin_context, integration_identifier — and none of those exist in
     2024-06-20. Stripe rejects an unknown parameter rather than ignoring it,
     so every checkout came back as a 502 the moment it ran against the real
     API. Nothing caught it earlier: the local harness substitutes
     sessions.create, which is exactly the call that was wrong.

     Leaving it out means the SDK sends its own version, the one its types
     were generated from, so the parameters it accepts and the ones Stripe
     accepts are the same set. What this function reads back — a price's
     unit_amount, a coupon id, a session's id and url — has been stable
     across every version in between.

     The webhook and the status endpoint keep their pin: they parse event
     and session shapes, where a version change is a behaviour change. */
  const stripe = new Stripe(key);
  const { status, payload } = await build(stripe, body, new URL(req.url).origin, {
    cookie: req.headers.get('cookie'),
  });
  return json(status, payload);
}

/**
 * Everything the handler does once it has a Stripe client and a body.
 *
 * Separate so the branches that matter — a voucher code, a gift card hold, a
 * coupon of exactly the held amount — are reachable in a test and in the
 * local harness without the network, the same way the webhook's handleEvent
 * is. The handler above adds nothing but parsing and a Response.
 */
export async function build(stripe, body, origin, opts = {}) {
  const json = (status, payload) => ({ status, payload });

  /* If the customer is signed in, the order is filed under their account.
     Taken from the cookie, never from the body: a client that could name an
     account would be able to file its orders under someone else's. */
  let accountId = null;
  let accountEmail = null;
  try {
    const account = await sessionAccount(readCookie(opts.cookie));
    if (account) { accountId = account.id; accountEmail = account.email; }
  } catch (e) {
    /* A lookup that fails must not stop someone buying coffee. They lose the
       history entry, not the order. */
    console.error('checkout: could not read the session:', e && e.message);
  }

  let lines;
  let code;
  let giftCode;
  try {
    lines = parseCart(body);
    code = parseCode(body);
    giftCode = parseGift(body);
  } catch (e) {
    return json(400, { error: e.message });
  }

  const catalogue = CATALOGUE();
  const needed = [...new Set(lines.map((l) => l.sku))].filter((s) => s !== CUSTOM_GIFT);
  if (needed.some((s) => !catalogue[s])) return json(500, { error: 'checkout is not configured' });
  if (lines.some((l) => l.sku === CUSTOM_GIFT) && !GIFT_PRODUCT()) {
    return json(500, { error: 'checkout is not configured' });
  }

  /* The voucher code is checked here as well as in validate-code, because
     that endpoint is a courtesy to the cart display and this one settles the
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

  let coupon = null;
  let held = 0;
  let holdRef = null;
  let heldCard = null;
  let stockRef = null;
  try {
    const ids = [...new Set(needed.map((s) => catalogue[s]))];
    const prices = await Promise.all(ids.map((id) => stripe.prices.retrieve(id)));
    const priceById = Object.fromEntries(prices.map((p) => [p.id, p]));

    /* The regular prices decide shipping; the voucher prices decide what is
       charged. Both are read from Stripe rather than kept in a second copy
       here. */
    const shippingBasis = physicalSubtotal(lines, priceById);

    let fnfPriceById = priceById;
    let fnfCatalogue = catalogue;
    if (fnf) {
      /* Only the keys the voucher actually has a price for. Spreading the map
         whole would overwrite a gift card's price with undefined. */
      const special = Object.fromEntries(
        Object.entries(FNF_CATALOGUE()).filter(([, id]) => Boolean(id))
      );
      fnfCatalogue = { ...catalogue, ...special };
      const fnfIds = [...new Set(needed.map((s) => fnfCatalogue[s]))].filter((id) => !priceById[id]);
      const extra = await Promise.all(fnfIds.map((id) => stripe.prices.retrieve(id)));
      fnfPriceById = { ...priceById, ...Object.fromEntries(extra.map((p) => [p.id, p])) };
      /* Checked, not merely used: a voucher price left in the wrong currency
         or made recurring fails here rather than halfway through a checkout. */
      subtotalRappen(lines, fnfPriceById, fnfCatalogue);
    }

    /* A gift card pays for coffee. Not for another gift card — that would
       only churn credit from one code into a new one — and not for postage,
       which Stripe coupons cannot reach. */
    if (giftCode !== null) {
      const payable = physicalSubtotal(lines, fnfPriceById, fnfCatalogue);
      const card = await gift.load(giftCode);
      if (!card) return json(400, { error: 'That gift card is not valid.', reason: 'unknown' });
      const balance = gift.available(card);
      if (balance <= 0) {
        return json(400, { error: 'That gift card is empty.', reason: 'empty' });
      }
      if (payable <= 0) {
        return json(400, {
          error: 'A gift card cannot pay for a gift card. Add some coffee to use it.',
          reason: 'nothing-payable',
        });
      }

      /* The session id has to exist before the hold can name it, and the
         coupon has to exist before the session can carry it. So: reserve
         against a reference of our own, then let the webhook settle it. */
      holdRef = `pre_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

      /* Postage is read off the same rule that will be put on the session,
         rather than worked out a second time here. */
      const postage = shippingOption(shippingBasis, !!fnf)
        .shipping_rate_data.fixed_amount.amount;
      const res = await gift.hold(card.code, holdRef, creditToAsk(payable, balance, postage));
      if (!res.ok) return json(400, { error: 'That gift card is empty.', reason: res.reason });
      held = res.amount;

      /* The balance above was read before the hold, and somebody else's
         order may have landed in between — so the amount actually held can
         be smaller than the one asked for, and land in the gap after all.
         Rare, and it resolves itself on a second try. */
      const rest = payable - held + postage;
      if (rest > 0 && rest < STRIPE_MIN_RAPPEN) {
        await gift.release(card.code, holdRef);
        held = 0;
        return json(409, {
          error: 'That gift card was being used somewhere else just now. Please try again.',
          reason: 'retry',
        });
      }
      heldCard = card.code;

      /* Restricted to the coffee products on this order, which is what stops
         the credit being spent on a new card. The two sizes keep the same
         Product whether the voucher price applies or not, so this holds
         either way. */
      const coffeeProducts = [...new Set(
        lines
          .filter((l) => PHYSICAL.has(l.sku))
          .map((l) => fnfPriceById[fnfCatalogue[l.sku]])
          .map((p) => (p && (typeof p.product === 'string' ? p.product : p.product && p.product.id)))
          .filter(Boolean)
      )];
      if (!coffeeProducts.length) throw new Error('no coffee product to apply the gift card to');

      const made = await stripe.coupons.create({
        amount_off: held,
        currency: 'chf',
        duration: 'once',
        max_redemptions: 1,
        redeem_by: Math.floor((Date.now() + gift.HOLD_TTL_MS) / 1000),
        name: `Gift card ${card.code}`,
        applies_to: { products: coffeeProducts },
        metadata: { gift_code: card.code, gift_hold: String(held), hold_ref: holdRef },
      });
      coupon = made.id;
    }

    /* The shelf, if a number is set for it. Held under the same reference as
       the gift card so one webhook resolves both, and held AFTER the prices
       are known so a cart that was never going to work does not reserve
       anything. A size with no number set holds nothing. */
    stockRef = holdRef || `pre_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const shelf = await stock.holdCart(lines, stockRef);
    if (!shelf.ok) {
      stockRef = null;
      /* holdCart already gave back the lines it had taken. What it knows
         nothing about is the gift card held a few lines above, and leaving
         that standing would freeze a customer's balance for half an hour
         over an order that never happened. */
      if (held > 0 && heldCard && holdRef) {
        try {
          await gift.release(heldCard, holdRef);
        } catch (inner) {
          console.error('checkout: could not release the gift card hold:', inner && inner.message);
        }
      }
      return json(409, {
        error: shelf.available > 0
          ? `Only ${shelf.available} left of that one. Please lower the quantity.`
          : 'That one just sold out.',
        reason: 'out-of-stock',
        sku: shelf.sku,
        available: shelf.available,
      });
    }

    const params = sessionParams(lines, shippingBasis, origin, { fnfCode: fnf, coupon });
    params.metadata.stock_ref = stockRef;
    if (accountId) params.metadata.account = accountId;
    /* One field the customer does not have to type again. It also ties the
       order to the address the account is under, rather than to whatever was
       typed at the till. */
    if (accountEmail) params.customer_email = accountEmail;
    if (heldCard) {
      /* The webhook settles the hold, and these three are how it finds it. */
      params.metadata.gift_code = heldCard;
      params.metadata.gift_hold = String(held);
      params.metadata.gift_ref = holdRef;
    }

    const session = await stripe.checkout.sessions.create(params);
    return json(200, { url: session.url });
  } catch (e) {
    /* A hold taken for a session that never came into being must go back, or
       the balance stays frozen for half an hour for nothing. */
    if (held > 0 && heldCard && holdRef) {
      try {
        await gift.release(heldCard, holdRef);
      } catch (inner) {
        console.error('checkout: could not release the gift card hold:', inner && inner.message);
      }
    }
    if (stockRef) {
      try {
        await stock.releaseCart(lines, stockRef);
      } catch (inner) {
        console.error('checkout: could not release the stock hold:', inner && inner.message);
      }
    }
    console.error('checkout session failed:', e && e.message);
    return json(502, { error: 'could not start checkout' });
  }
}

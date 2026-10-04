# Stripe Integration — Remaining Steps

This file is the single source of truth for what is still outstanding on the
ZUNO Stripe integration. Everything described as done has been verified
against the live Stripe API in sandbox mode, not just against the tests.

This was **Scenario A**: a Checkout Session call already existed, at
[netlify/functions/create-checkout-session.mjs](netlify/functions/create-checkout-session.mjs).
Only the parameters of that call were changed. No routes, files or
infrastructure were restructured.

---

## Values to Replace

Nothing in the committed code holds a placeholder price id, URL or mode — the
existing call already had real values and they were kept. What is missing is
**live-mode configuration**, which cannot live in the repository at all.

**Files containing values you must set (as environment variables, not in code):**

- [.env.example](.env.example) — documents every variable and the sandbox values
- Netlify → Site configuration → Environment variables — where the real ones go

| Field | Current value | What to set |
|---|---|---|
| `STRIPE_SECRET_KEY` | empty | Your secret key. `sk_test_…` while testing, `sk_live_…` when live. Dashboard → Developers → API keys. Server-side only. |
| `STRIPE_PRICE_CASTANO_200G` | sandbox `price_1ULOWi…` | The **live** Price id for the CHF 14.90 bag, once you create it in live mode. |
| `STRIPE_PRICE_CASTANO_500G` | sandbox `price_1ULOWl…` | The **live** Price id for the CHF 29.90 bag. |
| `STRIPE_PRICE_FNF_CASTANO_200G` | sandbox `price_1UMVQy…` | The **live** Family & Friends Price for CHF 11.00. |
| `STRIPE_PRICE_FNF_CASTANO_500G` | sandbox `price_1UMVR6…` | The **live** Family & Friends Price for CHF 20.00. |
| `FNF_CODES` | empty | The Family & Friends codes, as JSON. See *Setting the code* below. Empty means no code works. |
| `STRIPE_PRICE_GIFT_25` / `_50` / `_100` | sandbox ids | The **live** gift card Prices, on a product marked `shippable: false`. |
| `STRIPE_PRODUCT_GIFT` | sandbox `prod_VNGsiJ…` | The **live** gift card Product. The chosen-amount option bills against it inline, so there is no fourth Price. |
| `MAIL_PROVIDER`, `RESEND_API_KEY` or `POSTMARK_SERVER_TOKEN` | empty | Your mail provider. **Until one is set, no mail is sent** — order confirmations and gift card codes go to the function log instead. |
| `MAIL_FROM` | `noreply@worldofzuno.com` | Must be on a domain the provider has verified, or every message is refused. |
| `MAIL_TO` | empty | Where new-order notices reach you. |
| `STRIPE_WEBHOOK_SECRET` | empty | The signing secret of your webhook endpoint, `whsec_…`. Each endpoint has its own, and test and live differ. |
| `ORDER_NOTIFY_URL` | empty | Optional. Where a paid order is POSTed as JSON. Unset is supported — orders go to the Netlify function log instead, which is durable but is not an inbox. |

Also outstanding, outside the code:

- Create the live-mode Products and Prices (four of them: two regular, two
  Family & Friends), all CHF with `tax_behavior: inclusive`. **`tax_behavior`
  cannot be changed once set**, so get it right at creation.
- Create the live-mode coupon and promotion code for the public 15% discount
  (sandbox has coupon `zuno-15`, code `ZUNO15`).
- Decide on Adaptive Pricing. It is currently **on**, which lets Stripe show
  foreign customers their own currency. Harmless, but it is a pricing
  decision, not a default to inherit silently.
- Fill the visible analytics placeholder in the Privacy Policy.

---

## Configured Parameters

These are set on the Checkout Session, in
[netlify/functions/create-checkout-session.mjs](netlify/functions/create-checkout-session.mjs)
(`sessionParams`). Each one was accepted by the live API in sandbox mode.

| Parameter | Value |
|---|---|
| `ui_mode` | `hosted_page` |
| `mode` | `payment` |
| `billing_address_collection` | `auto` |
| `phone_number_collection` | `{ enabled: false }` |
| `automatic_tax` | `{ enabled: false }` |
| `allow_promotion_codes` | `true`, or `false` while a Family & Friends price is in force |
| `submit_type` | `auto` |
| `origin_context` | `web` |
| `integration_identifier` | `hosted_web_0001` |

`ui_mode` is `hosted_page` because the installed SDK is `stripe@22.6.2`.
Anything below 21.0.0 would need `hosted` instead.

### Two configured values were deliberately not sent

Both would have broken the call or the shop. Neither is an oversight.

- **`payment_method_collection: "always"`** — the API states this *"can only
  be set in `subscription` mode"*. This shop sells one-time orders, so sending
  it fails the request. Stripe sets `if_required` itself on a payment-mode
  session, which the created sessions confirm.
- **`saved_payment_method_options: { payment_method_save: "enabled" }`** —
  saving a payment method requires a Customer (`customer`, or
  `customer_creation: "always"`), applies to cards only, and Stripe requires
  explicit consent language on the site before card details may be stored.
  ZUNO has no customer accounts and no such terms. Sending it would either
  fail or start storing cards without the consent that makes it lawful.

### One instruction was not followed

The generated brief said to *remove any parameters absent from the field
intents*. Doing that would have deleted `shipping_address_collection`,
`shipping_options` and `metadata` — switching off the CHF 7 postage and the
free-shipping threshold, and losing the grind that whoever packs the parcel
needs. Those three are kept, and a test asserts they are still there.

---

## Family & Friends codes

The customer never sees that name. The field in the cart is labelled
**Voucher code**, and the summary row reads **Voucher**. "Family & Friends"
survives only in the code, the environment variable and the order metadata,
where it is a useful name for what the mechanism is.

### What it does

A valid code charges CHF 11.00 for the 200 g bag and CHF 20.00 for the 500 g
bag, instead of CHF 14.90 and CHF 29.90. The grind does not affect the price.

**It also waives postage**, whatever the cart is worth. A code cart never
reaches the CHF 45 free-shipping threshold, because shipping is already free.
The threshold still governs every cart without a code.

### Why it is not a coupon

The two reductions differ — −26.17% and −33.11% — and Stripe cannot express
that under one code:

- A Checkout Session takes at most one discount: *"The coupon or promotion
  code to apply to this Session. Currently, only up to one may be specified."*
- A promotion code points at exactly one coupon.
- `coupon.applies_to` restricts by **product**, not by price, and the two
  sizes are separate products.

So the special price is a **Price**, and the server decides which one a line
item points at. Nothing about the amount is computed here, and the browser
never sends one.

### Setting the code

One environment variable, `FNF_CODES`, holding JSON:

```json
[{ "code": "FAMILY26", "expires": "2026-12-31", "maxRedemptions": 100 }]
```

- `code` is required: letters, digits and hyphens, 3–64 characters. Matched
  case-insensitively, with spaces ignored, so `family 26` works.
- `expires` is optional, `YYYY-MM-DD`, valid to the end of that day.
- `maxRedemptions` is optional.
- Several entries are allowed, so a code can be rotated by adding the new one
  before removing the old.

**To disable a code**, delete its entry. **To disable the feature**, leave the
variable empty. Malformed JSON disables every code rather than enabling them,
so a typo closes the door rather than opening it.

**Netlify reads environment variables at cold start, so a change needs a
redeploy to take effect.** There is no way around this short of moving the
codes into a datastore.

Treat `FNF_CODES` as a secret: it *is* the code.

### Two honest limits

- **The usage limit is eventually consistent.** Netlify functions keep no
  state, so the count is read from Stripe: every F&F payment carries the code
  in its PaymentIntent metadata, and succeeded PaymentIntents carrying it are
  the redemptions. Stripe's search index lags by up to a minute, so a burst of
  orders inside that window could overshoot the limit slightly. Expiry and
  switching a code off are exact; only the count is approximate.
- **If Stripe's search is unavailable, the code is allowed through** rather
  than refused. A few extra bags of coffee is a smaller problem than a shop
  that turns away its own family. If you would rather it failed closed, the
  decision is one line in `exhausted()` in
  [netlify/functions/fnf.mjs](netlify/functions/fnf.mjs).

### Rate limiting

`validate-code` allows ten attempts per minute per IP address. The counter
lives in the function instance, so it limits per instance rather than
globally: it blunts one client hammering one warm instance and is **not** a
defence against a distributed guessing attempt. **The real protection is a
code long enough not to be guessed** — prefer something like `ZUNO-FAM-7K2M`
over `FAMILY`.

---

## Gift cards

Stored value, bought in the shop and spent in it. Built, tested and running —
the earlier note in this file saying it did not exist is out of date.

### What a customer sees

A **Gift Card** page, linked from the menu, sells CHF 25, 50 or 100, or any
amount from CHF 15 to CHF 200. It lands in the cart like any other item,
except that nothing is posted: a cart with no coffee in it asks for no
address and offers no postage, and the summary says *Delivered by email*.

The code is redeemed in the same **Voucher code** field as everything else.
The server says which kind of code it is, so the customer never has to know
there are two systems.

### The rules, and why

| Combination | Rule | Why |
|---|---|---|
| Voucher + public promotion code | **Mutually exclusive** | The voucher price *is* the reduction. `allow_promotion_codes: false`, so Stripe does not render the field. |
| Voucher + gift card | **Allowed, stacks** | A gift card is tender, not a price cut. It pays whatever is owed after the voucher. |
| Gift card + public promotion code | **Not possible** | Stripe allows `discounts` or `allow_promotion_codes`, never both, and at most one discount. The gift card takes that slot. This is a Stripe limit, not a decision. |
| Gift card pays for a gift card | **Refused** | Otherwise credit is churned from one code into a new one. The coupon is restricted to the coffee products on the order, and a cart with no coffee is turned away with a message that says so. |
| Gift card pays for postage | **Not possible** | A Stripe coupon applies to line items only. A gift card never covers the CHF 7. |
| Gift card is discounted when bought | **Never** | The card is issued from what Stripe says was **paid**, not from its face value. A 15% code on a CHF 50 card would otherwise be a way to buy francs at 85. |

### How a redemption cannot go wrong

Netlify Blobs backs the balance, and conditional writes are the whole point:
two browsers redeeming the same card both read CHF 50 and both write CHF 0
without them. Three operations carry a redemption:

- **hold** at session creation — the amount stops being available, and the
  coupon is minted for exactly the amount held, never for what was asked.
- **settle** when Stripe reports the payment — the hold becomes a spend.
  Replayed events settle once.
- **release** when the session expires or the payment fails — it goes back.

A hold nobody resolves stops counting after 26 hours, so a webhook that never
arrives cannot freeze a balance for good. A payment landing after that is
still recorded, loudly, because the card may be overdrawn in between.

### Issuing

The webhook mints the cards an order bought, claiming a marker in the store
first so a redelivery cannot mint a second set. Codes read `ZG-XXXX-XXXX-XXXX`
over 31 characters with no `0`, `O`, `1`, `I` or `L` — they get read off a
screen and typed on a phone.

**Cards never expire**, as decided. The expiry field exists in the record and
is unused, so a future issue date can carry one without a rebuild.

### What is not built

- Sending the card straight to the recipient. As decided, the code goes to
  the buyer, who passes it on.
- ~~A way for you to look up or void a card.~~ Built: the back office at
  `/admin/`, which also takes the backup. See [BACKOFFICE.md](BACKOFFICE.md).
- VAT treatment of a voucher sale is **not** settled here. The prices carry
  `tax_behavior: inclusive` to match everything else, and `automatic_tax` is
  off, so nothing is computed either way — but whether issuing a voucher is a
  taxable supply in your case is a question for your accountant, not for this
  file.

---

## Project structure

New files:

```
netlify/functions/fnf.mjs               code parsing, matching, rate limit, redemption count
netlify/functions/validate-code.mjs     POST endpoint the cart calls
netlify/functions/store.mjs             Netlify Blobs, with conditional writes
netlify/functions/giftcard.mjs          the gift card ledger: hold, settle, release
netlify/functions/mailer.mjs            send, through whichever provider has a key
```

Each has a `.test.mjs` beside it.

Changed:

```
netlify/functions/create-checkout-session.mjs   optional code, price swap, Studio parameters
netlify/functions/stripe-webhook.mjs            records the code on a paid order
site/index.html                                 the code field in the cart, and nothing else
.env.example                                    the new variables
```

## How it works

1. The cart posts the typed code to `validate-code`, which answers with the
   amounts read from the Stripe Price objects. The cart redraws.
2. `Proceed to Checkout` posts the cart **and the code** — never a price — to
   `create-checkout-session`.
3. That function validates the code again for itself, selects the F&F Prices,
   measures the shipping threshold against the **regular** subtotal, and
   creates the session.
4. Stripe hosts the payment page and charges the amounts behind the Price ids.
5. `stripe-webhook` receives the result, verifies the signature, and records
   the order with the code on it — a F&F order shows `amount_discount: 0`, so
   the code is the only thing that explains the low total.
6. The success page asks `checkout-status` before clearing the cart, so
   `?checkout=success` typed by hand proves nothing.

## Testing

```
npm run test:functions     # 174 checks across the seven modules
```

Stripe's test cards, on the hosted page:

| Card | Outcome |
|---|---|
| `4242 4242 4242 4242` | succeeds |
| `4000 0025 0000 3155` | requires 3-D Secure authentication |
| `4000 0000 0000 9995` | declined, insufficient funds |

Any future expiry date and any CVC. TWINT and PayPal have their own sandbox
flows on the hosted page.

### Verifying the Family & Friends prices end to end

With `FNF_CODES` and both F&F price ids set in Netlify:

1. Put one 200 g and one 500 g bag in the cart. The cart reads CHF 44.80 plus
   CHF 7.00 postage, total CHF 51.80.
2. Enter the code in **Voucher code** and press Apply. The lines read
   CHF 11.00 and CHF 20.00, a `Voucher −CHF 13.80` row appears, Shipping
   reads **Free**, and the total reads **CHF 31.00**.
3. Press Proceed to Checkout. On Stripe's page the two line items must read
   **CHF 11.00** and **CHF 20.00**, shipping must be **CHF 0.00**, there must
   be **no promotion-code field**, and the total must be **CHF 31.00**.
4. Put a single 200 g bag in instead — CHF 14.90, far below the threshold.
   With the code the total is **CHF 11.00**, still with free shipping.
5. Pay with `4242 4242 4242 4242`. The function log line for the order ends
   with `— F&F FAMILY26`.
6. Enter a code that does not exist. The field says so, the prices return to
   CHF 14.90 and CHF 29.90, and postage comes back.

This was already verified against the live sandbox API: sessions created from
this code's own output returned `amount_total` of 3100 (11.00 + 20.00, free
shipping), 1100 (one small bag, free shipping) and 2190 (the regular path:
14.90 plus CHF 7 postage, with the promotion-code field on).

### Verifying gift cards

1. Open **Gift Card** from the menu, pick CHF 25, add it to the cart. The
   cart reads CHF 25.00, *Delivered by email*, no postage, total CHF 25.00.
2. Pick **Other**, type 5, then 500. The price reads `—` and Add to Cart is
   disabled both times. Type 35: CHF 35.00.
3. Pay with a test card. The confirmation mail carries a code like
   `ZG-XXXX-XXXX-XXXX`; the function log shows `[gift:issued]`.
4. Start a new order with one 200 g bag and enter that code. The summary
   shows `Gift card −CHF 14.90` and `CHF 10.10 stays on the card`, total
   CHF 7.00 — the postage, which a gift card never covers.
5. On Stripe's page there must be **no promotion-code field**: the card
   occupies the single discount slot.
6. Enter the code with a cart that holds only a gift card. The cart says
   *Add coffee to use the gift card*, and the checkout refuses it.
7. Abandon a checkout you started with the card, then re-enter the code. The
   full balance is back once the session expires.

Verified against the sandbox API: a cart of a CHF 35 gift card plus a
voucher-priced bag, with a coupon of 1100 restricted to the coffee product,
returned `amount_subtotal` 4600, `amount_discount` **1100** and
`amount_total` 3500 — the card paid for the coffee and not a rappen of the
gift card.

---

## Next steps

- Set the environment variables above in Netlify, then redeploy.
- Create the live-mode products, prices and coupon; swap the four price ids.
- Point a live webhook endpoint at `/.netlify/functions/stripe-webhook` and
  set its signing secret.
- Choose an `ORDER_NOTIFY_URL`, or enable Stripe's own payment-notification
  email, so a paid order reaches a person rather than only a log.
- Pull `main` forward — it is behind this branch.
- SEO has its own handover note: [SEO.md](SEO.md). The one item needing you
  is Google Search Console.
- Set `ADMIN_TOKEN` in Netlify and take a first backup from `/admin/`. Gift
  card balances are money you owe, and only this store knows what has been
  spent. See [BACKOFFICE.md](BACKOFFICE.md).
- Test the cart and the code field on a real iPhone.

## Resources

- <https://docs.stripe.com>
- <https://docs.stripe.com/mcp>
- <https://support.stripe.com>

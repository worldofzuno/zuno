# Switching Stripe to live

Everything in the shop already works; what changes is which Stripe account
it talks to. Test and live mode share no objects at all — every product,
price, coupon and webhook has to exist twice — so this is a list of things
to create and ten variables to swap, in an order that cannot leave the shop
half-switched.

Read it once before starting. The dangerous state is not "not yet live", it
is "live keys with test price ids", which takes real money for a charge
Stripe cannot complete.

## The 15% code must not reach a gift card

`zuno-15` had no product restriction, and the checkout offers the
promotion-code field to any cart without a voucher code — including one
holding a gift card. Someone buys a CHF 100 card, types ZUNO15, pays CHF 85
and receives CHF 100 of credit, with no redemption limit on either the
coupon or the code.

**Fixed in the sandbox on 2026-10-05**, which is also the recipe for live.
A coupon's `applies_to` can only be set when the coupon is created, and
Stripe will not have two active promotion codes with the same string, so it
took four steps in this order:

```
POST   /v1/coupons                  id=zuno-15-coffee
                                    name=ZUNO 15%  percent_off=15  duration=once
                                    applies_to[products][0]=<the 200 g product>
                                    applies_to[products][1]=<the 500 g product>
DELETE /v1/coupons/zuno-15          # frees the string ZUNO15
POST   /v1/promotion_codes          promotion[type]=coupon
                                    promotion[coupon]=zuno-15-coffee
                                    code=ZUNO15
GET    /v1/coupons/zuno-15-coffee   # applies_to is there, or it was not set
```

Deleting the old coupon leaves its promotion code in place but inactive, so
the history stays readable. Stripe then applies the 15% to the coffee lines
only, and a mixed cart still works the way a customer would expect.

Do the same in live mode. The last line is not optional: `applies_to` is
the one field that cannot be added afterwards, so if it is missing the
coupon has to be built again from the start.

## What has to exist in live mode

Created from the sandbox, field for field. `tax_behavior: inclusive`
throughout — the shelf price is what is paid.

**Two products, shippable, `unit_label: bag`, `tax_code: txcd_99999999`:**

| Name | metadata | Prices |
| --- | --- | --- |
| ZUNO Castano — 200 g | `sku=castano-200g`, `weight_g=200` | CHF 14.90 (default) · CHF 11.00 with `sku=castano-200g, tier=fnf` |
| ZUNO Castano — 500 g | `sku=castano-500g`, `weight_g=500` | CHF 29.90 (default) · CHF 20.00 with `sku=castano-500g, tier=fnf` |

Both description `Arabica 70% / Robusta 30%, roasted in Bern. Cappuccino and
espresso.`, both `url=https://worldofzuno.com/#product`.

The Family & Friends prices hang off the **same two products**, as a second
price each. They are prices rather than a discount because the two sizes are
reduced by different amounts (−26.17% and −33.11%) and a Checkout Session
takes at most one coupon.

**One gift card product, `shippable: false`, `metadata kind=giftcard,
sku=gift`,** description `Stored value for the ZUNO shop. Delivered by email
as a code; no postage, nothing to ship.`, `url=https://worldofzuno.com/#gift`
— with three prices:

| Price | metadata |
| --- | --- |
| CHF 25.00 | `kind=giftcard, sku=gift-25` |
| CHF 50.00 | `kind=giftcard, sku=gift-50` |
| CHF 100.00 | `kind=giftcard, sku=gift-100` |

The chosen-amount option has no price of its own: the amount is sent inline
against the product, clamped server-side to CHF 15–200, and the card is
issued from what Stripe says was **paid**.

**The coupon and its code**, as above, plus a promotion code `ZUNO15` on it.

**Nothing for postage.** The shipping rate is built inline per session from
`shipping_rate_data`, so there is no live object to create and no second
place for the CHF 7.00 and the CHF 45 threshold to drift.

**The payment methods.** Card, TWINT, PayPal and Link are a payment-method
configuration on the account, not something the code asks for. Live mode has
its own: check in the Dashboard that the four are on before the first real
customer, or they will see fewer ways to pay than the sandbox showed.

## The webhook

One endpoint, `https://worldofzuno.com/.netlify/functions/stripe-webhook`,
with exactly these four events:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
```

`charge.refunded` is the one that stops a refund being invisible: without
it a refunded order still reads as paid, the bags stay counted as sold,
and a gift card bought in that order stays spendable.

Its signing secret is **not** the test one. Each endpoint has its own.

## The ten variables

All in Netlify, all read at cold start, so none of them takes effect until
the next deploy.

| | |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `STRIPE_PRICE_CASTANO_200G` | the live CHF 14.90 price |
| `STRIPE_PRICE_CASTANO_500G` | the live CHF 29.90 price |
| `STRIPE_PRICE_FNF_CASTANO_200G` | the live CHF 11.00 price |
| `STRIPE_PRICE_FNF_CASTANO_500G` | the live CHF 20.00 price |
| `STRIPE_PRICE_GIFT_25` | the live CHF 25 price |
| `STRIPE_PRICE_GIFT_50` | the live CHF 50 price |
| `STRIPE_PRICE_GIFT_100` | the live CHF 100 price |
| `STRIPE_PRODUCT_GIFT` | the live gift card product |
| `STRIPE_WEBHOOK_SECRET` | the live endpoint's `whsec_…` |

`RESEND_WEBHOOK_SECRET` is Resend's, not Stripe's, and does not change
when Stripe does.

Netlify's API cannot update a variable that already exists — it answers 422
whatever the value — so each one is deleted and created again. Doing it in
the Dashboard avoids that entirely.

`FNF_CODES`, `ADMIN_TOKEN`, `MAIL_*` and `RESEND_API_KEY` do not change.

### Scope and the secret flag — do this while you are in there

Every one of the sixteen variables is currently scoped to **builds,
functions, post-processing and runtime**, and none is marked as containing
a secret value. Nothing here needs any of them at build time: the build
command is `echo`, because `site/` is already finished. What that scope
does mean is that a `postinstall` script in any dependency — the tree holds
`next`, `three` and `@playwright/test` — runs with the Stripe secret key,
the Resend key, both signing secrets and the admin token in its
environment, and that their values are readable in plain text in the
Netlify UI and can be printed into a build log.

Set every variable to **functions and runtime** only, and tick **contains
secret values** on these five:

| | |
| --- | --- |
| `STRIPE_SECRET_KEY` | the shop's money |
| `STRIPE_WEBHOOK_SECRET` | lets somebody forge an order |
| `RESEND_API_KEY` | lets somebody send mail as ZUNO |
| `RESEND_WEBHOOK_SECRET` | lets somebody forge a bounce |
| `ADMIN_TOKEN` | the back office |

In the Dashboard: **Site configuration → Environment variables**, then for
each one **Options → Edit**, untick the scopes, tick the secret box, save.
Two minutes for all sixteen.

With the CLI it is one line each, and `--secret` only on the five:

```
netlify env:set STRIPE_SECRET_KEY "sk_live_…" --scope functions,runtime --secret
netlify env:set STRIPE_PRICE_CASTANO_200G "price_…" --scope functions,runtime
```

A secret value cannot be read back afterwards, which is the point — so set
it from the value you have in hand, not from a copy you intend to fetch
later.

**Do it at the same time as the rotation.** The three secrets that have
been handled loosely so far (`ADMIN_TOKEN`, `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`) are being replaced anyway, and a new value typed
into a correctly scoped, secret-flagged variable is one step rather than
two. The live Stripe key has never existed yet, so it starts out right.

Not done from here on purpose: Netlify's API cannot change an existing
variable, only delete it and create it again, so doing this through the
API would take the live shop's credentials away for as long as the two
calls take, and would mean writing secret values back from somewhere they
should never have been kept.

## The order, and why

1. **Create everything in live mode first.** Nothing in the shop reads it
   yet, so there is no hurry and no risk.
2. **Create the live webhook endpoint** and note its signing secret.
3. **Swap all ten variables in one sitting.** Between the first and the last
   the shop is still running on the old ones, which is why this is not done
   across a lunch break.
4. **Deploy.** Until this, nothing has changed for anybody: the running
   functions still hold the old environment.
5. **Buy something, with a real card, for real money.** Then refund it.
   There is no live equivalent of a test card, and a shop whose first real
   charge is a customer's is a shop nobody has tested.
6. **Check all four:** Stripe shows the payment; the webhook delivery shows
   200; the mail arrives; the back office lists the order and the stock has
   gone down by one.

## Proving nothing is half-switched

The failure that costs money is live keys with test price ids. It announces
itself — Stripe refuses the session with *No such price* — so the shop
cannot charge for it. Check the mode marker instead:

```bash
curl -s https://worldofzuno.com/.netlify/functions/stock-levels      # still answers
curl -so /dev/null -w '%{http_code}\n' -X POST \
     -H 'content-type: application/json' -d '{}' \
     https://worldofzuno.com/.netlify/functions/stripe-webhook        # 400 = running
```

Then in `/admin/`: the mode marker at the top right reads **live** as soon
as a live card exists, derived from the cards themselves rather than from
configuration, so nobody voids a real card thinking it is a test one.

Keep the sandbox keys somewhere. Going back is the same ten variables and a
deploy.

## What can be done for you

With the account activated and the Stripe connector pointed at it, the
products, prices, coupon, promotion code and webhook endpoint can all be
created through the API in a few minutes, from the values above. The two
things that cannot: the secret key and the signing secret have to be copied
out of the Dashboard by hand, because Stripe shows each exactly once.

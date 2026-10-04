# Stock

How many bags there are, and why the shop can be trusted not to sell the
same one twice.

## It is off until you switch it on

Each size is its own record, and a size with **no record has no limit**. Both
sizes start that way. A shop that never opens this page behaves exactly as it
did before stock existed: nothing is counted, nothing is refused, no message
appears.

That default is the point. An inventory nobody maintains is not a safeguard,
it is a way to refuse orders you could have filled.

## Setting a number

Back office → **Stock**. A whole number from 0 to 100000 per size; empty
clears the limit and that size goes back to unlimited. `0` is a decision —
sold out — and is not the same as empty.

Gift cards are not stocked. They have no shelf.

## Hold, settle, release

A checkout is not instant. Somebody can sit on the Stripe page for ten
minutes with their card in their hand, and the last bag must not be sold out
from under them — nor stay reserved forever if they walk away. So the count
follows the same three moves as the gift card ledger:

| when | what happens |
| --- | --- |
| the checkout session is created | the bags are **held** — still on the shelf, no longer available |
| Stripe says it was paid | the hold **settles** — the count drops |
| the session expires or the payment fails | the hold is **released** — the count comes back |

Holding happens *after* the prices are worked out, so a cart that was never
going to work reserves nothing. It is all or nothing per cart: half an order
is not an order, and a cart that cannot be filled gives back whatever it had
already taken, the gift card hold included.

A hold nobody ever resolves stops counting after **26 hours**. A webhook that
never arrives can therefore cost you a day of availability, but not the bag.

Settling is recorded even if the hold had already expired. The goods are gone
either way, and a count that quietly forgets is worse than one showing zero.

## What the customer sees

The product page asks `/.netlify/functions/stock-levels` on load and again
when the cart is opened. It is a public, read-only count — a number of coffee
bags is not a secret — cached for thirty seconds.

- five or fewer left: *"Only 3 200g bags left."*
- none left: *"200g is sold out just now."*, the tile reads as sold out to a
  screen reader, and Add to Cart is off
- cart already holds everything left: *"Your cart already holds every 200g
  bag we have left."*

A cart that survived a reload can hold more than the shelf does. The cart
says so and lowers nothing by itself — the number in the page can be stale,
and silently editing somebody's basket over a figure we are not sure of is
the worse of the two mistakes.

**The page never decides.** Every count it shows is a courtesy. The checkout
holds the real stock and refuses with the real figure, and when it does, the
page takes the server's number over its own.

## If the count drifts

Set it again. There is no reconciliation pass and no audit trail for stock —
unlike a gift card balance, a wrong number here costs a message at the till,
not money. The one number worth keeping safe is in the backup anyway: the
export carries each size's record with its holds and its settled sales.

## Where it lives

| file | what it does |
| --- | --- |
| `netlify/functions/stock.mjs` | the ledger: hold, settle, release, per cart and per size |
| `netlify/functions/stock-levels.mjs` | the public count the page reads |
| `create-checkout-session.mjs` | holds the cart, answers `409 out-of-stock` |
| `stripe-webhook.mjs` | settles on paid, releases on expired or failed |
| `admin.mjs` | `stock-set`, plus stock in the summary and the export |

Twenty-five tests cover the ledger (`stock.test.mjs`), among them five
checkouts racing for three bags, a hold nobody ever resolved, a replayed
webhook, and a payment that lands after its hold expired.

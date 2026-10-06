# The back office

`https://worldofzuno.com/admin/` — gift card balances, accounts, and the
backup. It exists because the alternative was reading the Netlify Blobs store
by hand, and the first customer saying "my gift card does not work" needs an
answer rather than a guess.

## Getting in

One key, `ADMIN_TOKEN`, set in Netlify. No account system, no roles: it is
you or nobody.

```
openssl rand -base64 32
```

At least 24 characters or the function refuses to use it — a weak key is
worse than an obvious one, because it looks like a door. Treat it like the
Stripe secret key.

Typing it exchanges it for a session cookie that lasts twelve hours. The key
itself is never stored in the browser, so closing the tab on a shared machine
leaves nothing behind. Signing out ends the session server-side as well.

The page is kept out of search three ways: `robots.txt` disallows it, the
page carries a `noindex` meta, and `_headers` sends `X-Robots-Tag` for
`/admin/*`. A search result for "ZUNO back office" would be an invitation.

## What you can do

**See the orders and send them.** Paid orders come straight from Stripe,
newest first, with what was bought, where it goes and whether it has
already left. Marking one sent writes the customer a despatch mail with the
tracking number if you entered one. It goes **once**: the record is written
before the mail, and a second press is refused rather than telling somebody
twice that the same parcel left. An order with nothing to put in a box — a
gift card — is never offered the button, because the card went by mail at
purchase.

If the mail cannot be sent, the message says so plainly instead of claiming
the customer was told.

**A refunded order says so** and is offered no despatch button — and the
server refuses one anyway, because hiding a button is not a safeguard. A
full refund has already put the bags back on the shelf, voided any gift
card bought in that order and returned any credit spent on it. A **part**
refund reverses nothing: which line it belongs to is not in what Stripe
sends, so it is shown as a part refund and left to you.

**Run an order through again.** Stripe gives up redelivering a webhook
after about three days. After that the money is taken, the order is in
this list, and nothing in the shop ever happened — no confirmation, no
gift card, no stock movement. This button is the way back, and it runs the
same code the webhook runs rather than a second idea of what an order
means. Safe to press twice: an order that already went through answers
"already" and sends nothing.

**Look a gift card up** by code, however it was typed. You see the balance,
what was issued, what was spent, what is held by a checkout in flight, who
bought it, and every spend with its date and the order it went to. Spends
from before that was recorded show the internal hold reference instead,
greyed out — the order is still findable, by that reference in the Stripe
session's metadata.

**Void a card** whose code leaked or was issued by mistake. The balance drops
to zero and the card cannot be spent, but nothing is deleted — the history
stays and the void can be lifted again.

**Issue a card by hand** for a card sold away from the shop, or as a goodwill
gesture. It is a real card and real money. The code is shown once; write it
down.

**Find an account**, see its orders, sign it out of every device, or delete
it. Deleting from here needs no password — the key to the back office stands
in for it.

**Set the stock** per size: a whole number, or empty for no limit. Both sizes
start unlimited, so a shop that never touches this behaves as it always has.
`0` means sold out and is a decision; empty means not counted. The checkout
holds what it is about to sell, so two people cannot both take the last bag,
and a payment that is never finished puts it back. See
[STOCK.md](STOCK.md).

**Take a backup.** See below.

## The backup, and why it matters more than it looks

Gift card balances are money you owe. Stripe knows what was *bought*; only
this store knows what has been *spent*. Lose it and you cannot tell a
customer with a CHF 50 card whether they have CHF 50 or nothing left.

The export is every gift card ledger, every account with password
derivations stripped, and each size's stock record with its holds and its
settled sales. Take one before anything risky, and **keep it somewhere
other than Netlify** — a backup in the same place as the thing it backs up is
not a backup.

### The weekly one, which needs nobody

A button only helps in the week somebody presses it. `backup.mjs` runs
itself every Monday at 04:17 UTC and mails the same file to `MAIL_TO`, with
the figures that matter in the body — how many cards, how much is still
owed, how many accounts — so you can see whether anything moved without
opening the attachment.

It is the same file the button hands over: both call one function, because
two definitions of a money record is one too many.

**You cannot trigger it by hand in production.** Netlify answers a direct
HTTP call to a scheduled function with 403 before the function runs — tried,
not assumed. The download button in the back office is the on-demand route.

The function carries two guards anyway, for the local run and in case that
policy ever changes: the admin token (header `x-admin-token`, or `?token=`)
runs it on demand, and without one it allows at most one backup every six
hours.

The data never comes back in the response. The mailbox is the only way to
it. And if the mail cannot be sent, the function says so rather than
reporting a backup that does not exist.

**It sends the ledger by email.** That is the point — a copy that leaves
Netlify — and it is also worth knowing: the money record is in the inbox,
so the inbox deserves the same care as the back office key.

### Putting one back

There is no restore button, on purpose: an accidental restore would overwrite
live balances with old ones. To restore, write each entry in `giftCards` to
the store under `gift/<code without hyphens>`, and each entry in `accounts`
under `account/<sha256 of the lowercased email>` plus an index at
`accountid/<id>`.

Each entry in `stock` goes back under `stock/<sku>`, or can simply be typed
in again on the Stock card — it is two numbers.

Restored accounts have no password and cannot be signed in to; their owners
register again. That is deliberate — a backup that could restore a login is a
second place to steal one from.

A test covers the gift card half of this: it exports a card with a spend
against it, wipes the store, writes the export back, and checks the balance
comes out exactly as it stood.

## What it deliberately does not do

- **No editing a balance.** Issue a card or void one; there is no field to
  type a new number into. A balance that can be typed is a balance nobody can
  audit.
- **No reading a password**, ever, anywhere.
- **No live/test switch.** The page says which kind of data it is looking at,
  derived from the cards themselves, so nobody voids a live card thinking it
  is a test one. Which mode the shop is in is decided by the Stripe keys in
  Netlify, not here.
- **No stock history.** A size has a number, its live holds and what it has
  sold; there is no audit trail of who changed the number to what. A wrong
  figure here costs a message at the till, not money.

## The limit is on the door

Ten sign-in attempts a minute per IP. Once you are through, nothing is
throttled — counting every action instead locked the owner out after three
card lookups, which is useless against guessing and a nuisance to the one
person entitled to be here. The rate limit counts per function instance, like
the others; the real protection is a key nobody can guess.

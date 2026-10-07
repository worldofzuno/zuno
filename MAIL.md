# The mails

Nine of them, listed in
[STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md#the-mails-the-shop-sends).
This is about how they look, who they come from, and why one of them landed
in a junk folder.

## Where the shop's own post goes

`MAIL_TO` — the copy of each order, the weekly backup, every alarm, and
now the contact form. It is **not** the address on the Impressum. It was,
and Resend's log showed the result:

```
info@worldofzuno.com   "New order DI7HGUH1 — CHF 76.80"      bounced
info@worldofzuno.com   "ZUNO backup 2026-10-05 …"            bounced
d.felice@hotmail.ch    "Your ZUNO order DI7HGUH1"            delivered
```

Customers were hearing from the shop; the shop was hearing nothing, the
Monday backup included — the one copy of the gift card ledger that is
supposed to leave Netlify. The domain has no MX record, so there was
nowhere for any of it to land.

**`sent: true` means Resend accepted the message, not that it arrived.**
The bounce happens minutes later. That is why this ran for two days with
every log line reading fine.

`mail-events.mjs` closes it: Resend posts `email.bounced`,
`email.complained` and `email.failed` to it, and each one raises the same
alarm as the rest of the silent failures. Delivery and opens are not
subscribed — a mail that worked is not news, and an open is a tracking
pixel this shop does not use.

The endpoint is public and its job is to raise alarms, so it verifies
Svix's signature before believing anything: `id.timestamp.body`,
HMAC-SHA256 under `RESEND_WEBHOOK_SECRET`, within five minutes. Unsigned,
mis-signed, re-bodied and stale deliveries are all refused, and six tests
fail if that check is removed.

## One frame

`mailLayout` in `netlify/functions/lib/mailer.mjs`. Every mail the shop sends
goes through it, so there is one place to change and no mail that looks
like a different company's.

Mail clients are a museum. Tables for layout, every style on the element
that uses it, no stylesheet and no web font.

The mail is **dark, like the site**. It was light to begin with, on the
theory that a client's own dark mode would wreck a near-black mail. What
actually happened: iOS Mail wrecked the light one. The olive-brown ground
and white-on-black card it produced were nobody's design — they were
Apple's arithmetic on ours, and the `color-scheme: light` metas did not
stop it. A dark mail is left alone, because there is nothing for a dark
mode to do to it, so it reads the same in both.

| | |
| --- | --- |
| Ground | `#000000` |
| Card | `#0d0c0a` — a hair off black, so it is a card and not a hole |
| Ink | `#ede4d3`, the site's `--beige` · dim `#a7a194` |
| Headings and links | `#f8d99b`, the gold |
| Gift-card panel | `#15211d` with a gold border — on black the deep green is a surface, not something to read |
| Hairlines | `#2b2823` |

Contrast on the card, measured: ink 15.5:1, dim 7.6:1, gold 14.3:1. On the
panel: ink 13.1:1, dim 6.5:1, gold 12.2:1. All clear of AA.

Every surface carries the old `bgcolor` attribute as well as the CSS
background. Outlook's Word engine drops the background and keeps the text
colour, and beige on a white rectangle is the one failure this must not
have.

### The wordmark

`site/img/zuno-wordmark-mail.png` — the real one, the same gold lettering
as the site's header, not a bold sans pretending to be it.

Two things about that file. It is **flattened onto black** rather than
transparent, because a transparent PNG is what some clients composite
against white and hand back with a halo round the letters. And it is 420 px
wide for a 140 px slot, which is the 3× a retina screen wants without
carrying the full original into every message.

It is loaded from the shop, not attached. The address comes from
`siteUrl()`, which reads Netlify's own `URL` — so the day the custom domain
was attached, the mails followed it with no deploy of their own. With
images blocked the alt text is styled gold and letterspaced, so a blocked
mail still says ZUNO.

**`/img/*` must stay `Cross-Origin-Resource-Policy: cross-origin`.** The
site sends `same-origin` everywhere else, and that header applies to the
images too unless the rule overrides it. A mail client is not an origin on
worldofzuno.com; Apple Mail renders with WebKit, WebKit enforces the
policy, and the first order confirmation on the real domain arrived with a
broken-image placeholder where the logo should be. The rule lives in
`tools/build-headers.py`, which generates `site/_headers` — edit the
generator, never the output, or CI fails.

To regenerate it after a logo change:

```python
from PIL import Image
src = Image.open('site/img/zuno-wordmark.png').convert('RGBA')
small = src.resize((420, round(src.height * 420 / src.width)), Image.LANCZOS)
flat = Image.new('RGB', small.size, (0, 0, 0))
flat.paste(small, (0, 0), small)
flat.save('site/img/zuno-wordmark-mail.png', optimize=True)
```

## Who it comes from

`MAIL_FROM`, and it is **not `noreply@`**. Two reasons, neither sentimental:
a customer who hits reply on an order confirmation is asking a question, and
a mailbox that swallows it costs a sale; and spam filters — Microsoft's
above all — count `noreply@` on a young domain against it.

A bare address is enough. `MAIL_FROM_NAME` (default `ZUNO`) is put in front
of it, so the reader sees a name rather than a mailbox. The address is the
part that changes; the name is the brand and belongs in one place. A full
`Name <addr>` pair is taken as written.

Every mail carries a `Reply-To`. It defaults to the sending address, which
is right as soon as that address can receive.

**Today it does not.** `worldofzuno.com` has no MX record, so nothing can be
delivered to `info@` at all — a reply would bounce. So two addresses, and
they are deliberately different things:

| | |
| --- | --- |
| `fromAddress()` | what a mail **shows**: the From, the footer, the signature. The brand's address, the one on the Impressum, the one a reader checks against the sender. |
| `replyAddress()` | where a reply **goes**. `MAIL_REPLY_TO` when set. |

The private address it forwards to never appears in a mail — there is a
test for that. What is still broken: anybody who copies `info@` out of the
footer, or off the Impressum, gets a bounce. The fix for that is an MX
record — GoDaddy's forwarding, or a real mailbox — not this. This only
covers the Reply button, which is the path almost everybody takes.

**Whatever stands in `MAIL_FROM` must be an address the brand is willing to
show.** Whether it can receive is a separate question, and the code cannot
check either one.

## Staying out of the junk folder

The first despatch mail landed in Outlook's junk. The parts of that we can
control:

**Authentication.** Resend has `worldofzuno.com` verified: DKIM signs every
message and SPF is in place through the `send` and `rsend` subdomains. Both
are confirmed by Resend, not assumed.

**DMARC is missing**, and on a young domain sending to Microsoft that is the
single biggest remaining item. It is one TXT record at GoDaddy, where the
domain's DNS lives:

```
Name:  _dmarc
Type:  TXT
Value: v=DMARC1; p=none
TTL:   1 hour
```

GoDaddy appends the domain itself, so the name is `_dmarc`, not
`_dmarc.worldofzuno.com` — the same way the `send` and `rsend` CNAMEs were
entered.

**Check first whether a `_dmarc` record already exists.** Two DMARC records on
one domain are worse than none: a receiver that finds two ignores both and
treats the domain as having no policy at all.

`p=none` asks for nothing to be rejected. It only says the domain is watching,
and that is what a filter looks for — the presence of the record carries most
of the benefit, which is why the short value above is the one to publish.
DKIM already signs as `worldofzuno.com` (the key sits at the apex), so DMARC
alignment passes on every mail Resend sends.

Two follow-ups, neither urgent:

- **Reports.** Add `; rua=mailto:worldofzuno@gmail.com` to the value and the
  receiving providers will send a daily XML summary of who sent mail as
  `worldofzuno.com`. Useful once, to confirm nothing but Resend is sending —
  but it is a few machine-readable attachments a day in a personal inbox.
  Do not point `rua` at `info@worldofzuno.com`: the domain has no mailbox
  (Resend shows `Receiving: disabled`) and the reports would bounce.
- **Tightening.** After a few weeks of mail arriving normally, change `p=none`
  to `p=quarantine`. That tells a receiver to treat unauthenticated mail
  claiming to be ZUNO as suspicious, which is the point of the exercise. Only
  do it while every mail still leaves through Resend; if a GoDaddy forwarder
  or another sender is added later, check it authenticates first.

**A sender that is not noreply@.** Done; see above.

**No dead links.** Every link in a mail now points at `siteUrl()`. They used
to be hard-coded to `https://worldofzuno.com`, which does not resolve yet — a
mail full of links to a domain with nothing behind it reads as phishing to a
filter and to a reader.

**Plain text alongside the HTML.** Every mail has both. A mail that is
HTML-only is a mark against it.

**No open tracking and no click tracking.** Off in Resend, deliberately: a
tracking pixel in a transactional mail buys nothing and rewrites every link
through a third-party domain.

What we cannot fix from here: the domain is days old and has no sending
reputation. That comes from sending real mail that people do not mark as
spam. Marking the first few **Not junk** in your own mailbox genuinely
helps, and so does adding the sender to your contacts.

## Following the parcel

The despatch mail turns the tracking number into a link when the carrier is
Swiss Post, which publishes a deep link into Track & Trace taking the
barcode exactly as printed on the label — no account, no API. Any other
carrier gets the number as plain text: a link that guesses where a parcel
is would be worse than one the customer pastes into a search box.

`trackingUrl(carrier, tracking)` in `admin.mjs` is the whole of it, and the
plain-text half of the mail prints the address on its own line, because an
address inside a sentence is one a mail client wraps in the middle.

## When one does not go out

Every failure here already wrote to the function log. The trouble with a log
is that nobody reads it on a Tuesday: an order whose confirmation never went
out looks exactly like one that did, until the customer writes in.

`alarm(kind, detail)` in `mailer.mjs` turns the failures nobody else finds
out about into a mail to `MAIL_TO`:

| Raised when | Why it cannot wait |
| --- | --- |
| an order confirmation is refused | nothing retries it — Stripe will not redeliver a 200, and asking it to would re-run the gift cards and the stock |
| a gift card is not issued, or was claimed and never finished | the customer paid for a card that may not exist |
| an order cannot be filed under its account | the money is safe, but the order will not appear in their history |
| the weekly backup is not sent | the likeliest cause is the attachment outgrowing what the provider takes, and a mail without it still gets through |

Deliberately **not** raised:

- **When no provider is configured at all.** `send` reports `via: 'log'` for
  that, and it is a state the whole shop is in rather than something that
  went wrong with one order. One alarm per order would be no way to learn
  it.
- **The shop's own copy of an order.** The alarm goes to the same inbox, so
  a copy that could not be delivered is an alarm that could not be either.
- **A gift card that could not be settled at checkout.** That one throws, so
  Stripe retries it, and `settle` is idempotent. The retry is the answer;
  an alarm on the first attempt would cry about something that fixes itself.

Each kind is throttled to one mail every 15 minutes, so one provider outage
during a busy hour is one mail rather than forty. The throttle lives in the
blob store under `alarm/<kind>`; if it cannot be read, the alarm goes out
anyway — the alarm is the point, counting it is the convenience.

There is no retry, no queue and no second channel. If the provider itself is
down, this cannot get through either, and it says so in the log rather than
pretending.

## Seeing one before it goes out

No provider configured means nothing is sent: the whole message is written
to the function log and `send` reports `sent: false`. That is a deliberate
state — an order must never be lost because the mail service was not set up
— and anything that must not pretend, the password reset above all, checks
the flag.

To look at the HTML rather than the text, render it with the builders
directly:

```bash
SITE_URL=https://worldofzuno.netlify.app node --input-type=module -e '
  import fs from "node:fs";
  const wh = await import("./netlify/functions/stripe-webhook.mjs");
  fs.writeFileSync("/tmp/order.html", wh.orderMailHtml({ /* an order */ }));
'
```

`tests/functions/mailer.test.mjs` covers the frame, the sender composition
and the adapters; `stripe-webhook.test.mjs` and `admin.test.mjs` cover what
each mail says.

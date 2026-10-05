# The mails

Eight of them, listed in
[STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md#the-mails-the-shop-sends).
This is about how they look, who they come from, and why one of them landed
in a junk folder.

## One frame

`mailLayout` in `netlify/functions/mailer.mjs`. Every mail the shop sends
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

Every mail carries a `Reply-To`, defaulting to the sending address, so there
is one mailbox to watch rather than two. `MAIL_REPLY_TO` overrides it.

**Whatever stands in `MAIL_FROM` must be a mailbox somebody reads.** Nothing
in the code can check that.

## Staying out of the junk folder

The first despatch mail landed in Outlook's junk. The parts of that we can
control:

**Authentication.** Resend has `worldofzuno.com` verified: DKIM signs every
message and SPF is in place through the `send` and `rsend` subdomains. Both
are confirmed by Resend, not assumed.

**DMARC is missing**, and on a young domain sending to Microsoft that is the
single biggest remaining item. It is one TXT record at whoever hosts the
domain's DNS:

```
Name:  _dmarc.worldofzuno.com
Type:  TXT
Value: v=DMARC1; p=none; rua=mailto:[PLACEHOLDER: an address to send DMARC reports to]
```

`p=none` asks for nothing to be rejected — it only says the domain is
watching, which is what a filter wants to see. Tighten it to `p=quarantine`
later, once the reports show only your own mail going out.

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

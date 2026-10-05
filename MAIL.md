# The mails

Eight of them, listed in
[STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md#the-mails-the-shop-sends).
This is about how they look, who they come from, and why one of them landed
in a junk folder.

## One frame

`mailLayout` in `netlify/functions/mailer.mjs`. Every mail the shop sends
goes through it, so there is one place to change and no mail that looks
like a different company's.

Mail clients are a museum: tables for layout, every style on the element
that uses it, no stylesheet, no web font. What that leaves is the palette
and the wordmark, and both are the site's own:

| | |
| --- | --- |
| Paper | `#ede4d3` — the site's `--beige`, the same value, not an approximation |
| Card | `#ffffff` on the paper |
| Band | `#000000`, with the gold wordmark |
| Ink | `#16150e` · dim `#55513f` |
| Headings | `#1e3932`, the deep green, uppercase and letterspaced |
| Gold | `#f8d99b` |

Measured on the white card: ink 17.9:1, dim 8.0:1, green headings 12.5:1.
Gold on the black band is 14.5:1. All clear of AA.

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
is attached, the mails follow it with no deploy of their own. With images
blocked the alt text is styled gold and letterspaced, so a blocked mail
still says ZUNO.

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

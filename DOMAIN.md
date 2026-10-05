# Putting the shop on worldofzuno.com

Today it is served from `worldofzuno.netlify.app`. Everything works there,
but the sitemap, the Open Graph image and the structured data all name the
real domain, and so does every piece of paper the brand will ever carry.

## Do not move the nameservers

Netlify offers to host DNS for the domain. **Decline it.** The zone already
carries records that have nothing to do with hosting and everything to do
with mail:

- `resend._domainkey` TXT — the DKIM key that signs every mail the shop sends
- `send` and `rsend` CNAME — Resend's SPF path
- whatever MX records deliver `info@worldofzuno.com`

Moving the nameservers means recreating all of those by hand in Netlify, and
anything missed stops mail dead — silently, because a mail that fails
authentication is not bounced, it is filed as junk. Two records at the
current provider is the smaller and safer change.

## The two records

At whoever hosts the DNS for `worldofzuno.com`:

| Host | Type | Value |
| --- | --- | --- |
| `www` | CNAME | `worldofzuno.netlify.app` |
| `@` (the bare domain) | A | `75.2.60.5` |

If the provider offers **ALIAS**, **ANAME** or a **flattened CNAME**, use that
for the bare domain instead of the A record and point it at
`apex-loadbalancer.netlify.com`. It survives Netlify changing its load
balancer; a pinned IP does not.

Netlify recommends making **`www.worldofzuno.com` the primary** and letting
the bare domain redirect to it, because an apex served through third-party
DNS cannot be given the same routing. Either works; `www` is the faster one.

Then in Netlify: **Project configuration → Domain management → Add a domain**,
enter the domain, and let it verify. The certificate is issued automatically
once the records resolve — usually minutes, occasionally a day.

## Afterwards

Three things follow, and two of them happen by themselves.

1. **The mails.** Nothing to do. Links and the logo come from `siteUrl()`,
   which reads Netlify's own `URL`, so they follow the primary domain the
   moment it changes. See [MAIL.md](MAIL.md).

2. **The Stripe webhook.** This one is by hand: Dashboard → Developers →
   Webhooks → the endpoint → change the URL to
   `https://worldofzuno.com/.netlify/functions/stripe-webhook` (or the `www`
   form, matching whichever is primary). The signing secret does not change.
   Until it is changed the old address keeps working, so there is no rush and
   no gap.

3. **A paid order while the domain is half-attached** is not lost. Stripe
   retries a failed delivery for about three days, and the webhook is
   idempotent — a redelivery files the order, mints no second gift card and
   sends no second mail.

## Checking it

```bash
curl -sI https://worldofzuno.com/ | head -1
curl -s  https://worldofzuno.com/.netlify/functions/stock-levels
curl -so /dev/null -w '%{http_code}\n' -X POST \
     -H 'content-type: application/json' -d '{}' \
     https://worldofzuno.com/.netlify/functions/stripe-webhook   # 400 = it ran
```

A `200`, a JSON object of stock levels, and a `400` from the webhook mean the
shop is answering on the real domain. Then place one test order and confirm
in Stripe that the delivery came back `200`.

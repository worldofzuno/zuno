# SEO — what is in place, and what it cannot do

## Already there, and left alone

These were correct before this pass and were not touched:

- `<title>`, `<meta name="description">`, `<link rel="canonical">`
- Open Graph and Twitter card tags, with `og-image.jpg` (1200×630) — still
  on-brand and matching the current site, so it was kept
- `robots.txt`, pointing at the sitemap
- Favicon, apple-touch-icon, `site.webmanifest`
- `lang="en"`, exactly one `<h1>`, an `alt` on every image

## Added

### Structured data (JSON-LD)

One `@graph` in the head: `Organization`, `WebSite`, `Product` with an
`Offer` per size, plus shared `OfferShippingDetails` and
`MerchantReturnPolicy` nodes. This is what lets Google show the price, the
currency and availability in a result rather than a plain blue link.

**Every figure in it is taken from a page of this site**, and a check
(`seocheck.mjs` in the working notes) holds each one against the rendered
page: the two prices against the configurator buttons, CHF 7 and the
fourteen days against Shipping & Returns, the address and the email against
the Legal Notice. All eight matched. If you change a price, change it there
too — or the rich result will advertise something the shop does not sell.

Two things were deliberately left out rather than guessed:

- **`priceValidUntil`.** Google prefers it. Setting a date would be inventing
  a commitment, and a date in the past suppresses the rich result, so it is
  omitted. Expect an advisory, not an error, in the Rich Results Test.
- **The nuance of the return policy.** Structured data can say "14 days"; it
  cannot say "unopened only, opened coffee excluded, customer pays return
  postage unless the item was faulty". `merchantReturnLink` points at the
  full policy, which does say all of it.

Free shipping over CHF 45 is on the page but not in the structured data —
encoding a threshold correctly is fiddly and encoding it wrongly is worse
than leaving it out.

### Per-page titles

Opening `#gift`, `#legal`, `#cart` and the rest now sets `document.title`.
A tab, a bookmark and the back button say which page you are on instead of
all reading "Swiss Specialty Coffee". The canonical URL deliberately does
**not** change — see the limit below.

### Sitemap

`lastmod` refreshed. Still one URL, on purpose.

## The limit worth knowing about

**The sub-pages cannot rank on their own.** `#gift`, `#legal`, `#privacy`
and `#shipping` are fragments of one document, not separate URLs. A crawler
sees one page. That is fine for the legal pages, which nobody searches for,
and it does cost something for the Gift Card page, which people might.

Fixing it properly means real paths (`/gift`) that serve their own HTML with
their own title, description and canonical. The Netlify redirect already
sends `/gift` to `index.html`, so the plumbing is half there — what is
missing is per-page content at build time. That is a build step this site
does not have, and adding one is a bigger change than it sounds: the whole
point of `site/` today is that it is a finished artefact with no build.

Worth doing if the Gift Card page should be findable on its own. Not worth
doing for the legal pages.

## What you still have to do

- **Google Search Console**: add `worldofzuno.com`, verify it, submit
  `https://worldofzuno.com/sitemap.xml`. Nothing I can do from here.
- **Rich Results Test** (`search.google.com/test/rich-results`) once the site
  is live, to see the Product card the structured data produces.
- Confirm the Instagram URL. `instagram.com/worldofzuno/` was derived from
  the handle and has never been checked; it is in the structured data as the
  brand's `sameAs`, so a wrong one is a wrong claim about who you are.

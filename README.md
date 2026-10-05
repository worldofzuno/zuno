# ZUNO

A Swiss coffee and lifestyle brand, and the shop that sells it.

`site/` is the shop: one hand-written HTML page, its stylesheet inline, no
build step. It is what Netlify publishes. `netlify/functions/` is everything
that cannot happen in a browser — the checkout, the gift card ledger, the
accounts, the back office, the mail.

The repository root also holds a Next.js app from an earlier shape of the
project. It is not what gets deployed; `netlify.toml` points at `site/` and
runs no build.

## Running it

```bash
npm install
node tests/browser/serve.mjs 8820     # the shop on http://127.0.0.1:8820
```

That harness serves `site/` and routes `/.netlify/functions/*` to the real
functions, with state in memory and no outside service attached. Anything
that needs Stripe or a mail provider reports that it is not configured
rather than pretending.

## Checking it

```bash
npm run test:functions      # node --test, the functions
npm run test:browser        # playwright, the shop in a browser
python3 tools/build-headers.py   # regenerate the CSP hashes in site/_headers
```

Both suites and the header check run on every push and pull request
(`.github/workflows/checks.yml`). The browser run needs a Chromium; set
`PW_CHROMIUM` to one that is already on the machine, or let
`npx playwright install chromium` fetch it.

`site/_headers` pins the inline script and style by SHA-256. Edit either and
regenerate, or the browser refuses to run them — the live page loads as
unstyled text with a dead cart while every local check still passes.

## The documentation

| | |
| --- | --- |
| [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md) | the checkout, every environment variable, and what going live needs |
| [BACKOFFICE.md](BACKOFFICE.md) | `/admin/` — orders, gift cards, accounts, stock, the backup |
| [ACCOUNTS.md](ACCOUNTS.md) | sign-in, sessions, password reset, deletion |
| [STOCK.md](STOCK.md) | how a size runs out without two people buying the last bag |
| [MAIL.md](MAIL.md) | the eight mails: the frame, the sender, the junk folder |
| [DOMAIN.md](DOMAIN.md) | putting the shop on worldofzuno.com |
| [SEO.md](SEO.md) | what search engines are told |

## Secrets

None are in the repository, and none may be. `.env.example` documents every
variable; the real values live in Netlify's environment and are read by the
functions at cold start — so a change to one needs a redeploy before it
takes effect.

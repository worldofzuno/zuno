/**
 * The way a customer actually goes through the shop.
 *
 * Everything here is asserted on what is on the screen, not on what a
 * module returns: the arithmetic can be right in `create-checkout-session`
 * and wrong in the cart, a panel can be `hidden` in the markup and visible
 * in the browser, and a button can refuse to enable. None of that is
 * reachable from node --test.
 *
 * The hand-over to Stripe is intercepted rather than made, because there is
 * no Stripe key here — and intercepting it is also the only way to read the
 * one thing that matters at that moment, which is what the cart sent.
 */

import { expect, test } from './fixtures.mjs';

const unique = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.ch`;

/**
 * Answers for the voucher field.
 *
 * `validate-code` asks Stripe what the reduced prices are, and there is no
 * Stripe key here. What this test is for is the half the server cannot
 * check: that the cart redraws from the answer rather than working the
 * discount out for itself. So the answer is given, in the shape the real
 * function returns, and the page has to do the rest.
 */
async function answerVoucher(page) {
  await page.route('**/.netlify/functions/validate-code', async (route) => {
    const code = String(JSON.parse(route.request().postData() || '{}').code || '')
      .trim().toUpperCase();
    const body = code === 'FAMILY26'
      ? { valid: true, kind: 'fnf', currency: 'chf',
          prices: { 'castano-200g': 1100, 'castano-500g': 2000 } }
      : { valid: false, kind: null, reason: 'unknown',
          message: 'We do not recognise that code.' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Everything the cart posts when Proceed to Checkout is pressed. */
async function captureCheckout(page) {
  const seen = [];
  await page.route('**/.netlify/functions/create-checkout-session', async (route) => {
    seen.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: '/?checkout=stub#cart' }),
    });
  });
  return seen;
}

/** A page that failed quietly is a page that failed. */
function watchConsole(page) {
  const bad = [];
  page.on('console', (m) => { if (m.type() === 'error') bad.push(m.text()); });
  page.on('pageerror', (e) => bad.push(String(e)));
  return bad;
}

test.describe('the shop', () => {
  test('opens, and says who it is', async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto('/');

    await expect(page.locator('.nav__mark img')).toBeVisible();
    await expect(page.locator('#badge')).toHaveText('0');
    await expect(page.getByRole('button', { name: /Add to Cart/ })).toBeEnabled();
    expect(bad, 'nothing in the console').toEqual([]);
  });

  test('a bag goes in the cart and the sums are the ones on the page', async ({ page }) => {
    await page.goto('/');

    /* 200 g is selected to begin with; the shelf price is CHF 14.90 and
       that is under the CHF 45 that makes postage free. */
    await page.locator('#addBtn').click();
    await expect(page.locator('#badge')).toHaveText('1');

    await page.locator('#cartBtn').click();
    const summary = page.locator('#summary');
    await expect(summary).toContainText('CHF 14.90');
    await expect(summary).toContainText('CHF 7.00');
    await expect(summary.locator('.row.total')).toContainText('CHF 21.90');

    /* Four bags clears the threshold, and the postage line has to say so
       rather than quietly staying at seven francs. */
    const more = page.locator('#lines button[data-inc]');
    await more.click();
    await more.click();
    await more.click();
    await expect(page.locator('#badge')).toHaveText('4');
    await expect(summary).toContainText('Free');
    await expect(summary.locator('.row.total')).toContainText('CHF 59.60');
  });

  test('the voucher code is answered by the server, not by the page', async ({ page }) => {
    await answerVoucher(page);
    await page.goto('/');
    await page.locator('#addBtn').click();
    await page.locator('#cartBtn').click();

    await page.locator('#codeInput').fill('NOT-A-CODE');
    await page.locator('#codeBtn').click();
    await expect(page.locator('#codeMsg')).toBeVisible();
    await expect(page.locator('#summary')).toContainText('CHF 14.90');

    /* The real one. The reduced prices exist only on the server, so a
       cart that showed the lower figure before the answer came back would
       be showing a price nobody agreed to. */
    await page.locator('#codeInput').fill('family26');
    await page.locator('#codeBtn').click();
    await expect(page.locator('#summary')).toContainText('CHF 11.00');
    /* The shelf price stays on the subtotal line, so the reduction is
       something you can see rather than a number that silently changed. */
    await expect(page.locator('#summary')).toContainText('CHF 14.90');
  });

  test('one way in at a time: sign in, create, forgotten', async ({ page }) => {
    await page.goto('/#account');

    await expect(page.locator('#authView .auth-card:visible')).toHaveCount(2);
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#registerForm')).toBeVisible();
    await expect(page.locator('#forgotForm')).toBeHidden();
    await expect(page.locator('#resetForm')).toBeHidden();

    /* Asking for a link replaces the pair rather than joining them. This
       is the one that was wrong on the live site for a day: .auth-card
       sets display:flex, which outweighs the browser's own rule for
       [hidden], so all three stood there at once. */
    await page.locator('#forgotBtn').click();
    await expect(page.locator('#forgotForm')).toBeVisible();
    await expect(page.locator('#authView .auth-card:visible')).toHaveCount(1);

    /* Into the middle of the window first. Playwright scrolls a target to
       the top edge, where the fixed header sits over it and swallows the
       click; a person scrolls until they can see the thing. Measured: the
       page's own anchors all land clear of the 79px header, so this is the
       test's artefact and not the shop's. */
    await page.locator('#forgotBack').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.locator('#forgotBack').click();
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#forgotForm')).toBeHidden();
  });

  test('an account can be made, left and come back to', async ({ page }) => {
    const email = unique();
    await page.goto('/#account');

    await page.locator('#f-name-17').fill('Test Kundin');
    await page.locator('#f-email-18').fill(email);
    await page.locator('#f-password-19').fill('a few words to remember');
    await page.locator('#registerForm button[type=submit]').click();

    await expect(page.locator('#dashView')).toBeVisible();
    await expect(page.locator('#memberMail')).toHaveText(email);
    await expect(page.locator('#authView')).toBeHidden();

    await page.locator('#logoutBtn').click();
    await expect(page.locator('#loginForm')).toBeVisible();

    await page.locator('#f-email-15').fill(email.toUpperCase());  // addresses are not case-sensitive
    await page.locator('#f-password-16').fill('a few words to remember');
    await page.locator('#loginForm button[type=submit]').click();

    /* The panel coming back is the proof, not the address in it: signing
       out hides the panel but leaves the text where it was, so an
       assertion on the address alone passes on the leftover. It did —
       a sign-in refused outright read as a success here, and only the
       reload two lines down gave it away. */
    await expect(page.locator('#dashView')).toBeVisible();
    await expect(page.locator('#loginMsg')).toBeHidden();
    await expect(page.locator('#memberMail')).toHaveText(email);

    /* Still signed in after a reload: the session is a cookie, not a
       variable in the page.
       Fifteen seconds rather than the usual five. A reload asks the server
       who this is before it can show anything, and on the telephone
       project the page is being drawn in software — traced end to end, the
       answer comes back fine, it is the painting that is slow. A real
       telephone has a GPU. */
    await page.reload();
    await expect(page.locator('#dashView')).toBeVisible({ timeout: 15_000 });
  });

  test('a wrong password says so, and says nothing else', async ({ page }) => {
    await page.goto('/#account');
    await page.locator('#f-email-15').fill('nobody@example.invalid');
    await page.locator('#f-password-16').fill('not the password');
    await page.locator('#loginForm button[type=submit]').click();

    const msg = page.locator('#loginMsg');
    await expect(msg).toBeVisible();
    /* It must not say whether the address exists. */
    await expect(msg).not.toContainText(/no account|unknown address|not registered/i);
    await expect(page.locator('#dashView')).toBeHidden();
  });

  test('forgetting a password gives the same answer either way', async ({ page }) => {
    await page.goto('/#account');
    await page.locator('#forgotBtn').click();
    await page.locator('#f-forgot').fill('nobody@example.invalid');
    await page.locator('#forgotForm button[type=submit]').click();
    await expect(page.locator('#forgotMsg')).toContainText(/if that address has an account/i);
  });

  test('what the cart hands to Stripe is codes and quantities, never a price', async ({ page }) => {
    await answerVoucher(page);
    const sent = await captureCheckout(page);
    await page.goto('/');

    await page.locator('#grindRow button', { hasText: 'Pre-Ground' }).click();
    await page.locator('#sizeRow button', { hasText: '500g' }).click();
    await page.locator('#addBtn').click();
    await page.locator('#cartBtn').click();
    await page.locator('#codeInput').fill('FAMILY26');
    await page.locator('#codeBtn').click();
    await expect(page.locator('#summary')).toContainText('CHF 20.00');

    await page.locator('#checkoutBtn').click();
    await expect.poll(() => sent.length).toBe(1);

    expect(sent[0]).toEqual({
      items: [{ sku: 'castano-500g', qty: 1, grind: 'Pre-Ground' }],
      code: 'FAMILY26',
    });
    /* The one thing that must never be in there. */
    expect(JSON.stringify(sent[0])).not.toMatch(/amount|price|total|20\.00/i);
  });

  test('a gift card is not a parcel', async ({ page }) => {
    await page.goto('/#gift');
    await page.locator('#giftAdd').click();
    await page.locator('#cartBtn').click();

    /* Nothing to put in a parcel: the summary offers no postage at all,
       and the total is the face value. */
    const summary = page.locator('#summary');
    await expect(summary).toContainText('By email');
    await expect(summary).not.toContainText('Shipping');
    await expect(summary.locator('.row.total')).toContainText('CHF 25.00');
  });
});

test.describe('when a size is sold out', () => {
  const ADMIN = 'browser-test-token-long-enough-to-pass';

  /**
   * The back office is the only way stock is set, so the test uses it.
   *
   * The session cookie is handed back rather than left to the cookie jar.
   * It is `Secure; SameSite=Strict`, and an API request context over plain
   * http does not keep it — every call after the sign-in came back
   * "Please sign in first". Reading it off the response and sending it is
   * what a browser would do anyway, and it says so in one line.
   */
  async function setStock(page, sku, qty) {
    const login = await page.request.post('/.netlify/functions/admin', {
      data: { action: 'login', token: ADMIN },
    });
    expect(login.ok(), 'signed in to the back office').toBeTruthy();
    const cookie = String(login.headers()['set-cookie'] || '').split(';')[0];
    expect(cookie, 'the sign-in handed back a session').toBeTruthy();

    const r = await page.request.post('/.netlify/functions/admin', {
      headers: { cookie },
      data: { action: 'stock-set', sku, qty },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }

  test('the page says so and the button refuses', async ({ page }) => {
    await setStock(page, 'castano-200g', 0);
    await page.goto('/');

    await expect(page.locator('#stockNote')).toBeVisible();
    await expect(page.locator('#stockNote')).toContainText(/sold out/i);
    await expect(page.locator('#addBtn')).toBeDisabled();

    /* The other size is untouched, so the shop still sells something. */
    await page.locator('#sizeRow button', { hasText: '500g' }).click();
    await expect(page.locator('#addBtn')).toBeEnabled();

    await setStock(page, 'castano-200g', null);
  });
});

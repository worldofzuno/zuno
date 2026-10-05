/**
 * The parts of the shop that only exist on a telephone.
 *
 * shop.spec.mjs runs in both projects and covers what the two have in
 * common. This file is the rest: a menu that is a button instead of a row
 * of links, a layout narrow enough that anything a few pixels too wide
 * shows as a sideways scroll, and the thumb-sized targets that a desktop
 * window never exercises.
 *
 * Skipped outside the phone project rather than duplicated, so there is
 * one definition of "on a telephone" and it is Playwright's.
 */

import { expect, test } from './fixtures.mjs';

test.describe('on a telephone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the phone project only');

  test('the menu is behind the burger, and comes back out', async ({ page }) => {
    await page.goto('/');

    const burger = page.locator('#burger');
    const menu = page.locator('#menu');
    await expect(burger).toBeVisible();
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#menu a', { hasText: 'Gift Card' })).toBeHidden();

    await burger.tap();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('a', { hasText: 'Gift Card' })).toBeVisible();

    /* Following a link has to put the menu away. One that stays open
       covers the page it just took you to. */
    await menu.locator('a', { hasText: 'Gift Card' }).tap();
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#giftAdd')).toBeVisible();
  });

  test('the cart is reachable without opening the menu', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#cartBtn')).toBeVisible();

    await page.locator('#addBtn').tap();
    await expect(page.locator('#badge')).toHaveText('1');
    await page.locator('#cartBtn').tap();
    await expect(page.locator('#checkoutBtn')).toBeVisible();
  });

  /* A page that scrolls sideways on a telephone is a page where the right
     edge of every line is a guess. The instruction has always been a 16px
     gutter and no horizontal scroll; this is the first thing that checks
     it. */
  for (const [where, open] of [
    ['the shop', async () => {}],
    ['the cart', async (page) => { await page.locator('#addBtn').tap(); await page.locator('#cartBtn').tap(); }],
    ['the account page', async (page) => { await page.goto('/#account'); }],
    ['the legal page', async (page) => { await page.goto('/#legal'); }],
  ]) {
    test(`${where} does not scroll sideways`, async ({ page }) => {
      await page.goto('/');
      await open(page);
      const over = await page.evaluate(() => {
        const d = document.documentElement;
        return { scroll: d.scrollWidth, client: d.clientWidth };
      });
      expect(over.scroll, `${over.scroll}px of content in a ${over.client}px window`)
        .toBeLessThanOrEqual(over.client);
    });
  }

  test('nothing you have to press is smaller than a thumb', async ({ page }) => {
    await page.goto('/');
    /* 44px is the figure Apple and the WCAG target-size rule both land on.
       Checked on the controls a customer cannot avoid. */
    for (const sel of ['#burger', '#cartBtn', '#accountBtn', '#addBtn']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, `${sel} has no box`).not.toBeNull();
      expect(Math.min(box.width, box.height), `${sel} is ${box.width}×${box.height}`)
        .toBeGreaterThanOrEqual(44);
    }
  });
});

/**
 * One client address per walkthrough.
 *
 * Signing in is limited to ten attempts a minute per address, and every
 * request in this run leaves the same machine — so the suite throttled
 * itself: a sign-in came back 429 and the page looked for all the world
 * like a session that had not survived a reload. It cost an hour to find,
 * because a rate limit does not announce itself in the browser.
 *
 * Each test now says it comes from its own address, which is the truth of
 * what it represents: a different visitor. The limiter stays under test —
 * `validate-code.test.mjs` and `account.test.mjs` exercise it directly —
 * rather than being turned down in the shop to make a test pass, which is
 * the one thing not to do here.
 *
 * Addresses come from 203.0.113.0/24, the range reserved for
 * documentation, so nothing here can ever be mistaken for somebody's.
 */

import { test as base } from '@playwright/test';

/* Per worker, and Playwright gives each project its own — so the count
   restarts and the two projects would hand out the same addresses minutes
   apart, inside the same one-minute window. The project decides the half
   of the range, the counter the rest. */
let nth = 0;

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    nth += 1;
    const half = testInfo.project.name === 'phone' ? 110 : 10;
    await context.setExtraHTTPHeaders({
      'x-forwarded-for': `203.0.113.${half + (nth % 90)}`,
    });
    await use(context);
  },
});

export { expect } from '@playwright/test';

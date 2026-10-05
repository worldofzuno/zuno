import { defineConfig, devices } from '@playwright/test';

/**
 * The browser walkthrough. `npm run test:browser`.
 *
 * It drives the real page against the real functions, served by
 * tests/browser/serve.mjs. The point is the half of the shop that
 * node --test cannot see: a button that does not enable, a panel that
 * stays visible when it should not, a cart whose arithmetic is right in
 * the module and wrong on the screen. Three auth cards were on screen at
 * once for a whole day and 335 green tests had nothing to say about it.
 *
 * PW_CHROMIUM points at a Chromium that is already on the machine. On CI
 * it is unset and `npx playwright install chromium` provides one.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,          // one shop, one in-memory store
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8820',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
    },
  }],
  webServer: {
    command: 'node tests/browser/serve.mjs 8820',
    url: 'http://127.0.0.1:8820/.netlify/functions/stock-levels',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      /* Enough to make the shop behave, and nothing that could reach a real
         service: no Stripe key, no mail provider, no blob store. */
      /* So the links the shop writes into a mail point at the shop that
         wrote them, as they do on a deploy preview. */
      SITE_URL: 'http://127.0.0.1:8820',
      ADMIN_TOKEN: 'browser-test-token-long-enough-to-pass',
      FNF_CODES: '[{"code":"FAMILY26"}]',
      STRIPE_PRICE_FNF_CASTANO_200G: 'price_fnf_200_test',
      STRIPE_PRICE_FNF_CASTANO_500G: 'price_fnf_500_test',
    },
  },
});

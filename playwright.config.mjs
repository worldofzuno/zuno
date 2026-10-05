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
  /* The same walkthroughs twice. Most people buy coffee on a telephone,
     and a desktop window says nothing about a burger menu that will not
     close or a drawer that covers the button under it. Pixel 5 rather than
     an iPhone because its default engine is Chromium, which is the one
     browser on this machine; what is being tested is the layout and the
     touch handling, not WebKit. */
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
      },
    },
    {
      name: 'phone',
      use: {
        ...devices['Pixel 5'],
        /* Pixel 5 asks for 2.75 device pixels per CSS pixel. There is no
           GPU here, so the cell field behind the page is drawn in
           software, and at that density the page stops answering clicks
           inside ten seconds — measured: 2.75x times out, 1x loads in
           5.8s, and with reduced motion 0.26s. A real telephone has a GPU
           and does not have this problem. Density changes nothing about
           the layout, which is what these walkthroughs are for, so it is
           turned down rather than the animation turned off: the page under
           test stays the page. */
        deviceScaleFactor: 1,
        /* And the motion the page itself offers to turn off. Under a
           software renderer the hero entrance never settles: Playwright
           waits for an element to hold still for two frames, each frame
           takes hundreds of milliseconds, and every tap times out. With
           reduced motion the same walkthrough runs in 0.26s instead of
           5.8s. It is a setting real people have on, the page already
           honours it, and the layout — which is what this project is for
           — is identical either way. The desktop project keeps the
           animations, so both paths are walked. */
        reducedMotion: 'reduce',
        launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
      },
    },
  ],
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

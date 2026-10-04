/**
 * Checks on the Family & Friends code module, run with:
 *
 *     node --test tests/functions/fnf.test.mjs
 *
 * Two things matter here. A code that was not configured must never match —
 * a malformed variable has to close the door, not open it. And an expired or
 * exhausted code has to be refused, because the whole point of a dated code
 * is that it stops working.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const {
  parseCodes, normalise, sameCode, matchCode, allow, resetLimiter, exhausted,
  fnfConfigured, FNF_CATALOGUE,
} = await import('../../netlify/functions/fnf.mjs');

const quiet = (fn) => {
  const real = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = real; }
};

/* ------------------------------------------------------------- parsing */

test('a well-formed variable yields the codes', () => {
  const got = parseCodes('[{"code":"FAMILY26","expires":"2026-12-31","maxRedemptions":100}]');
  assert.deepEqual(got, [{ code: 'FAMILY26', expires: '2026-12-31', maxRedemptions: 100 }]);
});

test('expiry and limit are optional', () => {
  assert.deepEqual(parseCodes('[{"code":"ROESTI"}]'),
    [{ code: 'ROESTI', expires: null, maxRedemptions: null }]);
});

test('a malformed variable yields no codes, never every code', () => {
  for (const raw of ['', undefined, null, 'FAMILY26', '{}', '[', 'null', '[1,2]', '["FAMILY26"]']) {
    assert.deepEqual(quiet(() => parseCodes(raw)), [], `${JSON.stringify(raw)} must yield nothing`);
  }
});

test('a code outside the allowed shape is dropped', () => {
  // the redemption count interpolates the code into a Stripe search query, so
  // a quote must never survive parsing
  for (const code of ["FAM'ILY", 'FAM ILY#', 'AB', 'x'.repeat(65), '', 42, null]) {
    assert.deepEqual(quiet(() => parseCodes(JSON.stringify([{ code }]))), [],
      `${JSON.stringify(code)} must be dropped`);
  }
});

test('a usable code survives beside an unusable one', () => {
  const got = quiet(() => parseCodes('[{"code":"BAD QUOTE\'"},{"code":"GOOD-1"}]'));
  assert.deepEqual(got.map((c) => c.code), ['GOOD-1']);
});

test('a nonsense expiry or limit is ignored rather than trusted', () => {
  const [c] = parseCodes('[{"code":"FAMILY26","expires":"soon","maxRedemptions":-4}]');
  assert.equal(c.expires, null);
  assert.equal(c.maxRedemptions, null);
  for (const bad of ['"ten"', '1.5', 'true', '0', 'null']) {
    const [e] = parseCodes(`[{"code":"FAMILY26","maxRedemptions":${bad}}]`);
    assert.equal(e.maxRedemptions, null, `${bad} must not become a limit`);
  }
  /* A quoted whole number is coerced, for the same reason a quantity of "2"
     is: the integer and range checks come after, so there is nothing to
     exploit and a config typo should not silently remove the limit. */
  const [d] = parseCodes('[{"code":"FAMILY26","maxRedemptions":"10"}]');
  assert.equal(d.maxRedemptions, 10);
});

/* ------------------------------------------------------------ comparing */

test('what the customer types is normalised, not taken literally', () => {
  assert.equal(normalise(' family 26 '), 'FAMILY26');
  assert.equal(normalise(null), '');
  assert.equal(normalise(undefined), '');
});

test('codes compare equal regardless of case and spacing', () => {
  assert.ok(sameCode('family26', 'FAMILY26'));
  assert.ok(sameCode(' FAM ILY26 ', 'FAMILY26'));
  assert.ok(!sameCode('FAMILY27', 'FAMILY26'));
  // the digests are a fixed width, so no length is leaked either
  assert.ok(!sameCode('F', 'FAMILY26'));
});

/* ------------------------------------------------------------- matching */

const LIST = parseCodes(JSON.stringify([
  { code: 'FAMILY26', expires: '2026-12-31', maxRedemptions: 100 },
  { code: 'ROESTI' },
]));

test('a configured code matches', () => {
  const m = matchCode('family26', LIST, new Date('2026-06-01T12:00:00Z'));
  assert.equal(m.ok, true);
  assert.equal(m.entry.code, 'FAMILY26');
});

test('an unknown code is refused', () => {
  assert.deepEqual(matchCode('ZUNO15', LIST), { ok: false, reason: 'unknown' });
  assert.deepEqual(matchCode('', LIST), { ok: false, reason: 'empty' });
  assert.deepEqual(matchCode('   ', LIST), { ok: false, reason: 'empty' });
});

test('no code matches when none is configured', () => {
  assert.deepEqual(matchCode('FAMILY26', []), { ok: false, reason: 'unknown' });
});

test('a code is good to the end of its last day and refused after', () => {
  assert.equal(matchCode('FAMILY26', LIST, new Date('2026-12-31T22:00:00Z')).ok, true);
  const after = matchCode('FAMILY26', LIST, new Date('2027-01-01T00:00:01Z'));
  assert.deepEqual(after, { ok: false, reason: 'expired' });
});

test('an undated code does not expire', () => {
  assert.equal(matchCode('ROESTI', LIST, new Date('2099-01-01T00:00:00Z')).ok, true);
});

test('a code that is shaped wrong cannot match', () => {
  assert.deepEqual(matchCode("FAM'ILY26", LIST), { ok: false, reason: 'unknown' });
  assert.deepEqual(matchCode('x'.repeat(200), LIST), { ok: false, reason: 'unknown' });
});

/* --------------------------------------------------------- rate limiting */

test('a client gets ten attempts a minute and then waits', () => {
  resetLimiter();
  const now = 1_000_000;
  for (let i = 0; i < 10; i++) assert.equal(allow('1.2.3.4', now + i), true, `attempt ${i + 1}`);
  assert.equal(allow('1.2.3.4', now + 11), false);
  // a different caller is unaffected
  assert.equal(allow('5.6.7.8', now + 12), true);
  // and the window moves
  assert.equal(allow('1.2.3.4', now + 60_001), true);
});

/* ------------------------------------------------------------ exhaustion

   A stub in place of Stripe, recording the query, so the branch that decides
   a code is used up is reachable without the network. */

function stub(pages) {
  const queries = [];
  let i = 0;
  return {
    queries,
    paymentIntents: {
      search: async (opts) => {
        queries.push(opts.query);
        return pages[i++] || { data: [], next_page: null };
      },
    },
  };
}

const rows = (n) => ({ data: Array(n).fill({ id: 'pi' }), next_page: null });

test('a code with no limit is never exhausted and Stripe is not asked', async () => {
  const s = stub([rows(999)]);
  assert.equal(await exhausted(s, { code: 'ROESTI', maxRedemptions: null }), false);
  assert.equal(s.queries.length, 0);
});

test('a code under its limit is usable', async () => {
  const s = stub([rows(99)]);
  assert.equal(await exhausted(s, { code: 'FAMILY26', maxRedemptions: 100 }), false);
});

test('a code at its limit is refused', async () => {
  const s = stub([rows(100)]);
  assert.equal(await exhausted(s, { code: 'FAMILY26', maxRedemptions: 100 }), true);
});

test('only succeeded payments carrying the code are counted', async () => {
  const s = stub([rows(1)]);
  await exhausted(s, { code: 'FAMILY26', maxRedemptions: 100 });
  assert.equal(s.queries[0], "status:'succeeded' AND metadata['fnf_code']:'FAMILY26'");
});

test('the count follows pages rather than stopping at the first hundred', async () => {
  const s = stub([
    { data: Array(100).fill({ id: 'pi' }), next_page: 'p2' },
    { data: Array(60).fill({ id: 'pi' }), next_page: null },
  ]);
  assert.equal(await exhausted(s, { code: 'FAMILY26', maxRedemptions: 150 }), true);
  assert.equal(s.queries.length, 2);
});

test('a search outage lets the code through rather than turning family away', async () => {
  const broken = { paymentIntents: { search: async () => { throw new Error('down'); } } };
  assert.equal(await quiet(() => exhausted(broken, { code: 'FAMILY26', maxRedemptions: 1 })), false);
});

/* ------------------------------------------------------------- catalogue */

test('the F&F prices come from the environment and are reported missing', () => {
  delete process.env.STRIPE_PRICE_FNF_CASTANO_200G;
  delete process.env.STRIPE_PRICE_FNF_CASTANO_500G;
  assert.equal(fnfConfigured(), false);
  process.env.STRIPE_PRICE_FNF_CASTANO_200G = 'price_fnf_200';
  assert.equal(fnfConfigured(), false, 'one of the two is not enough');
  process.env.STRIPE_PRICE_FNF_CASTANO_500G = 'price_fnf_500';
  assert.equal(fnfConfigured(), true);
  assert.deepEqual(FNF_CATALOGUE(), {
    'castano-200g': 'price_fnf_200',
    'castano-500g': 'price_fnf_500',
  });
});

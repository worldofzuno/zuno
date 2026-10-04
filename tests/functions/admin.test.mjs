/**
 * Checks on the back office, run with:
 *
 *     node --test tests/functions/admin.test.mjs
 *
 * This endpoint can read every balance, delete any account and hand out
 * money. So the tests are mostly about the door: a wrong key opens nothing,
 * a missing key closes the whole thing, a short key is refused rather than
 * quietly accepted, and no reply ever carries a password or the key itself.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const TOKEN = 'a-long-enough-admin-key-0123456789';
process.env.ADMIN_TOKEN = TOKEN;

const { useMemoryStore, store } = await import('../../netlify/functions/store.mjs');
const { resetLimiter } = await import('../../netlify/functions/fnf.mjs');
const gc = await import('../../netlify/functions/giftcard.mjs');
const auth = await import('../../netlify/functions/auth.mjs');
const mod = await import('../../netlify/functions/admin.mjs');
const handler = mod.default;

const post = (body, { cookie, ip = '1.2.3.4' } = {}) =>
  handler(new Request('https://worldofzuno.com/.netlify/functions/admin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nf-client-connection-ip': ip,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }));

const call = async (body, opts) => {
  const res = await post(body, opts);
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie'), res };
};

const asCookie = (c) => c.split(';')[0];

async function signedIn() {
  useMemoryStore();
  resetLimiter();
  process.env.ADMIN_TOKEN = TOKEN;
  const r = await call({ action: 'login', token: TOKEN });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return asCookie(r.cookie);
}

/* ------------------------------------------------------------- the door */

test('anything but POST is refused', async () => {
  const res = await handler(new Request('https://worldofzuno.com/x', { method: 'GET' }));
  assert.equal(res.status, 405);
});

test('the right key opens it and sets a strict cookie', async () => {
  useMemoryStore(); resetLimiter();
  const r = await call({ action: 'login', token: TOKEN });
  assert.equal(r.body.admin, true);
  assert.ok(r.cookie.includes('HttpOnly'));
  assert.ok(r.cookie.includes('Secure'));
  assert.ok(r.cookie.includes('SameSite=Strict'),
    'nothing should navigate in from elsewhere already signed in');
});

test('a wrong key opens nothing', async () => {
  useMemoryStore();
  for (const wrong of ['', 'x', TOKEN + 'x', TOKEN.slice(0, -1), TOKEN.toUpperCase(), null, {}, 42]) {
    resetLimiter();
    const r = await call({ action: 'login', token: wrong });
    assert.equal(r.status, 401, JSON.stringify(wrong));
    assert.equal(r.cookie, null);
  }
});

test('with no key configured the whole thing is closed', async () => {
  useMemoryStore(); resetLimiter();
  delete process.env.ADMIN_TOKEN;
  const real = console.error; console.error = () => {};
  try {
    const r = await call({ action: 'login', token: 'anything' });
    assert.equal(r.status, 503);
  } finally {
    console.error = real;
    process.env.ADMIN_TOKEN = TOKEN;
  }
});

test('a key short enough to guess is refused rather than used', async () => {
  useMemoryStore(); resetLimiter();
  process.env.ADMIN_TOKEN = 'short';
  const real = console.error; console.error = () => {};
  try {
    const r = await call({ action: 'login', token: 'short' });
    assert.equal(r.status, 503, 'the right key must not help if the key is weak');
    assert.match(mod.tokenProblem(), /shorter than 24/);
  } finally {
    console.error = real;
    process.env.ADMIN_TOKEN = TOKEN;
  }
  assert.equal(mod.tokenProblem(), null, 'and a long enough one is accepted');
});

test('every action needs the cookie', async () => {
  useMemoryStore();
  const actions = ['summary', 'gift-find', 'gift-list', 'gift-issue', 'gift-void',
    'account-find', 'account-list', 'account-delete', 'account-signout', 'export'];
  for (const action of actions) {
    resetLimiter();
    const r = await call({ action, code: 'ZG-2345-6789-ABCD', email: 'a@b.ch', amount: 100 });
    assert.equal(r.status, 401, action);
  }
});

test('a made-up cookie is not a session', async () => {
  useMemoryStore(); resetLimiter();
  for (const fake of ['zuno_admin=x', 'zuno_admin=' + 'a'.repeat(43), 'zuno_session=abc']) {
    const r = await call({ action: 'summary' }, { cookie: fake });
    assert.equal(r.status, 401, fake);
  }
});

test('signing out makes the cookie worthless', async () => {
  const cookie = await signedIn();
  resetLimiter();
  assert.equal((await call({ action: 'summary' }, { cookie })).status, 200);
  resetLimiter();
  const out = await call({ action: 'logout' }, { cookie });
  assert.ok(out.cookie.includes('Max-Age=0'));
  resetLimiter();
  assert.equal((await call({ action: 'summary' }, { cookie })).status, 401);
});

test('the back office is never indexed', async () => {
  useMemoryStore(); resetLimiter();
  const r = await post({ action: 'me' });
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

/* ---------------------------------------------------------- gift cards */

test('a card can be looked up, and says what is left', async () => {
  const cookie = await signedIn();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1', buyer: 'kundin@example.ch' });
  await gc.hold(card.code, 'cs_x', 2000);
  await gc.settle(card.code, 'cs_x');

  resetLimiter();
  const r = await call({ action: 'gift-find', code: card.code.toLowerCase() }, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.card.issued, 5000);
  assert.equal(r.body.card.spent, 2000);
  assert.equal(r.body.card.balance, 3000);
  assert.equal(r.body.card.buyer, 'kundin@example.ch');
  assert.equal(r.body.card.spends.length, 1);
});

test('a card that does not exist says so', async () => {
  const cookie = await signedIn();
  resetLimiter();
  assert.equal((await call({ action: 'gift-find', code: 'ZG-2345-6789-ABCD' }, { cookie })).status, 404);
  resetLimiter();
  assert.equal((await call({ action: 'gift-find', code: 'nonsense' }, { cookie })).status, 404);
});

test('a card can be issued by hand', async () => {
  const cookie = await signedIn();
  resetLimiter();
  const r = await call({ action: 'gift-issue', amount: 2500, note: 'goodwill' }, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.card.issued, 2500);
  assert.equal(r.body.card.balance, 2500);
  assert.match(r.body.card.code, /^ZG-/);
  // and it is a real card the shop can spend
  assert.equal(gc.available(await gc.load(r.body.card.code)), 2500);
});

test('an absurd amount is refused', async () => {
  const cookie = await signedIn();
  for (const amount of [0, -100, 100001, NaN, 'lots', null]) {
    resetLimiter();
    assert.equal((await call({ action: 'gift-issue', amount }, { cookie })).status, 400, String(amount));
  }
});

test('a leaked code can be voided, and restored', async () => {
  const cookie = await signedIn();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });

  resetLimiter();
  const off = await call({ action: 'gift-void', code: card.code, reason: 'posted on a forum' }, { cookie });
  assert.equal(off.body.card.voided, true);
  assert.equal(off.body.card.balance, 0);
  assert.equal(off.body.card.issued, 5000, 'the history is kept, not erased');
  assert.equal((await gc.hold(card.code, 'cs_try', 1000)).ok, false, 'and it cannot be spent');

  resetLimiter();
  const on = await call({ action: 'gift-void', code: card.code, voided: false }, { cookie });
  assert.equal(on.body.card.voided, false);
  assert.equal(on.body.card.balance, 5000, 'voiding is reversible because nothing was deleted');
});

test('the summary adds up', async () => {
  const cookie = await signedIn();
  const a = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  await gc.issue({ amount: 2500, issuedFor: 'cs_2' });
  await gc.hold(a.code, 'cs_x', 2000);
  await gc.settle(a.code, 'cs_x');
  await auth.createAccount({ name: 'A', email: 'a@example.ch', password: 'a decent long passphrase' });

  resetLimiter();
  const { body } = await call({ action: 'summary' }, { cookie });
  assert.equal(body.cards.count, 2);
  assert.equal(body.cards.issued, 7500);
  assert.equal(body.cards.spent, 2000);
  assert.equal(body.cards.outstanding, 5500, 'what the shop still owes');
  assert.equal(body.accounts.count, 1);
});

/* ------------------------------------------------------------- accounts */

test('an account can be found, without its password', async () => {
  const cookie = await signedIn();
  const made = await auth.createAccount({
    name: 'A Kundin', email: 'kundin@example.ch', password: 'a decent long passphrase',
  });
  await auth.recordOrder(made.account.id, { session: 'cs_1', total: '45.08', currency: 'CHF', date: '2026-10-03' });

  resetLimiter();
  const r = await call({ action: 'account-find', email: 'KUNDIN@example.ch' }, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.account.name, 'A Kundin');
  assert.equal(r.body.account.orders.length, 1);
  const blob = JSON.stringify(r.body);
  for (const leak of ['scrypt', 'salt', 'password']) {
    assert.ok(!blob.includes(leak), `the back office must not hand out ${leak}`);
  }
});

test('an account can be signed out everywhere, and deleted', async () => {
  const cookie = await signedIn();
  const made = await auth.createAccount({
    name: 'A', email: 'a@example.ch', password: 'a decent long passphrase',
  });
  const theirs = await auth.startSession(made.account.id);

  resetLimiter();
  const out = await call({ action: 'account-signout', email: 'a@example.ch' }, { cookie });
  assert.equal(out.body.ended, 1);
  assert.equal(await auth.sessionAccount(theirs), null);

  resetLimiter();
  assert.equal((await call({ action: 'account-delete', email: 'a@example.ch' }, { cookie })).body.deleted, true);
  assert.equal(await auth.findAccount('a@example.ch'), null);
  assert.equal(await auth.accountById(made.account.id), null);
});

test('an address with no account says so rather than pretending', async () => {
  const cookie = await signedIn();
  for (const action of ['account-find', 'account-delete', 'account-signout']) {
    resetLimiter();
    assert.equal((await call({ action, email: 'nobody@example.ch' }, { cookie })).status, 404, action);
  }
  resetLimiter();
  assert.equal((await call({ action: 'account-find', email: 'not an address' }, { cookie })).status, 400);
});

/* --------------------------------------------------------------- backup */

test('the export carries the whole ledger and no password', async () => {
  const cookie = await signedIn();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  await gc.hold(card.code, 'cs_x', 2000);
  await auth.createAccount({ name: 'A', email: 'a@example.ch', password: 'a decent long passphrase' });

  resetLimiter();
  const { body } = await call({ action: 'export' }, { cookie });
  assert.ok(body.takenAt);
  assert.equal(body.giftCards.length, 1);
  assert.equal(body.giftCards[0].issued, 5000);
  assert.ok(body.giftCards[0].holds, 'a backup must be able to restore a balance exactly, holds and all');
  assert.equal(body.accounts.length, 1);

  const blob = JSON.stringify(body);
  for (const leak of ['scrypt', 'salt', '"hash"', TOKEN]) {
    assert.ok(!blob.includes(leak), `the export must not carry ${leak}`);
  }
});

test('an export can be read back into an empty store', async () => {
  const cookie = await signedIn();
  const card = await gc.issue({ amount: 5000, issuedFor: 'cs_1' });
  await gc.hold(card.code, 'cs_x', 2000);
  await gc.settle(card.code, 'cs_x');
  resetLimiter();
  const { body } = await call({ action: 'export' }, { cookie });

  /* Wipe, then put it back the way the runbook says. */
  const s = useMemoryStore();
  for (const c of body.giftCards) await s.create('gift/' + c.code.replace(/-/g, ''), c);

  const back = await gc.load(card.code);
  assert.equal(back.issued, 5000);
  assert.equal(gc.spent(back), 2000);
  assert.equal(gc.available(back), 3000, 'the balance must come back exactly as it stood');
});

/* ---------------------------------------------------------- rate limit */

test('a client hammering the door is slowed down', async () => {
  useMemoryStore(); resetLimiter();
  for (let i = 0; i < 10; i++) {
    assert.equal((await call({ action: 'login', token: 'guess' + i }, { ip: '9.9.9.9' })).status, 401, `try ${i}`);
  }
  assert.equal((await call({ action: 'login', token: 'guess-again' }, { ip: '9.9.9.9' })).status, 429);
  assert.equal((await call({ action: 'login', token: 'guess' }, { ip: '8.8.8.8' })).status, 401);
});

test('the limit is on the door, not on working once you are through', async () => {
  /* Counting every action locked the owner out after a few card lookups —
     useless against guessing, and a nuisance to the only person entitled to
     be here. */
  const cookie = await signedIn();
  for (let i = 0; i < 40; i++) {
    const r = await call({ action: 'summary' }, { cookie, ip: '7.7.7.7' });
    assert.equal(r.status, 200, `action ${i + 1} must still work`);
  }
});

test('guessing is still slowed down', async () => {
  useMemoryStore(); resetLimiter();
  for (let i = 0; i < 10; i++) {
    assert.equal((await call({ action: 'login', token: 'guess' + i }, { ip: '6.6.6.6' })).status, 401);
  }
  assert.equal((await call({ action: 'login', token: 'guess-more' }, { ip: '6.6.6.6' })).status, 429);
});

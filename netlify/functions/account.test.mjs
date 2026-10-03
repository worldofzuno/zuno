/**
 * Checks on the account endpoint, run with:
 *
 *     node --test netlify/functions/account.test.mjs
 *
 * Beyond "does signing in work", two properties matter and are easy to lose:
 * the endpoint must not tell a stranger which addresses have accounts, and a
 * cookie must be the only thing that decides who you are.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useMemoryStore } = await import('./store.mjs');
const { resetLimiter } = await import('./fnf.mjs');
const auth = await import('./auth.mjs');
const handler = (await import('./account.mjs')).default;

const PW = 'a decent long passphrase';

const post = (body, { cookie, ip = '1.2.3.4' } = {}) =>
  handler(new Request('https://worldofzuno.com/.netlify/functions/account', {
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
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') };
};

const asCookie = (setCookie) => setCookie.split(';')[0];

async function registered() {
  useMemoryStore();
  resetLimiter();
  return call({ action: 'register', name: 'A Kundin', email: 'kundin@example.ch', password: PW });
}

/* -------------------------------------------------------------- the shape */

test('anything but POST is refused', async () => {
  const res = await handler(new Request('https://worldofzuno.com/x', { method: 'GET' }));
  assert.equal(res.status, 405);
});

test('a body that is not JSON, or an action we do not have, is a 400', async () => {
  useMemoryStore(); resetLimiter();
  const bad = await handler(new Request('https://worldofzuno.com/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'nope',
  }));
  assert.equal(bad.status, 400);
  assert.equal((await call({ action: 'dance' })).status, 400);
});

test('nothing from this endpoint is cached', async () => {
  useMemoryStore(); resetLimiter();
  const res = await post({ action: 'me' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

/* ------------------------------------------------------------- signing up */

test('registering signs you in and sets a cookie', async () => {
  const r = await registered();
  assert.equal(r.status, 200);
  assert.equal(r.body.signedIn, true);
  assert.equal(r.body.account.email, 'kundin@example.ch');
  assert.deepEqual(r.body.orders, []);
  assert.ok(r.cookie.includes('HttpOnly') && r.cookie.includes('Secure'));
});

test('a weak password is refused, and says why', async () => {
  useMemoryStore(); resetLimiter();
  const r = await call({ action: 'register', name: 'A', email: 'a@example.ch', password: 'short' });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'password');
  assert.match(r.body.error, /at least 10/);
});

test('an address already taken is not announced to whoever asked', async () => {
  await registered();
  resetLimiter();
  const again = await call({
    action: 'register', name: 'Someone Else', email: 'kundin@example.ch', password: 'another long one',
  });
  /* The same answer a new address gets. Someone running a list of addresses
     through this learns nothing from it. */
  assert.equal(again.status, 200);
  assert.equal(again.body.signedIn, false);
  assert.equal(again.body.checkInbox, true);
  assert.ok(!JSON.stringify(again.body).toLowerCase().includes('taken'));
  assert.ok(!JSON.stringify(again.body).toLowerCase().includes('exists'));
  assert.equal(again.cookie, null, 'and certainly no session for someone else\'s account');
});

test('the original account is untouched by a second attempt on its address', async () => {
  const first = await registered();
  resetLimiter();
  await call({ action: 'register', name: 'Someone Else', email: 'kundin@example.ch', password: 'another long one' });
  resetLimiter();
  const signedIn = await call({ action: 'login', email: 'kundin@example.ch', password: PW });
  assert.equal(signedIn.body.signedIn, true);
  assert.equal(signedIn.body.account.id, first.body.account.id);
  assert.equal(signedIn.body.account.name, 'A Kundin', 'the name must not have been overwritten');
});

/* ------------------------------------------------------------- signing in */

test('the right password signs you in', async () => {
  await registered();
  resetLimiter();
  const r = await call({ action: 'login', email: 'KUNDIN@example.ch', password: PW });
  assert.equal(r.status, 200);
  assert.equal(r.body.signedIn, true);
  assert.ok(r.cookie);
});

test('a wrong password and an unknown address are answered identically', async () => {
  await registered();
  resetLimiter();
  const wrong = await call({ action: 'login', email: 'kundin@example.ch', password: 'not it at all' });
  resetLimiter();
  const unknown = await call({ action: 'login', email: 'nobody@example.ch', password: 'not it at all' });

  assert.equal(wrong.status, unknown.status);
  assert.deepEqual(wrong.body, unknown.body,
    'any difference here is a way to find out who shops at ZUNO');
  assert.equal(wrong.cookie, null);
  assert.equal(unknown.cookie, null);
});

test('a reply never says whether an account exists', async () => {
  await registered();
  resetLimiter();
  const r = await call({ action: 'login', email: 'kundin@example.ch', password: 'wrong one here' });
  const blob = JSON.stringify(r.body).toLowerCase();
  for (const leak of ['no such', 'not found', 'unknown', 'exists', 'incorrect password', 'wrong password']) {
    assert.ok(!blob.includes(leak), `must not say "${leak}"`);
  }
});

test('an empty or missing password does not sign anyone in', async () => {
  await registered();
  for (const password of ['', null, undefined, 0, {}, []]) {
    resetLimiter();
    const r = await call({ action: 'login', email: 'kundin@example.ch', password });
    assert.equal(r.body.signedIn, undefined, JSON.stringify(password));
    assert.equal(r.status, 401);
  }
});

test('enough wrong guesses lock the account, and the right password then waits too', async () => {
  await registered();
  for (let i = 0; i < 8; i++) {
    resetLimiter();
    await call({ action: 'login', email: 'kundin@example.ch', password: 'wrong one here' });
  }
  resetLimiter();
  const r = await call({ action: 'login', email: 'kundin@example.ch', password: PW });
  assert.equal(r.status, 429);
  assert.equal(r.body.locked, true);
  assert.equal(r.cookie, null);
});

test('a client hammering the endpoint is slowed down before it reaches a password', async () => {
  useMemoryStore(); resetLimiter();
  for (let i = 0; i < 10; i++) {
    const r = await call({ action: 'login', email: `guess${i}@example.ch`, password: 'whatever long' });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  assert.equal((await call({ action: 'login', email: 'one@example.ch', password: 'whatever long' })).status, 429);
  // another caller is unaffected
  assert.equal((await call({ action: 'login', email: 'two@example.ch', password: 'whatever long' }, { ip: '9.9.9.9' })).status, 401);
});

/* ------------------------------------------------------------- who am I */

test('without a cookie you are nobody', async () => {
  useMemoryStore(); resetLimiter();
  const r = await call({ action: 'me' });
  assert.deepEqual(r.body, { signedIn: false });
});

test('a made-up cookie is not a session', async () => {
  await registered();
  resetLimiter();
  for (const fake of ['zuno_session=x', 'zuno_session=' + 'a'.repeat(43), 'other=1']) {
    const r = await call({ action: 'me' }, { cookie: fake });
    assert.equal(r.body.signedIn, false, fake);
  }
});

test('the cookie from signing in says who you are, and what you bought', async () => {
  const r = await registered();
  await auth.recordOrder(r.body.account.id, { session: 'cs_1', total: '45.08' });
  resetLimiter();
  const me = await call({ action: 'me' }, { cookie: asCookie(r.cookie) });
  assert.equal(me.body.signedIn, true);
  assert.equal(me.body.account.email, 'kundin@example.ch');
  assert.equal(me.body.orders.length, 1);
});

test('one account never sees another account orders', async () => {
  useMemoryStore(); resetLimiter();
  const mine = await call({ action: 'register', name: 'A', email: 'a@example.ch', password: PW });
  resetLimiter();
  const theirs = await call({ action: 'register', name: 'B', email: 'b@example.ch', password: PW });
  await auth.recordOrder(theirs.body.account.id, { session: 'cs_theirs', total: '99.00' });

  resetLimiter();
  const me = await call({ action: 'me' }, { cookie: asCookie(mine.cookie) });
  assert.deepEqual(me.body.orders, []);
  assert.ok(!JSON.stringify(me.body).includes('cs_theirs'));
});

test('no reply ever carries a password or a ledger', async () => {
  const r = await registered();
  resetLimiter();
  const me = await call({ action: 'me' }, { cookie: asCookie(r.cookie) });
  for (const body of [r.body, me.body]) {
    const blob = JSON.stringify(body);
    for (const leak of [PW, 'scrypt', 'salt', 'failures', 'lockedUntil']) {
      assert.ok(!blob.includes(leak), `a reply must not carry ${leak}`);
    }
  }
});

/* ------------------------------------------------------------ signing out */

test('signing out clears the cookie and the session behind it', async () => {
  const r = await registered();
  const cookie = asCookie(r.cookie);
  resetLimiter();
  const out = await call({ action: 'logout' }, { cookie });
  assert.equal(out.body.signedIn, false);
  assert.ok(out.cookie.includes('Max-Age=0'));

  resetLimiter();
  const me = await call({ action: 'me' }, { cookie });
  assert.equal(me.body.signedIn, false, 'the old cookie must be worthless afterwards');
});

test('signing out when you were not signed in is harmless', async () => {
  useMemoryStore(); resetLimiter();
  const r = await call({ action: 'logout' });
  assert.equal(r.status, 200);
  assert.equal(r.body.signedIn, false);
});

/* ------------------------------------------- changing a password, deleting */

test('a password change needs a session', async () => {
  useMemoryStore(); resetLimiter();
  const r = await call({ action: 'password', current: PW, next: 'a brand new passphrase' });
  assert.equal(r.status, 401);
});

test('signed in with the current password, the change goes through', async () => {
  const me = await registered();
  resetLimiter();
  const r = await call({ action: 'password', current: PW, next: 'a brand new passphrase' },
    { cookie: asCookie(me.cookie) });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed, true);

  resetLimiter();
  assert.equal((await call({ action: 'login', email: 'kundin@example.ch', password: PW })).status, 401);
  resetLimiter();
  assert.equal((await call({ action: 'login', email: 'kundin@example.ch', password: 'a brand new passphrase' })).body.signedIn, true);
});

test('a session alone cannot change the password', async () => {
  const me = await registered();
  resetLimiter();
  const r = await call({ action: 'password', current: 'not my password', next: 'a brand new passphrase' },
    { cookie: asCookie(me.cookie) });
  assert.equal(r.status, 401);
  assert.equal(r.body.field, 'current');
  resetLimiter();
  assert.equal((await call({ action: 'login', email: 'kundin@example.ch', password: PW })).body.signedIn, true,
    'the old password must still be the password');
});

test('the device that changed it stays signed in', async () => {
  const me = await registered();
  resetLimiter();
  await call({ action: 'password', current: PW, next: 'a brand new passphrase' }, { cookie: asCookie(me.cookie) });
  resetLimiter();
  assert.equal((await call({ action: 'me' }, { cookie: asCookie(me.cookie) })).body.signedIn, true);
});

test('a deletion needs a session and the password', async () => {
  useMemoryStore(); resetLimiter();
  assert.equal((await call({ action: 'delete', password: PW })).status, 401);

  const me = await registered();
  resetLimiter();
  const wrong = await call({ action: 'delete', password: 'not my password' }, { cookie: asCookie(me.cookie) });
  assert.equal(wrong.status, 401);
  resetLimiter();
  assert.equal((await call({ action: 'me' }, { cookie: asCookie(me.cookie) })).body.signedIn, true,
    'a wrong password must leave the account standing');
});

test('deleting signs you out and clears the cookie', async () => {
  const me = await registered();
  resetLimiter();
  const r = await call({ action: 'delete', password: PW }, { cookie: asCookie(me.cookie) });
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, true);
  assert.ok(r.cookie.includes('Max-Age=0'));

  resetLimiter();
  assert.equal((await call({ action: 'me' }, { cookie: asCookie(me.cookie) })).body.signedIn, false);
  resetLimiter();
  assert.equal((await call({ action: 'login', email: 'kundin@example.ch', password: PW })).status, 401);
});

test('neither reply carries a password or a ledger', async () => {
  const me = await registered();
  resetLimiter();
  const changed = await call({ action: 'password', current: PW, next: 'a brand new passphrase' },
    { cookie: asCookie(me.cookie) });
  resetLimiter();
  const gone = await call({ action: 'delete', password: 'a brand new passphrase' },
    { cookie: asCookie(me.cookie) });
  for (const body of [changed.body, gone.body]) {
    const blob = JSON.stringify(body);
    for (const leak of [PW, 'a brand new passphrase', 'scrypt', 'salt', 'failures']) {
      assert.ok(!blob.includes(leak), `a reply must not carry ${leak}`);
    }
  }
});

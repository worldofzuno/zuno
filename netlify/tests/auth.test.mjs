/**
 * Checks on accounts, run with:
 *
 *     node --test netlify/functions/auth.test.mjs
 *
 * This is the only part of the shop holding a secret that belongs to someone
 * else, and the one where a mistake costs more than a bag of coffee. So the
 * tests are about the ways a password store goes wrong: the password itself
 * reachable, two accounts sharing a derivation, a comparison that leaks, an
 * endpoint that says which addresses are customers, a session that outlives
 * its welcome, and an account reading another account's orders.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useMemoryStore, store } = await import('../functions/store.mjs');
const auth = await import('../functions/auth.mjs');

const PW = 'a decent long passphrase';

async function freshAccount(over = {}) {
  useMemoryStore();
  const r = await auth.createAccount({
    name: 'A Kundin', email: 'kundin@example.ch', password: PW, ...over,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.account;
}

/* ---------------------------------------------------------------- email */

test('an address is matched however it was typed', async () => {
  const a = await freshAccount();
  for (const typed of ['kundin@example.ch', 'Kundin@Example.CH', '  kundin@example.ch  ']) {
    const found = await auth.findAccount(typed);
    assert.ok(found, typed);
    assert.equal(found.id, a.id);
  }
});

test('what is obviously not an address is refused', () => {
  for (const bad of ['', 'kundin', 'kundin@', '@example.ch', 'a@b', 'x'.repeat(260) + '@e.ch',
                     'two words@example.ch', null, undefined, 42]) {
    assert.equal(auth.looksLikeEmail(bad), false, JSON.stringify(bad));
  }
  for (const good of ['a@b.ch', 'first.last+tag@sub.example.co.uk']) {
    assert.equal(auth.looksLikeEmail(good), true, good);
  }
});

test('the address is not in the clear in the store key', async () => {
  const a = await freshAccount();
  const keys = await (await store()).list('');
  assert.ok(keys.length > 0);
  for (const k of keys) {
    assert.ok(!k.includes('kundin'), `a listing must not be a customer list: ${k}`);
    assert.ok(!k.includes('example.ch'), k);
  }
  assert.ok(auth.keyForEmail(a.email).startsWith('account/'));
});

/* ------------------------------------------------------------- passwords */

test('the password is nowhere in what is stored', async () => {
  await freshAccount();
  const blob = JSON.stringify((await (await store()).read(auth.keyForEmail('kundin@example.ch'))).value);
  assert.ok(!blob.includes(PW), 'the password itself must never be written down');
  assert.ok(!blob.includes('passphrase'));
  assert.ok(blob.includes('scrypt'));
});

test('a stored password is never returned to anyone', async () => {
  const a = await freshAccount();
  const blob = JSON.stringify(auth.publicAccount(a));
  for (const leak of ['scrypt', 'salt', 'hash', PW, 'orders', 'failures']) {
    assert.ok(!blob.includes(leak), `the public view must not carry ${leak}`);
  }
  assert.deepEqual(Object.keys(auth.publicAccount(a)).sort(),
    ['createdAt', 'email', 'id', 'name', 'verified']);
});

test('the right password matches and a wrong one does not', async () => {
  const a = await freshAccount();
  assert.equal(await auth.passwordMatches(PW, a.password), true);
  for (const bad of ['', 'wrong', PW + ' ', ' ' + PW, PW.toUpperCase(), PW.slice(0, -1)]) {
    assert.equal(await auth.passwordMatches(bad, a.password), false, JSON.stringify(bad));
  }
});

test('two accounts with the same password get different derivations', async () => {
  useMemoryStore();
  const one = await auth.createAccount({ name: 'A', email: 'a@example.ch', password: PW });
  const two = await auth.createAccount({ name: 'B', email: 'b@example.ch', password: PW });
  assert.notEqual(one.account.password.salt, two.account.password.salt);
  assert.notEqual(one.account.password.hash, two.account.password.hash,
    'without a per-account salt one cracked password is every account with it');
});

test('a malformed stored password never matches and never throws', async () => {
  /* Base64 decoding does not throw on rubbish, it returns what it could make
     of it — and an empty buffer compares equal to an empty buffer. A record
     damaged in any of these ways once accepted every password. */
  const broken = [
    null, undefined, {}, { algorithm: 'md5' },
    { algorithm: 'scrypt', salt: 'not base64!!', hash: '??' },
    { algorithm: 'scrypt', salt: '', hash: '' },
    { algorithm: 'scrypt', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: '' },
    { algorithm: 'scrypt', salt: 'AAAAAAAAAAAAAAAAAAAAAA==', hash: 'AAAA' },
  ];
  for (const b of broken) {
    assert.equal(await auth.passwordMatches(PW, b), false, JSON.stringify(b));
    assert.equal(await auth.passwordMatches('', b), false, JSON.stringify(b));
    assert.equal(await auth.passwordMatches('anything at all', b), false, JSON.stringify(b));
  }
});

test('a password must be long, and must not be the address it protects', () => {
  assert.equal(auth.passwordProblem('a decent long passphrase', 'kundin@example.ch'), null);
  assert.match(auth.passwordProblem('short', 'k@e.ch'), /at least 10/);
  assert.match(auth.passwordProblem('x'.repeat(201), 'k@e.ch'), /too long/);
  assert.match(auth.passwordProblem('kundin12345', 'kundin@example.ch'), /part of your email/);
  assert.match(auth.passwordProblem(null, 'k@e.ch'), /required/);
  // no composition rules: a long passphrase of plain words is fine
  assert.equal(auth.passwordProblem('correct horse battery staple', 'k@e.ch'), null);
});

test('an enormous password is refused rather than ground through scrypt', async () => {
  const a = await freshAccount();
  assert.equal(await auth.passwordMatches('x'.repeat(100000), a.password), false);
});

/* -------------------------------------------------------------- accounts */

test('an address can only be registered once', async () => {
  await freshAccount();
  const again = await auth.createAccount({
    name: 'Someone Else', email: 'KUNDIN@example.ch', password: 'another long passphrase',
  });
  assert.deepEqual(again, { ok: false, reason: 'taken' });
});

test('a bad name, address or password is refused with which one', async () => {
  useMemoryStore();
  assert.equal((await auth.createAccount({ name: 'A', email: 'nope', password: PW })).reason, 'email');
  assert.equal((await auth.createAccount({ name: '  ', email: 'a@b.ch', password: PW })).reason, 'name');
  assert.equal((await auth.createAccount({ name: 'A', email: 'a@b.ch', password: 'short' })).reason, 'password');
});

test('an account is found by its id without walking every account', async () => {
  const a = await freshAccount();
  const found = await auth.accountById(a.id);
  assert.equal(found.email, 'kundin@example.ch');
  assert.equal(await auth.accountById('not-an-id'), null);
  assert.equal(await auth.accountById(''), null);
  // the index exists, so the lookup is a read rather than a scan
  assert.ok((await (await store()).read(auth.keyForId(a.id))).value);
});

test('a lost index still finds the account', async () => {
  const a = await freshAccount();
  await (await store()).remove(auth.keyForId(a.id));
  const found = await auth.accountById(a.id);
  assert.equal(found && found.id, a.id, 'correctness first, speed second');
});

/* -------------------------------------------------------------- lockout */

test('enough wrong guesses lock the account for a while', async () => {
  const a = await freshAccount();
  const now = Date.now();
  assert.equal(auth.lockedOut(await auth.findAccount(a.email), now), false);
  for (let i = 0; i < 7; i++) await auth.noteFailure(a.email, now);
  assert.equal(auth.lockedOut(await auth.findAccount(a.email), now), false, 'seven is not yet');
  await auth.noteFailure(a.email, now);
  assert.equal(auth.lockedOut(await auth.findAccount(a.email), now), true, 'eight is');
});

test('the lock lifts by itself, and a success clears the count', async () => {
  const a = await freshAccount();
  const now = Date.now();
  for (let i = 0; i < 8; i++) await auth.noteFailure(a.email, now);
  assert.equal(auth.lockedOut(await auth.findAccount(a.email), now + 16 * 60 * 1000), false);

  await auth.noteSuccess(a.email);
  const after = await auth.findAccount(a.email);
  assert.equal(after.failures, 0);
  assert.equal(after.lockedUntil, 0);
});

/* -------------------------------------------------------------- sessions */

test('a session names its account, and only while it is alive', async () => {
  const a = await freshAccount();
  const token = await auth.startSession(a.id);
  assert.equal((await auth.sessionAccount(token)).id, a.id);

  const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
  assert.equal(await auth.sessionAccount(token, later), null, 'a session must not last for ever');
});

test('an expired session is cleared out as it is found', async () => {
  const a = await freshAccount();
  const token = await auth.startSession(a.id);
  const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
  await auth.sessionAccount(token, later);
  const left = (await (await store()).list('session/')).length;
  assert.equal(left, 0, 'dead sessions must not pile up');
});

test('the token itself is not what is stored', async () => {
  const a = await freshAccount();
  const token = await auth.startSession(a.id);
  const keys = await (await store()).list('session/');
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes(token),
    'someone who reads the store must not be able to sign in with what they find');
  const blob = JSON.stringify((await (await store()).read(keys[0])).value);
  assert.ok(!blob.includes(token));
});

test('rubbish is not a session', async () => {
  await freshAccount();
  for (const bad of ['', 'x', null, undefined, 42, 'y'.repeat(500), 'a'.repeat(43)]) {
    assert.equal(await auth.sessionAccount(bad), null, JSON.stringify(bad));
  }
});

test('signing out ends that session and not the others', async () => {
  const a = await freshAccount();
  const phone = await auth.startSession(a.id);
  const laptop = await auth.startSession(a.id);
  await auth.endSession(phone);
  assert.equal(await auth.sessionAccount(phone), null);
  assert.equal((await auth.sessionAccount(laptop)).id, a.id, 'the other device stays signed in');
});

test('two sessions are two different tokens', async () => {
  const a = await freshAccount();
  const one = await auth.startSession(a.id);
  const two = await auth.startSession(a.id);
  assert.notEqual(one, two);
  assert.ok(one.length >= 32);
});

/* --------------------------------------------------------------- cookies */

test('the cookie is read out of a header with other cookies in it', () => {
  assert.equal(auth.readCookie('a=1; zuno_session=abc123; b=2'), 'abc123');
  assert.equal(auth.readCookie('zuno_session=abc123'), 'abc123');
  assert.equal(auth.readCookie('other=1'), null);
  assert.equal(auth.readCookie(''), null);
  assert.equal(auth.readCookie(null), null);
  // a value that had to be encoded comes back as it went in
  assert.equal(auth.readCookie('zuno_session=' + encodeURIComponent('a b+c')), 'a b+c');
});

test('the cookie cannot be read by a script or sent over plain http', () => {
  const c = auth.setCookie('tok');
  assert.ok(c.includes('HttpOnly'));
  assert.ok(c.includes('Secure'));
  assert.ok(c.includes('SameSite=Lax'), 'this is what stands in for a CSRF token');
  assert.ok(c.includes('Path=/'));
  assert.ok(auth.clearCookie().includes('Max-Age=0'));
});

/* ---------------------------------------------------------------- orders */

test('an order is filed under the account that placed it', async () => {
  const a = await freshAccount();
  assert.equal(await auth.recordOrder(a.id, { session: 'cs_1', total: '45.08' }), true);
  const after = await auth.findAccount(a.email);
  assert.equal(after.orders.length, 1);
  assert.equal(after.orders[0].session, 'cs_1');
});

test('a redelivered order is filed once', async () => {
  const a = await freshAccount();
  await auth.recordOrder(a.id, { session: 'cs_1', total: '45.08' });
  assert.equal(await auth.recordOrder(a.id, { session: 'cs_1', total: '45.08' }), false);
  assert.equal((await auth.findAccount(a.email)).orders.length, 1);
});

test('an order for nobody is filed nowhere', async () => {
  const a = await freshAccount();
  assert.equal(await auth.recordOrder(null, { session: 'cs_1' }), false);
  assert.equal(await auth.recordOrder('some-other-id', { session: 'cs_1' }), false);
  assert.equal((await auth.findAccount(a.email)).orders.length, 0);
});

test('one account cannot see another account orders', async () => {
  useMemoryStore();
  const mine = (await auth.createAccount({ name: 'A', email: 'a@example.ch', password: PW })).account;
  const theirs = (await auth.createAccount({ name: 'B', email: 'b@example.ch', password: PW })).account;
  await auth.recordOrder(theirs.id, { session: 'cs_theirs', total: '99.00' });

  const token = await auth.startSession(mine.id);
  const seen = await auth.sessionAccount(token);
  assert.equal(seen.id, mine.id);
  assert.deepEqual(seen.orders, [], 'a shared address would not be enough either');
});

/* -------------------------------------------------- changing a password */

test('the right current password changes it, and the old one stops working', async () => {
  const a = await freshAccount();
  const r = await auth.changePassword(a.email, PW, 'a brand new passphrase');
  assert.equal(r.ok, true);

  const after = await auth.findAccount(a.email);
  assert.equal(await auth.passwordMatches('a brand new passphrase', after.password), true);
  assert.equal(await auth.passwordMatches(PW, after.password), false);
});

test('a wrong current password changes nothing', async () => {
  const a = await freshAccount();
  const r = await auth.changePassword(a.email, 'not my password', 'a brand new passphrase');
  assert.deepEqual(r, { ok: false, reason: 'wrong' });
  assert.equal(await auth.passwordMatches(PW, (await auth.findAccount(a.email)).password), true,
    'a cookie alone must not be enough to lock the owner out');
});

test('the new password has to clear the same bar as the first one', async () => {
  const a = await freshAccount();
  assert.equal((await auth.changePassword(a.email, PW, 'short')).reason, 'password');
  assert.equal((await auth.changePassword(a.email, PW, 'kundin1234567')).reason, 'password');
  assert.equal(await auth.passwordMatches(PW, (await auth.findAccount(a.email)).password), true);
});

test('changing to the password you already have is refused, not silently done', async () => {
  const a = await freshAccount();
  const r = await auth.changePassword(a.email, PW, PW);
  assert.equal(r.reason, 'same');
  assert.match(r.message, /already have/);
});

test('changing a password signs out the other devices but not this one', async () => {
  const a = await freshAccount();
  const laptop = await auth.startSession(a.id);
  const phone = await auth.startSession(a.id);
  const stolen = await auth.startSession(a.id);

  const r = await auth.changePassword(a.email, PW, 'a brand new passphrase', laptop);
  assert.equal(r.ok, true);
  assert.equal(r.otherSessionsEnded, 2);
  assert.equal((await auth.sessionAccount(laptop)).id, a.id, 'the device doing it stays in');
  assert.equal(await auth.sessionAccount(phone), null);
  assert.equal(await auth.sessionAccount(stolen), null,
    'otherwise the change protects nothing — whoever held the old session keeps it');
});

test('a change unlocks an account that had been locked out', async () => {
  const a = await freshAccount();
  const now = Date.now();
  for (let i = 0; i < 8; i++) await auth.noteFailure(a.email, now);
  assert.equal(auth.lockedOut(await auth.findAccount(a.email), now), true);
  await auth.changePassword(a.email, PW, 'a brand new passphrase');
  assert.equal(auth.lockedOut(await auth.findAccount(a.email), now), false);
});

test('changing the password of an account that is not there', async () => {
  await freshAccount();
  assert.equal((await auth.changePassword('nobody@example.ch', PW, 'another long one')).reason, 'unknown');
});

/* ------------------------------------------------------ deleting it all */

test('deleting takes the account, the index and every session', async () => {
  const a = await freshAccount();
  const one = await auth.startSession(a.id);
  const two = await auth.startSession(a.id);

  assert.deepEqual(await auth.deleteAccount(a.email, PW), { ok: true });
  assert.equal(await auth.findAccount(a.email), null);
  assert.equal(await auth.accountById(a.id), null);
  assert.equal(await auth.sessionAccount(one), null);
  assert.equal(await auth.sessionAccount(two), null);

  const left = await (await store()).list('');
  assert.deepEqual(left, [], 'nothing of the account may be left behind');
});

test('a wrong password deletes nothing', async () => {
  const a = await freshAccount();
  assert.deepEqual(await auth.deleteAccount(a.email, 'not my password'), { ok: false, reason: 'wrong' });
  assert.ok(await auth.findAccount(a.email));
});

test('the address is free again afterwards', async () => {
  const a = await freshAccount();
  await auth.deleteAccount(a.email, PW);
  const again = await auth.createAccount({ name: 'Someone New', email: a.email, password: PW });
  assert.equal(again.ok, true);
  assert.notEqual(again.account.id, a.id, 'a new account, not the old one back');
});

test('deleting one account leaves the others alone', async () => {
  useMemoryStore();
  const mine = (await auth.createAccount({ name: 'A', email: 'a@example.ch', password: PW })).account;
  const theirs = (await auth.createAccount({ name: 'B', email: 'b@example.ch', password: PW })).account;
  const theirSession = await auth.startSession(theirs.id);

  await auth.deleteAccount(mine.email, PW);
  assert.equal(await auth.findAccount('a@example.ch'), null);
  assert.ok(await auth.findAccount('b@example.ch'));
  assert.equal((await auth.sessionAccount(theirSession)).id, theirs.id);
});

test('deleting an account that is not there', async () => {
  useMemoryStore();
  assert.deepEqual(await auth.deleteAccount('nobody@example.ch', PW), { ok: false, reason: 'unknown' });
});

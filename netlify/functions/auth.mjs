/**
 * Accounts: passwords, sessions, and the care both need.
 *
 * This is the only part of the shop that holds a secret belonging to someone
 * else. A coffee order that goes wrong costs a bag of coffee; a password
 * store that goes wrong costs people the password they also used elsewhere.
 * So the rules here are stricter than anywhere else in this folder, and the
 * reasoning is written down rather than assumed.
 *
 *   - A password is never stored, logged, or returned. What is stored is a
 *     scrypt derivation with a per-account salt.
 *   - Comparisons are constant time, including the one that decides whether
 *     an account exists at all.
 *   - A wrong password and an unknown email are answered identically, so the
 *     endpoint cannot be used to find out who has an account here.
 *   - A session is a random token that means nothing by itself; what it
 *     stands for lives in the store and can be revoked.
 *
 * What is deliberately NOT here, and why it matters:
 *
 *   - No email verification, and so no claiming of orders placed as a guest.
 *     Verification needs mail, and until a provider is configured nothing
 *     can be sent. Order history therefore shows only orders placed while
 *     signed in — never orders matched by address, which an unverified
 *     account would turn into a way to read a stranger's orders.
 *   - No password reset, for the same reason. See ACCOUNTS.md.
 */

import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mutate, store } from './store.mjs';

const scrypt = promisify(scryptCb);

/* scrypt rather than a bare hash, because a bare hash of a human password is
   a dictionary away from the password. N=2^14 with r=8 costs about 16 MB and
   a tenth of a second per attempt, which a function can afford and a
   dictionary cannot. maxmem is raised explicitly: the default is 32 MB and
   the check is 128*N*r plus overhead, which sits uncomfortably close. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;   // scrypt over an unbounded input is a way to burn the function
const SESSION_DAYS = 30;
const LOCKOUT_AFTER = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/* --------------------------------------------------------------- email --- */

export function normaliseEmail(input) {
  return String(input == null ? '' : input).trim().toLowerCase();
}

/* Deliberately loose. Email addresses are stranger than any regex, and the
   only authority on whether one works is whether mail arrives. This rejects
   what is obviously not an address and nothing more. */
export function looksLikeEmail(input) {
  const e = normaliseEmail(input);
  return e.length >= 6 && e.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e);
}

/* The address is the key, but not in the clear: a listing of the store would
   otherwise be a customer list. The hash is unsalted on purpose — it has to
   be derivable from the address alone to find the account. */
export const keyForEmail = (email) =>
  'account/' + createHash('sha256').update(normaliseEmail(email)).digest('hex');

/* --------------------------------------------------------- the password --- */

export function passwordProblem(password, email) {
  if (typeof password !== 'string') return 'A password is required.';
  if (password.length < PASSWORD_MIN) return `Please use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return 'That password is too long.';
  /* No composition rules — they push people towards Passw0rd! and no further.
     Length is what helps. The one content rule that earns its place: the
     password may not be the address it protects. */
  const local = normaliseEmail(email).split('@')[0];
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    return 'Please choose a password that is not part of your email address.';
  }
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return {
    algorithm: 'scrypt',
    params: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    salt: salt.toString('base64'),
    hash: Buffer.from(derived).toString('base64'),
  };
}

/** Constant time, and it never throws on a malformed record. */
export async function passwordMatches(password, stored) {
  if (!stored || stored.algorithm !== 'scrypt' || typeof password !== 'string') return false;
  if (password.length > PASSWORD_MAX) return false;
  try {
    const salt = Buffer.from(stored.salt, 'base64');
    const want = Buffer.from(stored.hash, 'base64');

    /* Base64 decoding does not throw on rubbish — it returns whatever it
       could make of it, which for an unusable value is an empty buffer. Two
       empty buffers compare equal, so without this check a record damaged in
       any way would accept every password. The lengths are therefore
       required to be the ones hashPassword writes, not merely equal to each
       other. */
    if (want.length !== SCRYPT.keylen || salt.length < 16) return false;

    const got = Buffer.from(await scrypt(password, salt, want.length, { ...SCRYPT, ...stored.params }));
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/**
 * Work done whether or not the account exists.
 *
 * Without this, a sign-in against an unknown address returns in a
 * millisecond and one against a real address takes a hundred — which tells
 * anyone who asks which of their guesses are customers here.
 */
export async function burnTime() {
  await scrypt('no account by that name', randomBytes(16), SCRYPT.keylen, SCRYPT);
}

/* -------------------------------------------------------------- accounts --- */

export const publicAccount = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  createdAt: a.createdAt,
  verified: a.verified === true,
});

export async function findAccount(email) {
  if (!looksLikeEmail(email)) return null;
  const s = await store();
  const { value } = await s.read(keyForEmail(email));
  return value;
}

/**
 * @returns {{ok: true, account}} or {{ok: false, reason}}
 *   'taken' is reported to the caller, which must decide what to say about
 *   it — telling a stranger an address is registered is a disclosure.
 */
export async function createAccount({ name, email, password, now = Date.now() }) {
  if (!looksLikeEmail(email)) return { ok: false, reason: 'email' };
  const problem = passwordProblem(password, email);
  if (problem) return { ok: false, reason: 'password', message: problem };

  const clean = String(name == null ? '' : name).trim().slice(0, 80);
  if (clean.length < 1) return { ok: false, reason: 'name' };

  const account = {
    id: randomUUID(),
    email: normaliseEmail(email),
    name: clean,
    password: await hashPassword(password),
    createdAt: new Date(now).toISOString(),
    verified: false,
    failures: 0,
    lockedUntil: 0,
    orders: [],
  };

  const s = await store();
  if (!(await s.create(keyForEmail(email), account))) return { ok: false, reason: 'taken' };
  /* An index from id back to address, so a signed-in request is one read
     rather than a walk over every account. Written after the account, so a
     failure here leaves a usable account with a slow lookup rather than an
     index pointing at nothing. */
  await s.create(keyForId(account.id), { key: keyForEmail(email) });
  return { ok: true, account };
}

export const keyForId = (id) => `accountid/${id}`;

/** The account behind an id, by index where there is one. */
export async function accountById(id) {
  if (typeof id !== 'string' || !id) return null;
  const s = await store();
  const { value: pointer } = await s.read(keyForId(id));
  if (pointer && pointer.key) {
    const { value } = await s.read(pointer.key);
    if (value && value.id === id) return value;
  }
  /* No index: an account made before the index existed, or a write that did
     not land. Correctness first, speed second. */
  for (const key of await s.list('account/')) {
    const { value } = await s.read(key);
    if (value && value.id === id) return value;
  }
  return null;
}

export const lockedOut = (account, now = Date.now()) =>
  Boolean(account && account.lockedUntil && account.lockedUntil > now);

/** Records a failed attempt, and locks the account for a while after enough
    of them. Bounded, so a forgotten password is an annoyance and a guessing
    run is not worth starting. */
export async function noteFailure(email, now = Date.now()) {
  await mutate(keyForEmail(email), (a) => {
    if (!a) return null;
    const failures = (a.failures || 0) + 1;
    return {
      ...a,
      failures,
      lockedUntil: failures >= LOCKOUT_AFTER ? now + LOCKOUT_MS : (a.lockedUntil || 0),
    };
  });
}

export async function noteSuccess(email) {
  await mutate(keyForEmail(email), (a) => (a ? { ...a, failures: 0, lockedUntil: 0 } : null));
}

/* -------------------------------------------------------------- sessions --- */

const sessionKey = (token) => 'session/' + createHash('sha256').update(token).digest('hex');

/**
 * A new session.
 *
 * The token goes to the browser; only its hash is stored. Someone who reads
 * the store cannot sign in with what they find there, which is the same
 * reason the password is not stored either.
 */
export async function startSession(accountId, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  const s = await store();
  await s.create(sessionKey(token), {
    accountId,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  return token;
}

/** The account a token stands for, or null. An expired session is removed
    as it is found, so the store does not fill up with dead ones. */
export async function sessionAccount(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const s = await store();
  const { value } = await s.read(sessionKey(token));
  if (!value) return null;
  if (!value.expiresAt || value.expiresAt < now) {
    await s.remove(sessionKey(token));
    return null;
  }
  return accountById(value.accountId);
}

export async function endSession(token) {
  if (typeof token !== 'string' || !token) return;
  const s = await store();
  await s.remove(sessionKey(token));
}

/**
 * Ends every session of an account, optionally sparing the one in hand.
 *
 * Changing a password has to do this, or the change protects nothing: whoever
 * was signed in with the old one stays signed in. The scan is affordable
 * because this runs on a password change or a deletion, not on every request.
 */
export async function endAllSessions(accountId, exceptToken = null) {
  const s = await store();
  const spare = exceptToken ? sessionKey(exceptToken) : null;
  let ended = 0;
  for (const key of await s.list('session/')) {
    if (key === spare) continue;
    const { value } = await s.read(key);
    if (value && value.accountId === accountId) {
      await s.remove(key);
      ended++;
    }
  }
  return ended;
}

/* --------------------------------------------------- changing and leaving --- */

/**
 * Changes a password, having checked the current one.
 *
 * The current password is required even though the caller already holds a
 * session: a cookie someone else picked up must not be enough to lock the
 * owner out of their own account.
 */
export async function changePassword(email, current, next, keepToken = null) {
  const account = await findAccount(email);
  if (!account) return { ok: false, reason: 'unknown' };
  if (!(await passwordMatches(current, account.password))) return { ok: false, reason: 'wrong' };

  const problem = passwordProblem(next, email);
  if (problem) return { ok: false, reason: 'password', message: problem };
  if (await passwordMatches(next, account.password)) {
    return { ok: false, reason: 'same', message: 'That is the password you already have.' };
  }

  const password = await hashPassword(next);
  await mutate(keyForEmail(email), (a) => (a ? { ...a, password, failures: 0, lockedUntil: 0 } : null));
  const ended = await endAllSessions(account.id, keepToken);
  return { ok: true, otherSessionsEnded: ended };
}

/**
 * Removes an account: the record, the id index, and every session.
 *
 * What it does NOT remove is the orders themselves. Those live at Stripe and
 * Swiss accounting law requires keeping them for ten years — the Privacy
 * Policy says so, and this is the line it draws. What goes is the ability to
 * sign in and the copy of the history shown here.
 */
export async function deleteAccount(email, password) {
  const account = await findAccount(email);
  if (!account) return { ok: false, reason: 'unknown' };
  if (!(await passwordMatches(password, account.password))) return { ok: false, reason: 'wrong' };

  const s = await store();
  await endAllSessions(account.id);
  await s.remove(keyForId(account.id));
  await s.remove(keyForEmail(account.email));
  return { ok: true };
}

/* --------------------------------------------------------------- cookies --- */

export const COOKIE = 'zuno_session';

export function readCookie(header, name = COOKIE) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

/**
 * HttpOnly so a script cannot read it; Secure so it never crosses plain
 * HTTP; SameSite=Lax so another site cannot make the browser send it along
 * with a request of their making, which is what stands in for a CSRF token
 * here.
 */
export const setCookie = (token) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`;

export const clearCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/* ---------------------------------------------------------------- orders --- */

/**
 * Files a paid order under an account.
 *
 * Only orders placed while signed in reach this, because the checkout puts
 * the account id in the session metadata. Matching by email address instead
 * would mean an account nobody verified could read a stranger's orders.
 */
export async function recordOrder(accountId, order) {
  if (!accountId || !order) return false;
  const account = await accountById(accountId);
  if (!account) return false;

  let added = false;
  await mutate(keyForEmail(account.email), (a) => {
    if (!a) return null;
    const orders = a.orders || [];
    if (orders.some((o) => o.session === order.session)) return null;   // a redelivery
    added = true;
    return { ...a, orders: [order, ...orders].slice(0, 200) };
  });
  return added;
}

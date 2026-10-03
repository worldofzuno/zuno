/**
 * Registering, signing in, signing out, and who am I.
 *
 *   POST /.netlify/functions/account
 *   { "action": "register" | "login" | "logout" | "me", ... }
 *
 * One endpoint rather than four files, because they share the cookie
 * handling and the rate limiting and would otherwise repeat both.
 *
 * Two answers are deliberately identical: a wrong password and an address
 * with no account. Telling them apart is a way to find out who shops here,
 * and the same reasoning makes `register` refuse to say that an address is
 * already taken — it answers as though it had worked and says to check the
 * inbox, which is also what it will genuinely do once mail is configured.
 */

import {
  createAccount, findAccount, passwordMatches, burnTime, lockedOut,
  noteFailure, noteSuccess, startSession, sessionAccount, endSession,
  publicAccount, readCookie, setCookie, clearCookie, looksLikeEmail, normaliseEmail,
  changePassword, deleteAccount,
} from './auth.mjs';
import { allow } from './fnf.mjs';
import { send } from './mailer.mjs';

const json = (status, obj, cookie) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    },
  });

/* One message for both failures. */
const WRONG = 'That email address and password do not match an account.';

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const ip = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || 'anonymous';
  const token = readCookie(req.headers.get('cookie'));

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }
  if (!body || typeof body !== 'object') return json(400, { error: 'body must be an object' });

  const action = String(body.action || '');

  /* `me` is cheap and gets asked on every page load, so it is not rated. The
     three that touch a password are. */
  if (action !== 'me' && !allow('account:' + ip)) {
    return json(429, { error: 'Too many attempts. Please wait a moment.' });
  }

  try {
    if (action === 'me') return await whoAmI(token);
    if (action === 'logout') return await signOut(token);
    if (action === 'register') return await signUp(body);
    if (action === 'login') return await signIn(body);
    if (action === 'password') return await changeOwnPassword(token, body);
    if (action === 'delete') return await deleteOwnAccount(token, body);
  } catch (e) {
    /* Never the message: it may name the store, the key, or the address. */
    console.error('account failed:', e && e.message);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
  return json(400, { error: 'unknown action' });
}

async function whoAmI(token) {
  const account = await sessionAccount(token);
  if (!account) return json(200, { signedIn: false });
  return json(200, { signedIn: true, account: publicAccount(account), orders: account.orders || [] });
}

async function signOut(token) {
  await endSession(token);
  return json(200, { signedIn: false }, clearCookie());
}

async function signUp(body) {
  const email = normaliseEmail(body.email);
  const made = await createAccount({ name: body.name, email, password: body.password });

  if (!made.ok && made.reason === 'password') {
    return json(400, { error: made.message, field: 'password' });
  }
  if (!made.ok && made.reason === 'email') {
    return json(400, { error: 'Please enter a valid email address.', field: 'email' });
  }
  if (!made.ok && made.reason === 'name') {
    return json(400, { error: 'Please enter your name.', field: 'name' });
  }

  if (!made.ok && made.reason === 'taken') {
    /* Not an error the visitor sees. Someone probing addresses learns
       nothing, and the person who really does own it gets a mail telling
       them the account already exists — which is the useful thing to say
       and the only safe place to say it. */
    await burnTime();
    const existing = await findAccount(email);
    if (existing) {
      await send({
        to: email,
        subject: 'Your ZUNO account',
        text: [
          'Someone tried to create a ZUNO account with this address.',
          '',
          'You already have one, so nothing has changed and no new account was made.',
          'If that was you, just sign in instead. If it was not, you can ignore this',
          'message — your account is untouched.',
          '',
          'ZUNO — info@worldofzuno.com',
        ].join('\n'),
      });
    }
    return json(200, { created: true, signedIn: false, checkInbox: true });
  }

  const token = await startSession(made.account.id);
  await send({
    to: made.account.email,
    subject: 'Welcome to ZUNO',
    text: [
      `Hello ${made.account.name},`,
      '',
      'Your ZUNO account is ready. You can see your orders any time at',
      'https://worldofzuno.com/#account',
      '',
      'ZUNO — info@worldofzuno.com',
    ].join('\n'),
  });
  return json(200, {
    created: true,
    signedIn: true,
    account: publicAccount(made.account),
    orders: [],
  }, setCookie(token));
}

/**
 * Both of these need the session AND the current password. The session says
 * which account; the password says it is really the owner at the keyboard.
 * A cookie someone else picked up is then not enough to lock the owner out
 * or to erase their account.
 */
async function changeOwnPassword(token, body) {
  const account = await sessionAccount(token);
  if (!account) return json(401, { error: 'Please sign in first.' });

  const r = await changePassword(account.email, body.current, body.next, token);
  if (!r.ok && r.reason === 'wrong') {
    return json(401, { error: 'That is not your current password.', field: 'current' });
  }
  if (!r.ok && (r.reason === 'password' || r.reason === 'same')) {
    return json(400, { error: r.message, field: 'next' });
  }
  if (!r.ok) return json(400, { error: 'That did not work.' });

  /* Still signed in here, signed out everywhere else. */
  return json(200, { changed: true, otherSessionsEnded: r.otherSessionsEnded });
}

async function deleteOwnAccount(token, body) {
  const account = await sessionAccount(token);
  if (!account) return json(401, { error: 'Please sign in first.' });

  const r = await deleteAccount(account.email, body.password);
  if (!r.ok && r.reason === 'wrong') {
    return json(401, { error: 'That is not your password.', field: 'password' });
  }
  if (!r.ok) return json(400, { error: 'That did not work.' });

  await send({
    to: account.email,
    subject: 'Your ZUNO account has been deleted',
    text: [
      `Hello ${account.name},`,
      '',
      'Your ZUNO account has been deleted, along with every session that was',
      'signed in to it. You can order again at any time without one.',
      '',
      'Your past orders themselves are not deleted: Swiss accounting law',
      'requires us to keep transaction records for ten years. What is gone is',
      'the account, the password and the order list shown on the website.',
      '',
      'ZUNO — info@worldofzuno.com',
    ].join('\n'),
  });

  return json(200, { deleted: true, signedIn: false }, clearCookie());
}

async function signIn(body) {
  const email = normaliseEmail(body.email);
  const password = body.password;

  if (!looksLikeEmail(email) || typeof password !== 'string' || !password) {
    await burnTime();
    return json(401, { error: WRONG });
  }

  const account = await findAccount(email);
  if (!account) {
    /* The same work as a real attempt, so the time taken does not say
       whether this address is a customer. */
    await burnTime();
    return json(401, { error: WRONG });
  }

  if (lockedOut(account)) {
    return json(429, {
      error: 'Too many attempts. Please wait a few minutes and try again.',
      locked: true,
    });
  }

  if (!(await passwordMatches(password, account.password))) {
    await noteFailure(email);
    return json(401, { error: WRONG });
  }

  await noteSuccess(email);
  const token = await startSession(account.id);
  return json(200, {
    signedIn: true,
    account: publicAccount(account),
    orders: account.orders || [],
  }, setCookie(token));
}

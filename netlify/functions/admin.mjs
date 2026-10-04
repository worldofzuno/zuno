/**
 * The back office: look up a gift card, issue one, void one, find or remove
 * an account, and take a backup.
 *
 *   POST /.netlify/functions/admin
 *   { "action": "login", "token": "…" }   -> sets an admin cookie
 *   { "action": "gift-find", "code": "ZG-…" }
 *
 * This exists because the alternative was reading Netlify Blobs by hand. The
 * first customer saying "my gift card does not work" needs an answer, and
 * guessing is not one.
 *
 * One door, one key: ADMIN_TOKEN. There is no account system behind this and
 * no roles — it is the shop owner or nobody. The token is compared in
 * constant time, a short one is refused outright rather than quietly
 * accepted, and what the browser then holds is a session cookie rather than
 * the token itself.
 *
 * Nothing here ever returns a password derivation, a customer's session, or
 * the admin token. The export is for a backup, so it carries balances and
 * ledgers; it must be treated as the money record it is.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { store } from './store.mjs';
import * as gift from './giftcard.mjs';
import {
  allAccounts, findAccount, endAllSessions, keyForEmail, keyForId,
  normaliseEmail, looksLikeEmail, readCookie,
} from './auth.mjs';
import { allow } from './fnf.mjs';

const COOKIE = 'zuno_admin';
const SESSION_HOURS = 12;

/** Short enough to guess is the same as no door at all. */
const MIN_TOKEN = 24;

const json = (status, obj, cookie) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      /* A back office has no business being indexed, framed or linked from. */
      'x-robots-tag': 'noindex, nofollow',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    },
  });

/* SameSite=Strict, not Lax: nothing should ever navigate into the back office
   from somewhere else and arrive signed in. */
const setCookie = (token) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
const clearCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const adminKey = (token) => 'adminsession/' + createHash('sha256').update(token).digest('hex');

/* --------------------------------------------------------------- the door */

export function tokenProblem() {
  const t = process.env.ADMIN_TOKEN;
  if (!t) return 'ADMIN_TOKEN is not set; the back office is closed.';
  if (t.length < MIN_TOKEN) return `ADMIN_TOKEN is shorter than ${MIN_TOKEN} characters; refusing to use it.`;
  return null;
}

/** Constant time over a fixed width, so neither the answer nor how long it
    took says how much of a guess was right. */
export function tokenMatches(given) {
  const want = process.env.ADMIN_TOKEN;
  if (!want || typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

async function startAdminSession(now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  const s = await store();
  await s.create(adminKey(token), {
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_HOURS * 3600 * 1000,
  });
  return token;
}

export async function isAdmin(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false;
  const s = await store();
  const { value } = await s.read(adminKey(token));
  if (!value) return false;
  if (!value.expiresAt || value.expiresAt < now) {
    await s.remove(adminKey(token));
    return false;
  }
  return true;
}

/* ------------------------------------------------------------- the actions */

const rappen = (n) => (n / 100).toFixed(2);

/** What a card looks like to whoever is packing or answering the phone. */
export function cardView(card, now = Date.now()) {
  const holds = gift.activeHolds(card, now);
  return {
    code: card.code,
    issued: card.issued,
    spent: gift.spent(card),
    held: Object.values(holds).reduce((t, h) => t + h.amount, 0),
    balance: gift.available(card, now),
    voided: Boolean(card.voided),
    voidReason: card.voidReason || null,
    createdAt: card.createdAt,
    buyer: card.buyer || null,
    livemode: card.livemode === true,
    issuedFor: card.issuedFor || null,
    spends: Object.entries(card.spends || {}).map(([session, v]) => ({ session, ...v })),
  };
}

export async function summary(now = Date.now()) {
  const cards = await gift.allCards();
  const accounts = await allAccounts();
  const outstanding = cards.reduce((t, c) => t + gift.available(c, now), 0);
  return {
    cards: {
      count: cards.length,
      issued: cards.reduce((t, c) => t + c.issued, 0),
      spent: cards.reduce((t, c) => t + gift.spent(c), 0),
      outstanding,
      voided: cards.filter((c) => c.voided).length,
    },
    accounts: {
      count: accounts.length,
      withOrders: accounts.filter((a) => (a.orders || []).length > 0).length,
    },
  };
}

/* ----------------------------------------------------------------- handler */

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }
  if (!body || typeof body !== 'object') return json(400, { error: 'body must be an object' });

  const problem = tokenProblem();
  if (problem) {
    console.error('admin:', problem);
    return json(503, { error: 'The back office is not configured.' });
  }

  const cookie = readCookie(req.headers.get('cookie'), COOKIE);
  const action = String(body.action || '');

  if (action === 'login') {
    /* The limit belongs on the door and nowhere else. Counting every action
       instead locks the owner out after three card lookups, which is both
       useless against guessing and a nuisance to the one person entitled to
       be here. */
    const ip = req.headers.get('x-nf-client-connection-ip')
      || req.headers.get('x-forwarded-for')
      || 'anonymous';
    if (!allow('admin:' + ip)) {
      return json(429, { error: 'Too many attempts. Please wait a moment.' });
    }
    if (!tokenMatches(body.token)) return json(401, { error: 'That is not the key.' });
    return json(200, { admin: true }, setCookie(await startAdminSession()));
  }
  if (action === 'logout') {
    if (cookie) { const s = await store(); await s.remove(adminKey(cookie)); }
    return json(200, { admin: false }, clearCookie());
  }
  if (action === 'me') return json(200, { admin: await isAdmin(cookie) });

  if (!(await isAdmin(cookie))) return json(401, { error: 'Please sign in first.' });

  try {
    return await act(action, body);
  } catch (e) {
    console.error('admin failed:', e && e.message);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}

async function act(action, body) {
  if (action === 'summary') return json(200, await summary());

  if (action === 'gift-find') {
    const card = await gift.load(body.code);
    if (!card) return json(404, { error: 'No gift card with that code.' });
    return json(200, { card: cardView(card) });
  }

  if (action === 'gift-list') {
    const cards = await gift.allCards();
    return json(200, { cards: cards.slice(0, 200).map((c) => cardView(c)) });
  }

  if (action === 'gift-issue') {
    const amount = Math.trunc(Number(body.amount));
    if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
      return json(400, { error: 'An amount from 1 to 100000 rappen, please.' });
    }
    const note = String(body.note || '').slice(0, 120) || 'issued by hand';
    const card = await gift.issue({
      amount,
      issuedFor: 'admin:' + note,
      livemode: process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') : false,
      buyer: null,
    });
    console.log(`[gift:issued-by-hand] ${card.code} ${rappen(amount)} — ${note}`);
    return json(200, { card: cardView(card) });
  }

  if (action === 'gift-void') {
    const found = await gift.setVoided(body.code, body.voided !== false, body.reason);
    if (!found) return json(404, { error: 'No gift card with that code.' });
    const card = await gift.load(body.code);
    console.log(`[gift:${card.voided ? 'voided' : 'restored'}] ${card.code}`);
    return json(200, { card: cardView(card) });
  }

  if (action === 'account-find') {
    const email = normaliseEmail(body.email);
    if (!looksLikeEmail(email)) return json(400, { error: 'That is not an email address.' });
    const a = await findAccount(email);
    if (!a) return json(404, { error: 'No account with that address.' });
    return json(200, { account: safeAccount(a) });
  }

  if (action === 'account-list') {
    const accounts = await allAccounts();
    return json(200, { accounts: accounts.slice(0, 200).map(safeAccount) });
  }

  if (action === 'account-signout') {
    const a = await findAccount(body.email);
    if (!a) return json(404, { error: 'No account with that address.' });
    const ended = await endAllSessions(a.id);
    return json(200, { ended });
  }

  if (action === 'account-delete') {
    const a = await findAccount(body.email);
    if (!a) return json(404, { error: 'No account with that address.' });
    /* The customer-facing path needs their password; here the key to the
       back office stands in for it. The orders stay at Stripe either way. */
    const s = await store();
    await endAllSessions(a.id);
    await s.remove(keyForId(a.id));
    await s.remove(keyForEmail(a.email));
    console.log(`[account:deleted-by-hand] ${a.id}`);
    return json(200, { deleted: true });
  }

  if (action === 'export') {
    const cards = await gift.allCards();
    const accounts = await allAccounts();
    return json(200, {
      takenAt: new Date().toISOString(),
      /* The whole ledger, not the view: a backup has to be able to put a
         balance back exactly as it stood, holds and all. */
      giftCards: cards,
      /* Password derivations are already stripped by allAccounts. A backup
         that could restore a login is a second place to steal one from. */
      accounts,
    });
  }

  return json(400, { error: 'unknown action' });
}

function safeAccount(a) {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    createdAt: a.createdAt,
    verified: a.verified === true,
    lockedUntil: a.lockedUntil || 0,
    failures: a.failures || 0,
    orders: (a.orders || []).map((o) => ({
      session: o.session, date: o.date, total: o.total, currency: o.currency,
    })),
  };
}

export async function resetAdminSessions() {
  const s = await store();
  for (const key of await s.list('adminsession/')) await s.remove(key);
}

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
import { store } from './lib/store.mjs';
import * as gift from './lib/giftcard.mjs';
import * as stock from './lib/stock.mjs';
import {
  allAccounts, findAccount, endAllSessions, keyForEmail, keyForId,
  normaliseEmail, looksLikeEmail, readCookie,
} from './lib/auth.mjs';
import { allow } from './lib/fnf.mjs';
import { send, mailLayout, mailHeading, mailText, mailLink, esc, PALETTE, siteUrl, fromAddress } from './lib/mailer.mjs';
import Stripe from 'stripe';

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
    stock: await stock.levels(now),
  };
}

/**
 * What a backup is, in one place.
 *
 * The button in the back office and the weekly job both call this, so the
 * file that arrives by mail is the same file the button hands over. Two
 * definitions of a money record is one too many.
 */
export async function takeBackup() {
  const cards = await gift.allCards();
  const accounts = await allAccounts();
  const rows = await Promise.all(stock.TRACKED.map((sku) => stock.read(sku)));
  return {
    takenAt: new Date().toISOString(),
    /* The whole ledger, not the view: a backup has to be able to put a
       balance back exactly as it stood, holds and all. */
    giftCards: cards,
    stock: rows.filter(Boolean),
    /* Password derivations are already stripped by allAccounts. A backup
       that could restore a login is a second place to steal one from. */
    accounts,
  };
}

/* ------------------------------------------------------------- fulfilment */

/**
 * Orders live at Stripe. What Stripe does not know is whether a parcel has
 * gone out, so that — and only that — is kept here, one small record per
 * order under `ship/<session id>`.
 *
 * Reading the list from Stripe rather than keeping our own copy means the
 * back office cannot drift out of step with what was actually paid for. The
 * cost is one API call per view, which is the right price.
 */
const shipKey = (session) => `ship/${session}`;

/* Handed in by the caller wherever it can be, the way build() takes it in
   create-checkout-session: a test should be able to answer for Stripe
   without owning the network. */
const stripe = (given) => {
  if (given) return given;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key);
};

/** The lines a session carries, as the checkout wrote them. */
function linesOf(session) {
  try {
    return JSON.parse((session.metadata || {}).lines || '[]')
      .map(([sku, qty, grind]) => ({ sku, qty, grind: grind || null }));
  } catch { return []; }
}

const SHIPPABLE = new Set(['castano-200g', 'castano-500g']);

/** What the back office shows for one order. */
export function orderView(session, shipped = null) {
  const lines = linesOf(session);
  const info = session.collected_information || {};
  const ship = info.shipping_details || session.shipping_details || null;
  const needsParcel = lines.some((l) => SHIPPABLE.has(l.sku));
  return {
    session: session.id,
    ref: session.id.slice(-8).toUpperCase(),
    at: session.created ? new Date(session.created * 1000).toISOString() : null,
    total: ((session.amount_total || 0) / 100).toFixed(2),
    currency: (session.currency || 'chf').toUpperCase(),
    email: (session.customer_details || {}).email || null,
    name: (ship && ship.name) || (session.customer_details || {}).name || null,
    address: ship ? ship.address : null,
    lines,
    needsParcel,
    livemode: session.livemode === true,
    shipped: shipped ? { at: shipped.at, carrier: shipped.carrier || null, tracking: shipped.tracking || null } : null,
  };
}

/** Recent paid orders, newest first, with what we know about despatch. */
export async function recentOrders(limit = 25, client = null) {
  const list = await stripe(client).checkout.sessions.list({ limit: Math.min(100, Math.max(1, limit)) });
  const paid = list.data.filter((x) => x.payment_status === 'paid');
  const s = await store();
  const out = [];
  for (const session of paid) {
    const { value } = await s.read(shipKey(session.id));
    out.push(orderView(session, value));
  }
  return out;
}

/* The one mail the shop sends by hand, so it is the one most worth making
   hard to get wrong: it refuses to go twice, and it refuses to go for an
   order that has nothing in a parcel. */
/**
 * Where a customer can follow the parcel, or null when we cannot say.
 *
 * Swiss Post publishes a deep link into Track & Trace that takes the
 * barcode as it is printed on the label, so a tracking number we already
 * have is a working link with no account and no API behind it. Only for
 * carriers we recognise: a link that guesses is worse than a number the
 * customer pastes into a search box themselves.
 *
 * https://www.swisspost.ch/post-startseite/post-privatkunden/post-versenden/post-versenden-track-and-trace.htm
 */
export function trackingUrl(carrier, tracking) {
  const code = String(tracking || '').trim();
  if (!code) return null;
  /* "Die Post", "Swiss Post", "Schweizerische Post", "post" — the one
     carrier this shop ships with. Anything else gets the plain number. */
  if (!/\bpost\b/i.test(String(carrier || ''))) return null;
  return `https://www.post.ch/swisspost-tracking?formattedParcelCodes=${encodeURIComponent(code)}`;
}

export function shippedMailHtml(order) {
  const P = PALETTE;
  const where = order.address ? [order.name, order.address.line1, order.address.line2,
    `${order.address.postal_code || ''} ${order.address.city || ''}`.trim(), order.address.country]
    .filter(Boolean).map(esc).join('<br>') : null;

  const url = order.shipped ? trackingUrl(order.shipped.carrier, order.shipped.tracking) : null;
  const number = order.shipped && order.shipped.tracking
    ? `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;letter-spacing:0.04em;">${esc(order.shipped.tracking)}</span>`
    : null;
  const track = number
    ? `        ${mailHeading('Tracking')}
        <p style="margin:0 0 4px;color:${P.ink};">${url ? mailLink(url, number) : number}</p>
        ${order.shipped.carrier ? mailText(esc(order.shipped.carrier), { dim: true }) : ''}`
    : null;

  return mailLayout({
    title: `Your ZUNO order ${esc(order.ref)} is on its way`,
    preheader: `Order ${esc(order.ref)} left us today.`,
    blocks: [
      `        <p style="margin:0 0 6px;font-size:19px;color:${P.ink};font-weight:600;">Your coffee is on its way.</p>
        <p style="margin:0;font-size:14px;color:${P.dim};">Order ${esc(order.ref)}</p>`,
      `        ${mailHeading('On its way to')}
        ${mailText(where || '&mdash;', { top: false })}`,
      track,
      /* The same heading the order confirmation uses over the same promise.
         It also closes a hole: without it the block floats a full block's
         gap below the carrier with nothing to attach itself to. */
      `        ${mailHeading('When')}
        ${mailText('Delivery inside Switzerland and Liechtenstein takes 1&ndash;3 business days from today.', { top: false })}
        ${mailText(`Something not right? Reply to this mail, or see ${mailLink(`${siteUrl()}/#shipping`, 'shipping &amp; returns')}.`, { dim: true })}`,
    ],
  });
}

export function shippedMailText(order) {
  const where = order.address ? [order.name, order.address.line1, order.address.line2,
    `${order.address.postal_code || ''} ${order.address.city || ''}`.trim(), order.address.country]
    .filter(Boolean).join('\n') : '—';
  return [
    'Your coffee is on its way.',
    '',
    `Order ${order.ref}`,
    '',
    'On its way to:',
    where,
    order.shipped && order.shipped.tracking
      ? `\nTracking: ${order.shipped.tracking}${order.shipped.carrier ? ` (${order.shipped.carrier})` : ''}`
      : null,
    /* The link on its own line: in plain text an address inside a sentence
       is one a mail client wraps in the middle and nobody can click. */
    order.shipped ? trackingUrl(order.shipped.carrier, order.shipped.tracking) : null,
    '',
    'Delivery inside Switzerland and Liechtenstein takes 1-3 business days',
    'from today. Something not right? Just reply to this mail.',
    '',
    `ZUNO — ${fromAddress()}`,
  ].filter((l) => l !== null).join('\n');
}

/**
 * Marks an order despatched and tells the customer.
 *
 * The record is written before the mail goes, and written with onlyIfNew
 * semantics: a second press finds it already there and stops, so the
 * customer cannot be told twice that the same parcel left.
 */
export async function markShipped(sessionId, { carrier = null, tracking = null, now = Date.now(), client = null } = {}) {
  const session = await stripe(client).checkout.sessions.retrieve(sessionId);
  if (!session || session.payment_status !== 'paid') return { ok: false, reason: 'not-paid' };

  const s = await store();
  const existing = await s.read(shipKey(sessionId));
  if (existing.value) return { ok: false, reason: 'already', shipped: existing.value };

  const record = {
    at: new Date(now).toISOString(),
    carrier: carrier ? String(carrier).slice(0, 60) : null,
    tracking: tracking ? String(tracking).slice(0, 80) : null,
  };
  const written = await s.create(shipKey(sessionId), record);
  if (!written) {
    const again = await s.read(shipKey(sessionId));
    return { ok: false, reason: 'already', shipped: again.value };
  }

  const order = orderView(session, record);
  if (!order.needsParcel) {
    /* A gift card has no parcel. The record stands so the list stops
       showing it as outstanding, but nobody is told a box is coming. */
    console.log(`[order:shipped-nothing] ${order.ref}`);
    return { ok: true, order, mailed: false, reason: 'nothing-to-ship' };
  }

  let mailed = false;
  if (order.email) {
    const r = await send({
      to: order.email,
      subject: `Your ZUNO order ${order.ref} is on its way`,
      text: shippedMailText(order),
      html: shippedMailHtml(order),
    });
    mailed = r.sent;
    if (!r.sent) console.error(`[order:shipped-mail-unsent] ${order.ref}: ${r.error}`);
  }
  console.log(`[order:shipped] ${order.ref}${record.tracking ? ' ' + record.tracking : ''}`);
  return { ok: true, order, mailed };
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

  if (action === 'stock-set') {
    /* null clears the limit and the size goes back to unlimited — which is
       what every size is until someone sets a number. */
    const qty = body.qty === null || body.qty === '' ? null : body.qty;
    const r = await stock.setQty(body.sku, qty);
    if (!r.ok) {
      return json(400, {
        error: r.reason === 'unknown-sku'
          ? 'That is not a size this shop stocks.'
          : 'A whole number from 0 to 100000, or empty for no limit.',
      });
    }
    console.log(`[stock:set] ${body.sku} = ${r.qty === null ? 'unlimited' : r.qty}`);
    return json(200, { sku: body.sku, qty: r.qty, levels: await stock.levels() });
  }

  if (action === 'orders-list') {
    const orders = await recentOrders(Number(body.limit) || 25);
    return json(200, { orders });
  }

  if (action === 'order-ship') {
    const id = typeof body.session === 'string' ? body.session : '';
    if (!id.startsWith('cs_')) return json(400, { error: 'That is not an order.' });
    const r = await markShipped(id, { carrier: body.carrier, tracking: body.tracking });
    if (!r.ok) {
      return json(r.reason === 'already' ? 409 : 400, {
        error: r.reason === 'already'
          ? 'That order is already marked as sent — the customer has been told once.'
          : 'That order is not paid.',
        shipped: r.shipped || null,
      });
    }
    return json(200, { order: r.order, mailed: r.mailed, reason: r.reason || null });
  }

  if (action === 'export') return json(200, await takeBackup());

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

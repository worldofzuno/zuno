/**
 * Gift cards: stored value, bought in the shop and spent in it.
 *
 * A gift card is not a discount. A discount changes what something costs; a
 * gift card is money that has already been paid, waiting to be used. That
 * difference decides nearly everything here — the balance is a ledger rather
 * than a percentage, it survives being partly spent, and it is allowed on top
 * of a voucher price, because paying with your own money is not a second
 * reduction.
 *
 * Amounts are whole rappen throughout. No float ever touches a balance.
 *
 * The three operations that matter are hold, settle and release, and they
 * exist because a checkout is not instant. The customer leaves for Stripe and
 * may pay, may wander off, may come back an hour later with TWINT. Between
 * those moments the money must be neither spendable twice nor lost:
 *
 *   hold     at session creation — the amount stops being available
 *   settle   when Stripe says it was paid — the hold becomes a spend
 *   release  when the session expires or is cancelled — the hold goes back
 *
 * A hold that nobody ever settles or releases stops counting after
 * HOLD_TTL_MS, so a webhook that never arrives cannot freeze a balance for
 * good.
 */

import { randomInt } from 'node:crypto';
import { mutate, store } from './store.mjs';

/* Crockford's alphabet without the characters people misread: no 0 or O, no
   1, I or L. A code gets read off a screen and typed on a phone, often by
   someone who was given it verbally. Thirty-one characters rather than a
   round thirty-two — randomInt is unbiased over any range, so there is
   nothing to gain by padding it back to a power of two. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const BODY_LEN = 12;
const PREFIX = 'ZG';

/** Stripe sessions expire after 24 hours; a little past that is safe. */
export const HOLD_TTL_MS = 26 * 60 * 60 * 1000;

/* ----------------------------------------------------------- the code --- */

/** Everything but letters and digits goes, and the rest is uppercased. */
export function normalise(input) {
  return String(input == null ? '' : input).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** ZGABCD… -> ZG-ABCD-EFGH-JKLM, which is what a person reads and types. */
export function format(stripped) {
  const s = normalise(stripped);
  const body = s.slice(PREFIX.length);
  return [PREFIX, body.slice(0, 4), body.slice(4, 8), body.slice(8, 12)]
    .filter(Boolean)
    .join('-');
}

/** Whether a string could be one of our codes at all. */
export function looksLikeCode(input) {
  const s = normalise(input);
  if (s.length !== PREFIX.length + BODY_LEN) return false;
  if (!s.startsWith(PREFIX)) return false;
  return [...s.slice(PREFIX.length)].every((c) => ALPHABET.includes(c));
}

/**
 * A fresh code. randomInt is the cryptographic generator and is free of the
 * modulo bias a `% 32` on a random byte would introduce — which matters,
 * because a biased alphabet is a smaller search space.
 */
export function newCode() {
  let body = '';
  for (let i = 0; i < BODY_LEN; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return format(PREFIX + body);
}

export const keyFor = (code) => `gift/${normalise(code)}`;

/* ------------------------------------------------------------ the card --- */

const sum = (rows) => Object.values(rows || {}).reduce((t, r) => t + (r.amount || 0), 0);

export const spent = (card) => sum(card && card.spends);

/** Holds still standing. An old one is ignored rather than deleted, so the
    record keeps saying what happened. */
export function activeHolds(card, now = Date.now()) {
  const out = {};
  for (const [id, h] of Object.entries((card && card.holds) || {})) {
    if (now - h.at < HOLD_TTL_MS) out[id] = h;
  }
  return out;
}

/** What could be spent right now. Never below zero, whatever the ledger says.
    A voided card is worth nothing without rewriting its history, so the
    record still shows what it was and what was done with it. */
export function available(card, now = Date.now()) {
  if (!card) return 0;
  if (card.voided) return 0;
  return Math.max(0, card.issued - spent(card) - sum(activeHolds(card, now)));
}

/** Stops a card being spent — a code that leaked, or one issued by mistake.
    Reversible, because the balance was never erased. */
export async function setVoided(code, voided, reason = null, now = Date.now()) {
  let found = false;
  await mutate(keyFor(code), (card) => {
    if (!card) return null;
    found = true;
    if (Boolean(card.voided) === Boolean(voided)) return null;
    return {
      ...card,
      voided: Boolean(voided),
      voidedAt: voided ? new Date(now).toISOString() : null,
      voidReason: voided ? (reason || null) : null,
    };
  });
  return found;
}

/** Every card, for the admin view and the backup. */
export async function allCards() {
  const s = await store();
  const out = [];
  for (const key of await s.list('gift/')) {
    const { value } = await s.read(key);
    if (value) out.push(value);
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** What a customer may see: never the internal ledger. */
export function publicView(card, now = Date.now()) {
  return {
    code: card.code,
    currency: card.currency.toUpperCase(),
    balance: available(card, now),
    issued: card.issued,
  };
}

/* ------------------------------------------------------------- issuing --- */

/**
 * Creates a card for an amount that has already been paid.
 *
 * `issuedFor` is the Checkout Session line it was bought with, and it is also
 * what makes this idempotent: Stripe can deliver the same event twice, and
 * the second delivery must not mint a second card. The caller looks for an
 * existing card with the same `issuedFor` before calling.
 */
export async function issue({ amount, issuedFor, livemode = false, buyer = null, now = Date.now() }) {
  const value = Math.trunc(amount);
  if (!Number.isInteger(value) || value <= 0) throw new Error('a gift card needs a positive amount');

  /* A collision is improbable — 32^12 is about 1.15e18 — but `onlyIfNew`
     makes it harmless rather than merely unlikely. */
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const card = {
      code,
      currency: 'chf',
      issued: value,
      holds: {},
      spends: {},
      createdAt: new Date(now).toISOString(),
      issuedFor,
      buyer,
      livemode,
    };
    const s = await store();
    if (await s.create(keyFor(code), card)) return card;
  }
  throw new Error('could not mint a gift card code');
}

export async function load(code) {
  if (!looksLikeCode(code)) return null;
  const s = await store();
  const { value } = await s.read(keyFor(code));
  return value;
}

/** Whether this session already minted a card, so a replayed event does not
    mint a second one. */
export async function cardFor(issuedFor) {
  const s = await store();
  for (const key of await s.list('gift/')) {
    const { value } = await s.read(key);
    if (value && value.issuedFor === issuedFor) return value;
  }
  return null;
}

/* ------------------------------------------------------- hold / settle --- */

/**
 * Sets aside up to `wanted` rappen for a checkout session.
 *
 * Returns what was actually held, which is the smaller of what was asked for
 * and what the card has. A caller must use the returned amount and not the
 * one it asked for.
 */
export async function hold(code, sessionId, wanted, now = Date.now()) {
  if (!looksLikeCode(code)) return { ok: false, reason: 'unknown', amount: 0 };
  const want = Math.trunc(wanted);
  if (!Number.isInteger(want) || want <= 0) return { ok: false, reason: 'nothing-to-hold', amount: 0 };

  let held = 0;
  let missing = false;
  const res = await mutate(keyFor(code), (card) => {
    if (!card) { missing = true; return null; }

    /* The same session asking again gets the same hold rather than a second
       one — a retried request must not debit twice. */
    const existing = (card.holds || {})[sessionId];
    if (existing && now - existing.at < HOLD_TTL_MS) { held = existing.amount; return null; }

    const canHold = Math.min(want, available(card, now));
    if (canHold <= 0) { held = 0; return null; }
    held = canHold;
    return { ...card, holds: { ...activeHolds(card, now), [sessionId]: { amount: canHold, at: now } } };
  });

  if (missing) return { ok: false, reason: 'unknown', amount: 0 };
  if (held <= 0) return { ok: false, reason: 'empty', amount: 0 };
  return { ok: true, amount: held, fresh: res.ok };
}

/**
 * Turns a hold into a spend, because Stripe says the payment went through.
 *
 * The spend is recorded even when the hold has gone — if a hold expired
 * before a slow payment landed, the money was still taken, and a ledger that
 * quietly forgets that is worse than one that shows an overdraft.
 */
export async function settle(code, sessionId, fallbackAmount = 0, now = Date.now()) {
  let outcome = 'none';
  let amount = 0;

  await mutate(keyFor(code), (card) => {
    if (!card) { outcome = 'unknown'; return null; }
    if ((card.spends || {})[sessionId]) {
      outcome = 'already';
      amount = card.spends[sessionId].amount;
      return null;
    }
    const h = (card.holds || {})[sessionId];
    amount = h ? h.amount : Math.trunc(fallbackAmount);
    if (amount <= 0) { outcome = 'nothing'; return null; }

    /* A hold that has aged past its lifetime stopped reserving anything, so
       between then and now the balance was spendable again and the card may
       end up overdrawn. The spend is recorded either way — the money was
       taken — but it is recorded as the exception it is. */
    const live = h && now - h.at < HOLD_TTL_MS;
    if (live) {
      outcome = 'settled';
    } else {
      console.error(
        `giftcard: ${card.code} settled ${amount} for ${sessionId} with no live hold` +
        `${h ? ' (the hold had expired)' : ''}`
      );
      outcome = 'settled-late';
    }
    const holds = { ...(card.holds || {}) };
    delete holds[sessionId];
    return { ...card, holds, spends: { ...(card.spends || {}), [sessionId]: { amount, at: now } } };
  });

  return { outcome, amount };
}

/** Gives a hold back, because the session expired or was abandoned. */
export async function release(code, sessionId) {
  let outcome = 'none';
  await mutate(keyFor(code), (card) => {
    if (!card) { outcome = 'unknown'; return null; }
    if ((card.spends || {})[sessionId]) { outcome = 'already-spent'; return null; }
    if (!(card.holds || {})[sessionId]) { outcome = 'no-hold'; return null; }
    const holds = { ...card.holds };
    delete holds[sessionId];
    outcome = 'released';
    return { ...card, holds };
  });
  return outcome;
}

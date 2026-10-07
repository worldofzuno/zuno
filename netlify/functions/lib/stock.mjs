/**
 * How many bags there are.
 *
 * Opt-in per size: a size with no record has no limit, so a shop that never
 * sets a number behaves exactly as it did before this file existed. That is
 * the important default — an inventory nobody maintains is not a safeguard,
 * it is a way to refuse orders you could have filled.
 *
 * Counting follows the gift card ledger, for the same reason: a checkout is
 * not instant, and the last bag must not be sold twice while someone is
 * still typing their card number.
 *
 *   hold     at session creation — the bags stop being available
 *   settle   when Stripe says it was paid — they leave the shelf
 *   release  when the session expires or fails — they come back
 *
 * A hold nobody resolves stops counting after HOLD_TTL_MS, so a webhook that
 * never arrives cannot strand stock for good.
 */

import { mutate, store } from './store.mjs';

/** Only things that go in a parcel. A gift card has no shelf. */
export const TRACKED = ['castano-200g', 'castano-500g'];

/* Five minutes past the 30 the Stripe session lives for, the same way the
   gift card ledger does: long enough that a payment in the last minute
   still finds its hold, short enough that abandoned carts cannot keep the
   shelf. At a day, six of them closed the shop. */
export const HOLD_TTL_MS = 35 * 60 * 1000;

export const keyFor = (sku) => `stock/${sku}`;

const sum = (rows) => Object.values(rows || {}).reduce((t, r) => t + (r.qty || 0), 0);

export function activeHolds(record, now = Date.now()) {
  const out = {};
  for (const [ref, h] of Object.entries((record && record.holds) || {})) {
    if (now - h.at < HOLD_TTL_MS) out[ref] = h;
  }
  return out;
}

/** Bags that could be sold right now. `null` means no limit is set. */
export function availableQty(record, now = Date.now()) {
  if (!record || typeof record.qty !== 'number') return null;
  return Math.max(0, record.qty - sum(activeHolds(record, now)));
}

export async function read(sku) {
  if (!TRACKED.includes(sku)) return null;
  const s = await store();
  const { value } = await s.read(keyFor(sku));
  return value;
}

/**
 * What the shop may sell, per size.
 *
 * @returns {Record<string, number|null>} null where no limit is set
 */
export async function levels(now = Date.now()) {
  const out = {};
  for (const sku of TRACKED) out[sku] = availableQty(await read(sku), now);
  return out;
}

/** Sets or clears a limit. `null` removes it, and the size is unlimited again. */
export async function setQty(sku, qty, now = Date.now()) {
  if (!TRACKED.includes(sku)) return { ok: false, reason: 'unknown-sku' };

  if (qty === null) {
    const s = await store();
    await s.remove(keyFor(sku));
    return { ok: true, qty: null };
  }

  /* A number, or a whole number typed as a string. Nothing else: Number([])
     is 0 and Number('') is 0, so a loose coercion quietly reads an empty
     array or an empty field as "sold out".
     Checked before truncating, too — "12" is fine, 1.5 bags is a typo, and
     rounding it to 1 would store a count nobody meant and nobody would
     notice. Same rule as the cart's quantities. */
  const given = typeof qty === 'string' ? qty.trim() : qty;
  const n = (typeof given === 'number' || (typeof given === 'string' && given !== ''))
    ? Number(given)
    : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, reason: 'range' };

  await mutate(keyFor(sku), (cur) => ({
    sku,
    qty: n,
    holds: cur ? activeHolds(cur, now) : {},
    updatedAt: new Date(now).toISOString(),
  }));
  return { ok: true, qty: n };
}

/**
 * Sets bags aside for a checkout.
 *
 * All or nothing per line: half an order is not an order. A size with no
 * limit holds nothing and reports ok, because there is nothing to run out of.
 */
export async function hold(sku, ref, wanted, now = Date.now()) {
  if (!TRACKED.includes(sku)) return { ok: true, held: 0, unlimited: true };
  const want = Math.trunc(wanted);
  if (!Number.isInteger(want) || want <= 0) return { ok: false, reason: 'nothing-to-hold', held: 0 };

  let outcome = { ok: true, held: 0, unlimited: true };
  await mutate(keyFor(sku), (cur) => {
    if (!cur || typeof cur.qty !== 'number') return null;        // no limit set

    const live = activeHolds(cur, now);
    const existing = live[ref];
    if (existing) { outcome = { ok: true, held: existing.qty, unlimited: false }; return null; }

    const free = Math.max(0, cur.qty - sum(live));
    if (free < want) {
      outcome = { ok: false, reason: 'short', held: 0, available: free, unlimited: false };
      return null;
    }
    outcome = { ok: true, held: want, unlimited: false };
    return { ...cur, holds: { ...live, [ref]: { qty: want, at: now } } };
  });
  return outcome;
}

/**
 * The bags left the shelf. Recorded even if the hold had expired: the goods
 * are gone either way, and a count that quietly forgets is worse than one
 * showing zero.
 *
 * `order` is the Checkout Session the sale belongs to. Without it the
 * ledger records only `ref`, the internal hold reference, which answers
 * nothing when somebody asks which order took the last bag — the gift card
 * ledger had the same hole and it was worth closing there too. Optional,
 * because a settle with no session is still a sale that happened.
 */
export async function settle(sku, ref, fallbackQty = 0, now = Date.now(), order = null) {
  let outcome = 'none';
  await mutate(keyFor(sku), (cur) => {
    if (!cur || typeof cur.qty !== 'number') { outcome = 'untracked'; return null; }
    if ((cur.sold || {})[ref]) { outcome = 'already'; return null; }

    const h = (cur.holds || {})[ref];
    const qty = h ? h.qty : Math.trunc(fallbackQty);
    if (qty <= 0) { outcome = 'nothing'; return null; }

    const live = h && now - h.at < HOLD_TTL_MS;
    if (!live) {
      console.error(`stock: ${sku} settled ${qty} for ${ref} with no live hold`);
      outcome = 'settled-late';
    } else {
      outcome = 'settled';
    }
    const holds = { ...(cur.holds || {}) };
    delete holds[ref];
    return {
      ...cur,
      qty: Math.max(0, cur.qty - qty),
      holds,
      sold: {
        ...(cur.sold || {}),
        /* `order` only when there is one, so an entry without it reads as
           absent rather than as an order called null. */
        [ref]: { qty, at: now, ...(typeof order === 'string' && order ? { order } : {}) },
      },
      updatedAt: new Date(now).toISOString(),
    };
  });
  return outcome;
}

/**
 * Puts the bags back on the shelf, because the order was refunded.
 *
 * The goods are presumed to be coming back; a refund for something kept is
 * a decision somebody makes by hand afterwards, by typing a new number on
 * the Stock card. Like its opposite it is recorded rather than erased, and
 * it is idempotent, because Stripe redelivers.
 */
export async function unsettle(sku, ref, reason = 'refunded', now = Date.now()) {
  let outcome = 'none';
  let qty = 0;

  await mutate(keyFor(sku), (cur) => {
    if (!cur || typeof cur.qty !== 'number') { outcome = 'untracked'; return null; }
    const sale = (cur.sold || {})[ref];
    if (!sale) { outcome = 'no-sale'; return null; }
    if (sale.reversed) { outcome = 'already'; qty = sale.qty; return null; }

    qty = sale.qty;
    outcome = 'returned';
    return {
      ...cur,
      qty: cur.qty + qty,
      sold: { ...cur.sold, [ref]: { ...sale, reversed: { at: now, reason } } },
      updatedAt: new Date(now).toISOString(),
    };
  });

  return { outcome, qty };
}

export async function unsettleCart(lines, ref, reason = 'refunded', now = Date.now()) {
  const out = {};
  for (const line of lines) {
    if (!TRACKED.includes(line.sku)) continue;
    out[line.sku] = await unsettle(line.sku, ref, reason, now);
  }
  return out;
}

export async function release(sku, ref) {
  let outcome = 'none';
  await mutate(keyFor(sku), (cur) => {
    if (!cur) { outcome = 'untracked'; return null; }
    if ((cur.sold || {})[ref]) { outcome = 'already-sold'; return null; }
    if (!(cur.holds || {})[ref]) { outcome = 'no-hold'; return null; }
    const holds = { ...cur.holds };
    delete holds[ref];
    outcome = 'released';
    return { ...cur, holds };
  });
  return outcome;
}

/* ------------------------------------------------------- whole-cart moves */

/** Holds every tracked line of a cart, or none of them. */
export async function holdCart(lines, ref, now = Date.now()) {
  const taken = [];
  for (const line of lines) {
    if (!TRACKED.includes(line.sku)) continue;
    const r = await hold(line.sku, ref, line.qty, now);
    if (!r.ok) {
      for (const sku of taken) await release(sku, ref);
      return { ok: false, sku: line.sku, available: r.available || 0 };
    }
    if (!r.unlimited) taken.push(line.sku);
  }
  return { ok: true, held: taken };
}

export async function settleCart(lines, ref, now = Date.now(), order = null) {
  const out = {};
  for (const line of lines) {
    if (!TRACKED.includes(line.sku)) continue;
    out[line.sku] = await settle(line.sku, ref, line.qty, now, order);
  }
  return out;
}

export async function releaseCart(lines, ref) {
  for (const line of lines) {
    if (!TRACKED.includes(line.sku)) continue;
    await release(line.sku, ref);
  }
}

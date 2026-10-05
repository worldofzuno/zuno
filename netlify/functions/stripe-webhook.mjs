/**
 * Receives Stripe's notifications about a checkout.
 *
 * The other function in this folder talks to Stripe. This one listens. Stripe
 * calls it when a payment resolves, which is the only account of an order
 * that can be trusted: the browser redirect to the success page is a wish,
 * not a fact. With TWINT enabled the customer leaves the browser for the
 * TWINT app and has to come back, so "paid but never returned" stopped being
 * a rare case the day that went live.
 *
 *   POST /.netlify/functions/stripe-webhook
 *   stripe-signature: t=...,v1=...
 *
 * Every request is rejected unless it carries a signature Stripe could have
 * produced. Without that the endpoint is a public form for inventing orders.
 */

import Stripe from 'stripe';
import * as gift from './lib/giftcard.mjs';
import { store } from './lib/store.mjs';
import { send, alarm, shopInbox, mailLayout, mailHeading, mailText, mailLink, esc, PALETTE, siteUrl, fromAddress } from './lib/mailer.mjs';
import { recordOrder } from './lib/auth.mjs';
import * as stock from './lib/stock.mjs';

/* ------------------------------------------------------------------ config */

/**
 * Where a finished order is sent. Any service that accepts a JSON POST works
 * — an email relay, an automation tool, a spreadsheet endpoint.
 *
 * [PLACEHOLDER: notification endpoint — leave unset until you have chosen one]
 *
 * Unset is a supported state, not a broken one: the order is still written to
 * the function log, where it can be read and replayed. What it is not is a
 * message in anyone's inbox, so this file does not pretend otherwise.
 *
 * Read per call rather than once at import, so changing the variable takes
 * effect on the next invocation instead of the next cold start.
 */
const notifyUrl = () => process.env.ORDER_NOTIFY_URL;

/** Events worth acting on. Everything else is acknowledged and dropped. */
const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

/* ------------------------------------------------------- pure, and tested */

const rappen = (n) => (n == null ? null : (n / 100).toFixed(2));

/**
 * Everything needed to pack a parcel, and nothing else.
 *
 * The grind rides in metadata rather than in the price, because it does not
 * change what the order costs — but it does change what goes in the bag, so
 * it has to survive as far as whoever fills it.
 */
export function orderFrom(session) {
  const meta = session.metadata || {};
  let grinds = [];
  try {
    grinds = JSON.parse(meta.lines || '[]');
  } catch {
    /* metadata is a string field; a malformed one must not lose the order */
  }
  const grindFor = (sku) => (grinds.find((g) => g[0] === sku) || [])[2] || null;

  const items = (session.line_items?.data || []).map((li) => {
    const sku = li.price?.product?.metadata?.sku || null;
    return {
      sku,
      name: li.description || li.price?.product?.name || 'unknown',
      qty: li.quantity,
      grind: sku ? grindFor(sku) : null,
      amount: rappen(li.amount_total),
    };
  });

  const d = session.customer_details || {};
  const ship = session.collected_information?.shipping_details
    || session.shipping_details
    || {};

  return {
    session: session.id,
    livemode: session.livemode === true,
    paid: session.payment_status === 'paid',
    currency: (session.currency || '').toUpperCase(),
    subtotal: rappen(session.amount_subtotal),
    discount: rappen(session.total_details?.amount_discount),
    shipping: rappen(session.total_details?.amount_shipping),
    total: rappen(session.amount_total),
    email: d.email || null,
    name: ship.name || d.name || null,
    address: ship.address || d.address || null,
    /* A Family & Friends order is charged from different Prices rather than
       discounted, so `discount` reads 0.00 and nothing else would say why the
       total is low. The code is what explains it to whoever reads the books. */
    fnfCode: meta.fnf_code || null,
    items,
  };
}

/** One line per order, so the log is skimmable without a parser. */
export function summarise(order) {
  const what = order.items
    .map((i) => `${i.qty}x ${i.name}${i.grind ? ` (${i.grind})` : ''}`)
    .join(', ');
  const where = order.address
    ? `${order.name || ''} ${order.address.postal_code || ''} ${order.address.city || ''}`.trim()
    : 'no address';
  const tag = order.fnfCode ? ` — F&F ${order.fnfCode}` : '';
  return `${order.currency} ${order.total} — ${what} — ${where} — ${order.email || 'no email'}${tag}`;
}

/* ------------------------------------------------------------ side effects */

/**
 * Stripe retries a delivery it did not get a 2xx for, and can send the same
 * event twice even when it did. This catches the common case — a retry
 * reaching an instance that is still warm — and nothing more: a cold start
 * or a second instance has an empty set. Real deduplication needs somewhere
 * to write, which this function deliberately does not have yet, so anything
 * downstream should treat a repeated session id as the same order.
 */
const seen = new Set();
function firstTime(id) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value);
  return true;
}

async function notify(kind, order) {
  /* The log is the floor, not the ceiling: it happens whether or not a
     notification endpoint is configured, so an order is never only in a
     request that may have failed. */
  console.log(`[order:${kind}] ${summarise(order)} ${JSON.stringify(order)}`);
  const url = notifyUrl();
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, order }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    /* A notification that fails must not fail the webhook. Returning non-2xx
       would make Stripe retry the whole event, and the order is already in
       the log above. */
    console.error(`[order:notify-failed] ${order.session}: ${e && e.message}`);
  }
}

/* -------------------------------------------------------------- gift cards */

const giftMeta = (session) => {
  const m = session.metadata || {};
  return m.gift_code && m.gift_ref
    ? { code: m.gift_code, ref: m.gift_ref, hold: Number(m.gift_hold) || 0 }
    : null;
};

/** The payment went through, so the hold becomes a spend. */
async function settleGift(session) {
  const g = giftMeta(session);
  if (!g) return null;
  try {
    /* The session id goes into the ledger beside the amount: the entry is
       keyed by the hold reference, which answers nothing when a customer
       asks which order their balance went to. */
    const r = await gift.settle(g.code, g.ref, g.hold, Date.now(), session.id);
    console.log(`[gift:${r.outcome}] ${g.code} ${r.amount} rappen for ${session.id}`);
    return { code: g.code, amount: r.amount, outcome: r.outcome };
  } catch (e) {
    /* Thrown means the balance may not have been debited. Stripe retries a
       non-2xx, and settle is idempotent, so letting this escape is the right
       way to get a second attempt. */
    console.error(`[gift:settle-failed] ${g.code} for ${session.id}: ${e && e.message}`);
    throw e;
  }
}

/** The session died, so whatever it reserved is spendable again. */
async function releaseGift(session) {
  const g = giftMeta(session);
  if (!g) return null;
  try {
    const outcome = await gift.release(g.code, g.ref);
    console.log(`[gift:${outcome}] ${g.code} for ${session.id}`);
    return outcome;
  } catch (e) {
    /* A hold that is not released here expires by itself within the day, so
       this is worth reporting and not worth a redelivery. */
    console.error(`[gift:release-failed] ${g.code} for ${session.id}: ${e && e.message}`);
    return null;
  }
}

/** Was this line a gift card rather than coffee? */
const isGiftLine = (li) => (li.price?.product?.metadata?.kind) === 'giftcard';

/**
 * Splits what was paid for one line across the cards it bought, to the
 * rappen. The remainder goes to the first card rather than being dropped —
 * three cards out of CHF 21.25 are 7.09, 7.08 and 7.08, and the customer
 * paid for all of it.
 */
export function splitAmount(total, count) {
  const each = Math.trunc(total / count);
  const rest = total - each * count;
  return Array.from({ length: count }, (_, i) => each + (i === 0 ? rest : 0));
}

/**
 * Mints the cards this order bought.
 *
 * The amount is what was actually paid for the line, not the sticker price.
 * If a promotion code ever reduces a gift card, the credit is reduced with
 * it — otherwise a discount on money would be a way to buy francs cheaply.
 *
 * Minting twice would be making money, so a marker in the store is claimed
 * first: whoever creates it does the work, everyone else reads the result.
 */
async function issueGifts(session, order) {
  const lines = (session.line_items?.data || []).filter(isGiftLine);
  if (!lines.length) return [];

  const key = `issued/${session.id}`;
  const s = await store();
  const claimed = await s.create(key, { at: new Date().toISOString(), codes: [], done: false });
  if (!claimed) {
    const { value } = await s.read(key);
    const codes = (value && value.codes) || [];
    if (!value || value.done !== true) {
      await alarm('gift card may not have been issued',
        `${session.id} was claimed but never finished; ${codes.length} code(s) exist`);
    }
    return codes;
  }

  const minted = [];
  try {
    for (const li of lines) {
      for (const amount of splitAmount(li.amount_total, li.quantity || 1)) {
        if (amount <= 0) continue;
        const card = await gift.issue({
          amount,
          issuedFor: session.id,
          livemode: session.livemode === true,
          buyer: order.email || null,
        });
        minted.push({ code: card.code, amount });
      }
    }
    await s.update(key, { at: new Date().toISOString(), codes: minted, done: true },
      (await s.read(key)).etag);
    console.log(`[gift:issued] ${session.id} ${minted.map((m) => m.code).join(', ')}`);
  } catch (e) {
    /* Loud, because the customer has paid for a card that may not exist,
       and nothing retries this: the claim key is already taken, so a
       redelivery would find it claimed and mint nothing. The codes that did
       get minted are in the store. */
    await alarm('gift card not issued',
      `${session.id}: ${e && e.message}; ${minted.length} of them were minted first`);
  }
  return minted;
}

/* ------------------------------------------------------------------ stock */

/** What the cart held, read back from the metadata the checkout wrote. */
function cartLines(session) {
  try {
    const rows = JSON.parse((session.metadata || {}).lines || '[]');
    return rows.map((r) => ({ sku: r[0], qty: r[1] }));
  } catch {
    return [];
  }
}

/** Paid, so the bags leave the shelf. */
async function settleStock(session) {
  const ref = (session.metadata || {}).stock_ref;
  if (!ref) return null;
  try {
    const out = await stock.settleCart(cartLines(session), ref, Date.now(), session.id);
    const said = Object.entries(out).map(([sku, r]) => `${sku}=${r}`).join(' ');
    if (said) console.log(`[stock:settled] ${session.id} ${said}`);
    return out;
  } catch (e) {
    /* Thrown means the shelf may not have been debited, and the next
       delivery should try again — settleCart is idempotent. */
    console.error(`[stock:settle-failed] ${session.id}: ${e && e.message}`);
    throw e;
  }
}

/** Gone or failed, so they go back. */
async function releaseStock(session) {
  const ref = (session.metadata || {}).stock_ref;
  if (!ref) return;
  try {
    await stock.releaseCart(cartLines(session), ref);
    console.log(`[stock:released] ${session.id}`);
  } catch (e) {
    /* A hold not released here expires by itself within the day. */
    console.error(`[stock:release-failed] ${session.id}: ${e && e.message}`);
  }
}

/* ---------------------------------------------------------------- account */

/**
 * Files the order under the account that placed it, if there was one.
 *
 * The id comes from the Checkout Session metadata, which the checkout put
 * there from a session cookie — never from anything a browser sent. An order
 * placed as a guest has no id and belongs to nobody, which is why order
 * history shows what was bought while signed in and not everything sharing
 * an address.
 */
async function fileUnderAccount(session, order) {
  const id = (session.metadata || {}).account;
  if (!id) return false;
  try {
    const filed = await recordOrder(id, {
      session: order.session,
      date: new Date().toISOString().slice(0, 10),
      currency: order.currency,
      total: order.total,
      items: order.items.map((i) => ({ name: i.name, qty: i.qty, grind: i.grind })),
      giftCards: (order.giftCards || []).map((c) => c.code),
    });
    console.log(`[order:${filed ? 'filed' : 'already-filed'}] ${order.session} under ${id}`);
    return filed;
  } catch (e) {
    /* The order exists and the customer has their confirmation; a history
       entry that did not land is worth reporting and not worth a redelivery
       of everything else. */
    console.error(`[order:file-failed] ${order.session} under ${id}: ${e && e.message}`);
    /* Stripe still has the payment, so no money is lost — but the order
       will not appear under the customer's account until it is filed. */
    await alarm('order not filed to an account',
      `order ${order.session.slice(-8).toUpperCase()} under ${id}: ${e && e.message}`);
    return false;
  }
}

/* ------------------------------------------------------------------- mail */

const francs = (rappen) => `CHF ${(rappen / 100).toFixed(2)}`;

/* ------------------------------------------------------- the order mail --- */

const P = PALETTE;

const row = (label, value, opts = {}) => `
          <tr>
            <td style="padding:${opts.tight ? '4px' : '7px'} 0;font-size:14px;color:${opts.strong ? P.ink : P.dim};${opts.strong ? 'font-weight:700;' : ''}">${label}</td>
            <td align="right" style="padding:${opts.tight ? '4px' : '7px'} 0;font-size:14px;color:${opts.strong ? P.ink : P.dim};${opts.strong ? 'font-weight:700;' : ''}white-space:nowrap;">${value}</td>
          </tr>`;

export function orderMailHtml(order) {
  const ref = esc(order.session.slice(-8).toUpperCase());
  const cur = esc(order.currency);
  const ships = Boolean(order.address);

  const items = order.items.map((i) => `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${P.line};font-size:14px;color:${P.ink};">
              <strong style="font-weight:600;">${esc(i.qty)} &times; ${esc(i.name)}</strong>${i.grind ? `<br><span style="color:${P.dim};font-size:13px;">${esc(i.grind)}</span>` : ''}
            </td>
            <td align="right" style="padding:10px 0;border-bottom:1px solid ${P.line};font-size:14px;color:${P.ink};white-space:nowrap;vertical-align:top;">${cur} ${esc(i.amount)}</td>
          </tr>`).join('');

  const cards = (order.giftCards || []).map((c) => `
            <tr><td style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;letter-spacing:0.06em;color:${P.ink};">${esc(c.code)}</td>
                <td align="right" style="padding:6px 0;font-size:14px;color:${P.dim};white-space:nowrap;">${esc(francs(c.amount))}</td></tr>`).join('');

  const where = ships ? [order.name, order.address.line1, order.address.line2,
    `${order.address.postal_code || ''} ${order.address.city || ''}`.trim(), order.address.country]
    .filter(Boolean).map(esc).join('<br>') : null;

  return mailLayout({
    title: `Your ZUNO order ${ref}`,
    preheader: `Order ${ref} — ${cur} ${esc(order.total)}`,
    blocks: [
      `        <p style="margin:0 0 6px;font-size:19px;color:${P.ink};font-weight:600;">Thank you for your order.</p>
        <p style="margin:0;font-size:14px;color:${P.dim};">Order ${ref}</p>`,

      `        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}
${order.discount !== '0.00' ? row('Discount', `&minus;${cur} ${esc(order.discount)}`, { tight: true }) : ''}
${order.giftSpent ? row(`Gift card ${esc(order.giftSpent.code)}`, `&minus;${esc(francs(order.giftSpent.amount))}`, { tight: true }) : ''}
${row('Shipping', order.shipping === '0.00' ? 'Free' : `${cur} ${esc(order.shipping)}`, { tight: true })}
${row('Total', `${cur} ${esc(order.total)}`, { strong: true })}
        </table>`,

      cards ? `        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.panel}" style="border:1px solid ${P.gold};border-radius:10px;background:${P.panel};">
          <tr><td style="padding:16px 18px 10px;">
            ${mailHeading(`Your gift card${(order.giftCards || []).length > 1 ? 's' : ''}`)}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
            ${mailText('Redeem it in the Voucher code field at checkout. It never expires, and whatever is left stays on the card.', { dim: true, top: false })}
          </td></tr>
        </table>` : null,

      `        ${mailHeading(ships ? 'Shipping to' : 'Delivery')}
        ${mailText(where || 'Nothing to ship &mdash; delivered by email.', { top: false })}`,

      /* The one question this mail used to leave open. Stripe says 1–3
         business days at the till; saying it nowhere afterwards is how a
         shop earns a "where is my coffee" mail on day two. */
      ships
        ? `        ${mailHeading('When')}
        ${mailText('We pack within one business day. Delivery inside Switzerland and Liechtenstein takes 1&ndash;3 business days, and you get a second mail the moment your parcel is on its way.', { top: false })}
        ${mailText(`${mailLink(`${siteUrl()}/#shipping`, 'Shipping &amp; returns')} &middot; ${mailLink(`${siteUrl()}/#account`, 'Your orders')}`, { dim: true })}`
        : `        ${mailText(`${mailLink(`${siteUrl()}/#shipping`, 'Shipping &amp; returns')} &middot; ${mailLink(`${siteUrl()}/#account`, 'Your orders')}`, { dim: true, top: false })}`,
    ],
  });
}

export function orderMailText(order) {
  const lines = order.items.map((i) =>
    `  ${i.qty} x ${i.name}${i.grind ? ` (${i.grind})` : ''}   ${order.currency} ${i.amount}`);

  const where = order.address
    ? [order.name, order.address.line1, order.address.line2,
       `${order.address.postal_code || ''} ${order.address.city || ''}`.trim(),
       order.address.country].filter(Boolean).join('\n')
    : null;

  const cards = (order.giftCards || []).map((c) => `  ${c.code}   ${francs(c.amount)}`);

  return [
    'Thank you for your order.',
    '',
    `Order ${order.session.slice(-8).toUpperCase()}`,
    ...lines,
    order.discount !== '0.00' ? `  Discount   -${order.currency} ${order.discount}` : null,
    order.giftSpent ? `  Gift card ${order.giftSpent.code}   -${francs(order.giftSpent.amount)}` : null,
    `  Shipping   ${order.shipping === '0.00' ? 'Free' : order.currency + ' ' + order.shipping}`,
    `  Total      ${order.currency} ${order.total}`,
    '',
    cards.length ? 'Your gift card' + (cards.length > 1 ? 's' : '') + ':' : null,
    ...cards,
    cards.length ? '\nRedeem it in the Voucher code field at checkout. It never expires, and\nwhatever is left stays on the card.' : null,
    '',
    where ? 'Shipping to:\n' + where : 'Nothing to ship — delivered by email.',
    '',
    'ZUNO — Worldofzuno, Bahngässli 16, 3172 Niederwangen bei Bern',
    fromAddress(),
  ].filter((l) => l !== null).join('\n');
}

/**
 * One message to the customer, one to the shop. Neither may fail the webhook:
 * the order exists whether or not anyone could be told about it, and asking
 * Stripe to redeliver would re-run everything else too.
 */
async function mailOrder(order) {
  const text = orderMailText(order);
  const ref = order.session.slice(-8).toUpperCase();

  if (order.email) {
    const r = await send({
      to: order.email,
      subject: `Your ZUNO order ${ref}`,
      text,
      /* Both, always. The HTML is what a customer sees; the text is what a
         plain-text client, a screen reader on a stubborn client, and the
         function log see — and it is what gets read out if a mail ever has
         to be reconstructed by hand. */
      html: orderMailHtml(order),
    });
    /* `via: 'log'` means no provider is configured at all, which is a
       state the whole shop is in rather than something that went wrong
       with this order — learning it one alarm per order would be no way
       to learn it. A provider that tried and refused is the real failure,
       and nothing retries it: Stripe will not redeliver a 200, and asking
       it to would re-run the gift cards and the stock as well. */
    if (!r.sent && r.via !== 'log') {
      await alarm('order confirmation not sent',
        `order ${ref} to ${order.email}: ${r.error}`);
    } else if (!r.sent) {
      console.error(`[order:customer-mail-unsent] ${order.session}: ${r.error}`);
    }
  }

  const inbox = shopInbox();
  if (inbox) {
    const r = await send({
      to: inbox,
      subject: `New order ${ref} — ${order.currency} ${order.total}`,
      text: `${summarise(order)}\n\n${text}`,
      replyTo: order.email || undefined,
    });
    /* No alarm here: the alarm goes to this same inbox, so a shop copy
       that could not be delivered is an alarm that cannot be either. */
    if (!r.sent) console.error(`[order:shop-mail-unsent] ${order.session}: ${r.error}`);
  }
}

/* ----------------------------------------------------------------- handler */

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) {
    console.error('webhook is not configured: missing key or signing secret');
    return new Response('not configured', { status: 500 });
  }

  /* The raw text, never a parsed object. The signature covers the exact
     bytes Stripe sent, so re-serialising JSON breaks it even when the
     result looks identical. */
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
  } catch (e) {
    console.error('rejected an unsigned or altered webhook:', e && e.message);
    return new Response('bad signature', { status: 400 });
  }

  try {
    await handleEvent(event, stripe);
  } catch (e) {
    /* Non-2xx asks Stripe to deliver again, which is what we want when the
       failure was ours and might not repeat. */
    console.error('webhook handling failed:', e && e.message);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

/**
 * What to do about a verified event. Separate from the handler above so it
 * can be exercised without a signature and without the network — the branch
 * that matters most, a paid order, is otherwise only reachable by calling
 * Stripe for real.
 */
export async function handleEvent(event, stripe) {
  if (!HANDLED.has(event.type)) return 'ignored';

  /* The event carries a Checkout Session without its line items, and the
     product behind each price is a reference rather than an object. Both are
     needed to say what to put in the parcel, so the session is read back in
     full rather than guessed at from metadata. */
  const full = await stripe.checkout.sessions.retrieve(event.data.object.id, {
    expand: ['line_items.data.price.product'],
  });
  const order = orderFrom(full);

  if (event.type === 'checkout.session.expired') {
    /* Whatever this session was holding against a gift card goes back now,
       rather than waiting out the hold's own lifetime. */
    await releaseGift(full);
    await releaseStock(full);
    console.log(`[order:expired] ${full.id}`);
    return 'expired';
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    await releaseGift(full);
    await releaseStock(full);
    await notify('failed', order);
    return 'failed';
  }
  /* Both completed and async_payment_succeeded land here. A completed
     session is not always a paid one — a delayed method reports completed
     while the money is still in flight — so the decision is made on
     payment_status, not on the event name. */
  if (!order.paid) {
    console.log(`[order:pending] ${full.id} payment_status=${full.payment_status}`);
    return 'pending';
  }
  /* These two run before the duplicate check, because both are idempotent in
     their own right and both are too important to skip on a redelivery that
     only looked like a repeat. Settling debits once; issuing mints once. */
  order.giftSpent = await settleGift(full);
  await settleStock(full);
  order.giftCards = await issueGifts(full, order);
  await fileUnderAccount(full, order);

  if (!firstTime(full.id)) return 'duplicate';
  await notify('paid', order);
  await mailOrder(order);
  return 'paid';
}

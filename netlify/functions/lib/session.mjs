/**
 * What "paid" means for a Checkout Session, in one place.
 *
 * Stripe has two answers for money that has arrived, and the second one is
 * easy to miss:
 *
 *   paid                  somebody's card, TWINT or PayPal was charged
 *   no_payment_required   the total came to nothing, so there was nothing
 *                         to charge — a gift card covering the whole order
 *
 * Both are orders. The second is still a sale: stored value was already
 * paid for when the card was bought, and spending it is the moment that
 * money turns into coffee.
 *
 * This lived in three places and agreed with itself in only one of them.
 * `checkout-status` counted `no_payment_required` as paid, so the customer
 * was shown a confirmation; the webhook compared against `'paid'` alone and
 * dropped the order — no debit, no stock movement, no mail, nothing in the
 * back office — and the back office filtered it out of its own list for the
 * same reason. The card was never debited, so the same balance bought the
 * same coffee again the next day. One definition, imported by all of them,
 * is the only way that stays fixed.
 */

/** The payment_status values that mean the money question is settled. */
export const PAID = new Set(['paid', 'no_payment_required']);

/** Whether this session has been paid for, by money or by stored value. */
export const isPaid = (session) =>
  Boolean(session) && PAID.has(session.payment_status);

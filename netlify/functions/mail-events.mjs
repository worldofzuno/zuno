/**
 * What Resend says happened to a mail after it was accepted.
 *
 * `send` reports `sent: true` when Resend takes the message, which is not
 * the same as it arriving. The bounce comes minutes later and nothing here
 * used to see it — which is how the shop's own post, the Monday backup
 * included, went nowhere for two days while every log line read fine.
 *
 * Three events are subscribed: a bounce, a complaint (somebody pressed
 * "this is spam"), and a failure to send at all. Each one raises the same
 * alarm as the rest of the silent failures. Delivery and opens are not
 * subscribed: a mail that worked is not news, and an open is a tracking
 * pixel this shop does not use.
 *
 * Resend signs with Svix. The verification below is the Svix scheme
 * written out rather than a dependency: the signed content is
 * `id.timestamp.body`, HMAC-SHA256 under the base64 secret that follows
 * `whsec_`, and the header carries a space-separated list of versioned
 * signatures of which any may match. Unsigned is refused — this endpoint
 * is public, and an endpoint that raises alarms on request is a way to
 * fill somebody's inbox.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { alarm } from './lib/mailer.mjs';

/** How far out of step a delivery may be. Svix's own default. */
const TOLERANCE_S = 5 * 60;

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json' },
});

/** Constant-time, and false rather than a throw on a length mismatch. */
function same(a, b) {
  const x = Buffer.from(a, 'base64');
  const y = Buffer.from(b, 'base64');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export function verify(secret, headers, body, now = Date.now()) {
  if (!secret) return { ok: false, why: 'no signing secret configured' };

  const id = headers.get('svix-id') || headers.get('webhook-id');
  const ts = headers.get('svix-timestamp') || headers.get('webhook-timestamp');
  const sig = headers.get('svix-signature') || headers.get('webhook-signature');
  if (!id || !ts || !sig) return { ok: false, why: 'unsigned' };

  const age = Math.abs(Math.floor(now / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_S) return { ok: false, why: 'stale timestamp' };

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

  /* The header may carry several, old and new, as `v1,<sig> v1,<sig>`. */
  for (const part of String(sig).split(' ')) {
    const [, given] = part.split(',');
    if (given && same(want, given)) return { ok: true };
  }
  return { ok: false, why: 'signature does not match' };
}

/** The line a person needs: which mail, to whom, and what went wrong. */
export function describe(event) {
  const d = (event && event.data) || {};
  const to = Array.isArray(d.to) ? d.to.join(', ') : (d.to || 'unknown recipient');
  const subject = d.subject || '(no subject)';
  const why = (d.bounce && (d.bounce.message || d.bounce.subType || d.bounce.type))
    || d.reason || d.failed_reason || (d.failed && d.failed.reason) || '';
  return `${to} — "${subject}"${why ? `: ${why}` : ''}`;
}

const KINDS = {
  'email.bounced': 'a mail bounced',
  'email.complained': 'a mail was marked as spam',
  'email.failed': 'a mail could not be sent',
};

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  /* The raw bytes, because the signature is over what was sent and
     re-serialising JSON changes it. */
  const body = await req.text();

  const v = verify(process.env.RESEND_WEBHOOK_SECRET, req.headers, body);
  if (!v.ok) {
    console.error(`[mail-events] refused: ${v.why}`);
    return json(400, { error: 'not a signed Resend delivery' });
  }

  let event;
  try { event = JSON.parse(body); } catch { return json(400, { error: 'body must be JSON' }); }

  const kind = KINDS[event && event.type];
  if (!kind) {
    /* Subscribed to three; anything else is acknowledged so Resend stops
       retrying, and ignored. */
    return json(200, { ok: true, ignored: event && event.type });
  }

  await alarm(kind, describe(event));
  return json(200, { ok: true });
};

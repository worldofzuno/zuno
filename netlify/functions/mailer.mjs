/**
 * Sending mail, without committing to who sends it.
 *
 * Everything that needs to reach a person — an order confirmation, a gift
 * card, a password reset — goes through `send`. Which service carries it is
 * one environment variable, so changing provider is a key and a name rather
 * than a rewrite.
 *
 * With no provider configured the message is written to the function log and
 * `send` reports `sent: false`. That is a deliberate state, not a silent
 * failure: an order must never be lost because the mail service was not set
 * up yet, and nothing in the shop is allowed to read a logged mail as a
 * delivered one. Callers that must not pretend — the password reset, above
 * all — check the flag.
 */

const FROM = () => process.env.MAIL_FROM || 'ZUNO <noreply@worldofzuno.com>';
const PROVIDER = () => (process.env.MAIL_PROVIDER || 'auto').toLowerCase();

/** Where shop-side notices go: new orders, and anything needing a human. */
export const shopInbox = () => process.env.MAIL_TO || null;

/* ---------------------------------------------------------- providers --- */

const providers = {
  /** https://resend.com — three thousand messages a month at no cost. */
  async resend(message) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`resend refused the message (${res.status}): ${body.slice(0, 300)}`);
    }
    const body = await res.json().catch(() => ({}));
    return body.id || null;
  },

  /** https://postmarkapp.com */
  async postmark(message) {
    const key = process.env.POSTMARK_SERVER_TOKEN;
    if (!key) throw new Error('POSTMARK_SERVER_TOKEN is not set');
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'x-postmark-server-token': key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        From: message.from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        ...(message.html ? { HtmlBody: message.html } : {}),
        ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`postmark refused the message (${res.status}): ${body.slice(0, 300)}`);
    }
    const body = await res.json().catch(() => ({}));
    return body.MessageID || null;
  },
};

/** Which provider to use. 'auto' picks whichever one has a key. */
export function chosenProvider() {
  const named = PROVIDER();
  if (named !== 'auto') return providers[named] ? named : null;
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.POSTMARK_SERVER_TOKEN) return 'postmark';
  return null;
}

/* ---------------------------------------------------------------- send --- */

const ok = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * @returns {{sent: boolean, via: string, id: string|null, error?: string}}
 *   `sent` is false when the message was only written to the log, or when the
 *   provider refused it. It never throws: a failed mail must not fail the
 *   order it was telling someone about.
 */
export async function send(message) {
  if (!message || !ok(message.to) || !ok(message.subject) || !ok(message.text)) {
    return { sent: false, via: 'none', id: null, error: 'a message needs to, subject and text' };
  }
  const full = { ...message, from: message.from || FROM() };
  const name = chosenProvider();

  if (!name) {
    /* Written whole, so an order can be read out of the log and sent by hand
       if it ever comes to that. */
    console.log(`[mail:unsent] to=${full.to} subject=${full.subject}\n${full.text}`);
    return { sent: false, via: 'log', id: null, error: 'no mail provider configured' };
  }

  try {
    const id = await providers[name](full);
    console.log(`[mail:sent] via=${name} to=${full.to} subject=${full.subject} id=${id || '—'}`);
    return { sent: true, via: name, id };
  } catch (e) {
    const error = (e && e.message) || 'unknown error';
    console.error(`[mail:failed] via=${name} to=${full.to} subject=${full.subject}: ${error}`);
    console.log(`[mail:unsent] to=${full.to} subject=${full.subject}\n${full.text}`);
    return { sent: false, via: name, id: null, error };
  }
}

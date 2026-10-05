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
        ...(message.attachments ? {
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,            // base64
            ...(a.type ? { content_type: a.type } : {}),
          })),
        } : {}),
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
        ...(message.attachments ? {
          Attachments: message.attachments.map((a) => ({
            Name: a.filename,
            Content: a.content,            // base64
            ContentType: a.type || 'application/octet-stream',
          })),
        } : {}),
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
       if it ever comes to that. An attachment is named but not written: a
       backup belongs in a file, not in a log line. */
    const files = (full.attachments || []).map((a) => a.filename).join(', ');
    console.log(`[mail:unsent] to=${full.to} subject=${full.subject}` +
      (files ? ` attachments=${files}` : '') + `\n${full.text}`);
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

/* ------------------------------------------------------------- the look --- */

/**
 * One frame for every mail the shop sends.
 *
 * Mail clients are a museum. Tables for layout, every style on the element
 * that uses it, no stylesheet, no web font, and no image that has to load
 * before the mail makes sense — the ZUNO wordmark is letterspaced text, so
 * a client that blocks images still shows the brand.
 *
 * The palette is the shop's own four: black, gold, the deep green and the
 * warm paper. Dark text on light ground rather than the site's black,
 * because a mail client's own dark mode inverts what it likes and a
 * near-black mail is the one that comes out illegible.
 *
 * It lives beside `send` rather than in a module of its own because every
 * file in netlify/functions is published as an endpoint, and one more inert
 * URL to explain is a worse trade than one slightly wider mailer.
 */
export const PALETTE = {
  ink: '#16150e', dim: '#55513f', gold: '#f8d99b',
  green: '#1e3932', paper: '#f4f1ea', line: '#e0dacb',
};

/** Everything a customer typed is escaped. A mail assembled from what
    someone handed a form is a mail someone else could write. */
export const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const P = PALETTE;

/** A small caps heading over a block, in the deep green. */
export const mailHeading = (text) =>
  `<p style="margin:0 0 6px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:${P.green};font-weight:600;">${text}</p>`;

/** Body copy at the size the rest of the mail uses. */
export const mailText = (html, opts = {}) =>
  `<p style="margin:${opts.top === false ? '0' : '0 0 10px'};font-size:14px;color:${opts.dim ? P.dim : P.ink};line-height:1.6;">${html}</p>`;

/** A link that looks like one in every client, including the ones that
    refuse to colour anchors. */
export const mailLink = (href, text) =>
  `<a href="${esc(href)}" style="color:${P.green};text-decoration:underline;">${text}</a>`;

/**
 * Wraps blocks in the frame: wordmark band, white card on warm paper, and
 * the footer with the address the law wants on a commercial mail.
 *
 * `preheader` is the line a client shows beside the subject before anything
 * is opened. Left out, clients improvise from the first words, which is how
 * a mail ends up previewing as "Hello ,".
 */
export function mailLayout({ title, preheader = '', blocks = [] }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${P.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.paper};">
  <tr><td align="center" style="padding:28px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${P.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

      <tr><td style="background:#000000;padding:22px 28px;">
        <span style="color:${P.gold};font-size:17px;font-weight:600;letter-spacing:0.32em;">ZUNO</span>
      </td></tr>
${blocks.filter(Boolean).map((b, i) => `
      <tr><td style="padding:${i === 0 ? '28px' : '22px'} 28px 0;">
${b}
      </td></tr>`).join('')}

      <tr><td style="padding:26px 28px 28px;">
        <hr style="border:0;border-top:1px solid ${P.line};margin:0 0 16px;">
        <p style="margin:0;font-size:12px;color:${P.dim};line-height:1.7;">
          ZUNO &mdash; Worldofzuno, Bahng&auml;ssli 16, 3172 Niederwangen bei Bern<br>
          ${mailLink('mailto:info@worldofzuno.com', 'info@worldofzuno.com')} &middot;
          ${mailLink('https://worldofzuno.com', 'worldofzuno.com')}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

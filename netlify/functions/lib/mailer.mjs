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

/* The only thing the mailer keeps: how recently each kind of alarm went
   out, so one outage is one mail. store.mjs knows nothing about mail, so
   there is no cycle here. */
import { mutate } from './store.mjs';

/* A real address, not noreply@. Two reasons, and neither is sentimental:
   a customer who hits reply on an order confirmation is asking a question,
   and a mailbox that swallows it costs a sale; and spam filters —
   Microsoft's above all — treat noreply@ on a young domain as a mark
   against it. Whatever stands here must be a mailbox somebody reads. */
const FROM = () => {
  const set = (process.env.MAIL_FROM || '').trim();
  /* A full "Name <addr>" pair is taken as written. A bare address gets the
     name put in front of it, because a sender that reads
     "info@worldofzuno.com" rather than "ZUNO" is one the reader has to
     decode — and because the address is the part that changes, while the
     name is the brand and belongs in one place. */
  if (set.includes('<')) return set;
  const name = (process.env.MAIL_FROM_NAME || 'ZUNO').trim();
  return `${name} <${set || 'info@worldofzuno.com'}>`;
};
const PROVIDER = () => (process.env.MAIL_PROVIDER || 'auto').toLowerCase();

/** The bare address out of a "Name <addr>" pair, for Reply-To. */
const bare = (from) => {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
};

/** Where a reply goes. The sending address unless something says otherwise,
    so there is one mailbox to watch rather than two. */
export const replyAddress = () => process.env.MAIL_REPLY_TO || bare(FROM());

/** Where shop-side notices go: new orders, and anything needing a human. */
export const shopInbox = () => process.env.MAIL_TO || null;

/**
 * Where the shop lives, for links and for the logo in the mail frame.
 *
 * Netlify sets `URL` to the project's primary address, so this follows the
 * custom domain the day it is attached and needs no deploy of its own. The
 * literal is the last resort — a mail with a dead link in it is a mail that
 * looks like phishing to both the reader and the filter.
 */
export const siteUrl = () =>
  String(process.env.SITE_URL || process.env.URL || 'https://worldofzuno.com')
    .replace(/\/+$/, '');

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
  const full = {
    ...message,
    from: message.from || FROM(),
    replyTo: message.replyTo || replyAddress(),
  };
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

/* ----------------------------------------------------------- the alarm --- */

/**
 * Tell the shop that something did not work.
 *
 * Everything in here already wrote to the function log when it failed. The
 * trouble with a log is that nobody reads it on a Tuesday: an order whose
 * confirmation never went out looks exactly like an order whose
 * confirmation went out, until the customer writes in. This turns the four
 * failures nobody else finds out about into a mail.
 *
 * It is deliberately not clever. No retry, no queue, no second channel. If
 * the mail provider is the thing that is down then this cannot get through
 * either, and it says so in the log rather than pretending.
 *
 * `kind` is a short stable key — it is what the throttle counts, so one
 * provider outage during a busy hour is one mail rather than forty.
 */
const ALARM_QUIET_MS = 15 * 60 * 1000;

export async function alarm(kind, detail, { now = Date.now() } = {}) {
  console.error(`[alarm] ${kind}: ${detail}`);

  const to = shopInbox();
  if (!to) return { sent: false, error: 'MAIL_TO is not set; nowhere to raise it' };

  let allowed = false;
  try {
    await mutate(`alarm/${kind}`, (cur) => {
      if (cur && cur.at && now - cur.at < ALARM_QUIET_MS) return null;
      allowed = true;
      return { at: now, detail: String(detail).slice(0, 500) };
    });
  } catch (e) {
    /* A throttle that cannot be read is not a reason to stay silent. The
       alarm is the point; counting it is the convenience. */
    console.error(`[alarm:throttle-unavailable] ${kind}: ${e && e.message}`);
    allowed = true;
  }
  if (!allowed) return { sent: false, error: 'throttled' };

  return send({
    to,
    subject: `ZUNO: ${kind}`,
    text: [
      'Something in the shop did not work.',
      '',
      `What:  ${kind}`,
      `Where: ${detail}`,
      `When:  ${new Date(now).toISOString()}`,
      '',
      'The function log has the full entry. Nothing retries by itself —',
      'if this was a mail to a customer, it has to be sent by hand.',
      '',
      `ZUNO — ${replyAddress()}`,
    ].join('\n'),
  });
}

/* ------------------------------------------------------------- the look --- */

/**
 * One frame for every mail the shop sends.
 *
 * Mail clients are a museum. Tables for layout, every style on the element
 * that uses it, no stylesheet and no web font.
 *
 * The one image is the wordmark, and it is the real one — the same gold
 * lettering as the site's header, not a bold sans pretending. It is served
 * from the shop rather than attached, flattened onto the band's own black
 * so no client can composite its transparency against white and leave a
 * halo, and it carries alt text styled to look right on its own: a mail
 * with images off still shows ZUNO in gold, letterspaced.
 *
 * The mail is dark, like the site. It used to be dark text on warm paper,
 * on the theory that a client's own dark mode would invert a near-black
 * mail into something illegible. What actually happened: iOS Mail inverted
 * the light one. The olive-brown ground and white-on-black card that came
 * out were nobody's design — they were Apple's arithmetic on ours, and the
 * `color-scheme: light` metas did not stop it. A dark mail is left alone,
 * because there is nothing for a dark mode to do to it. So it reads the
 * same in both modes, and it reads as ZUNO.
 *
 * Every surface carries the old `bgcolor` attribute as well as the style.
 * Outlook's Word engine ignores a CSS background and honours the attribute,
 * and beige text on a white rectangle is the one failure this must not
 * have.
 *
 * It lives beside `send` rather than in a module of its own. The original
 * reason was that every file in netlify/functions was published as an
 * endpoint, so a second file meant a second inert URL; that stopped being
 * true when the libraries moved into lib/. It stays because the frame and
 * the sending are one subject, and splitting them now would be churn.
 *
 * Contrast on the card, measured: ink 15.5:1, dim 7.6:1, gold headings
 * 14.3:1. On the gift-card panel: ink 13.1:1, dim 6.5:1, gold 12.2:1. All
 * clear of AA, body and large alike.
 */
export const PALETTE = {
  /* The site's own: black ground, the gold, the beige it writes in. */
  bg: '#000000',
  band: '#000000',
  /* A hair off black, so the card is a card and not a hole. */
  card: '#0d0c0a',
  /* The site's --beige, as the ink. */
  ink: '#ede4d3',
  /* The beige at the opacity the site uses for secondary copy, mixed down
     against the card rather than left transparent — a mail client cannot be
     relied on for rgba(). */
  dim: '#a7a194',
  gold: '#f8d99b',
  /* On black the deep green is a surface, not a colour to write in: it is
     the gift-card panel, and headings are gold instead. */
  green: '#1e3932',
  panel: '#15211d',
  line: '#2b2823',
  /* Kept so nothing that still asks for `paper` breaks; it is the ground. */
  paper: '#000000',
};

/** Everything a customer typed is escaped. A mail assembled from what
    someone handed a form is a mail someone else could write. */
export const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const P = PALETTE;

/** A small caps heading over a block, in the gold. On black the deep green
    is a surface rather than something to read. */
export const mailHeading = (text) =>
  `<p style="margin:0 0 6px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:${P.gold};font-weight:600;">${text}</p>`;

/** Body copy at the size the rest of the mail uses. */
export const mailText = (html, opts = {}) =>
  `<p style="margin:${opts.top === false ? '0' : '0 0 10px'};font-size:14px;color:${opts.dim ? P.dim : P.ink};line-height:1.6;">${html}</p>`;

/** A link that looks like one in every client, including the ones that
    refuse to colour anchors. */
export const mailLink = (href, text) =>
  `<a href="${esc(href)}" style="color:${P.gold};text-decoration:underline;">${text}</a>`;

/**
 * Wraps blocks in the frame: the wordmark, the card, and the footer with
 * the address the law wants on a commercial mail.
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
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
</head>
<body bgcolor="${P.bg}" style="margin:0;padding:0;background:${P.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.bg}" style="background:${P.bg};">
  <tr><td align="center" bgcolor="${P.bg}" style="background:${P.bg};padding:28px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${P.card}" style="max-width:560px;background:${P.card};border:1px solid ${P.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

      <tr><td bgcolor="${P.band}" style="background:${P.band};padding:22px 28px 20px;line-height:22px;border-bottom:1px solid ${P.line};">
        <img src="${siteUrl()}/img/zuno-wordmark-mail.png" width="140" alt="ZUNO"
             style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;text-decoration:none;color:${P.gold};font-size:17px;font-weight:600;letter-spacing:0.32em;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      </td></tr>
${blocks.filter(Boolean).map((b, i) => `
      <tr><td bgcolor="${P.card}" style="background:${P.card};padding:${i === 0 ? '28px' : '22px'} 28px 0;">
${b}
      </td></tr>`).join('')}

      <tr><td bgcolor="${P.card}" style="background:${P.card};padding:26px 28px 28px;">
        <hr style="border:0;border-top:1px solid ${P.line};margin:0 0 16px;">
        <p style="margin:0;font-size:12px;color:${P.dim};line-height:1.7;">
          ZUNO &mdash; Worldofzuno, Bahng&auml;ssli 16, 3172 Niederwangen bei Bern<br>
          ${mailLink(`mailto:${replyAddress()}`, esc(replyAddress()))} &middot;
          ${mailLink(siteUrl(), esc(siteUrl().replace(/^https?:\/\//, '')))}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

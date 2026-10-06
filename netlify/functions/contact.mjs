/**
 * The contact form, forwarded to a person.
 *
 * Netlify Forms catches the submission, screens the honeypot and keeps it
 * in the dashboard. What it does not do is tell anybody: a submission sits
 * there until somebody thinks to look, and the page meanwhile promises
 * "we'll get back to you shortly". That promise was unkept for two days
 * before an inquiry arrived to prove it.
 *
 * This subscribes to the submission instead of polling for it. The shape
 * is Netlify's current one, read off their own published types
 * (@netlify/types 3.2.0, re-exported by @netlify/functions 6.0.2):
 *
 *     interface FormSubmittedEvent { data: Record<string, string> }
 *     type FormSubmittedHandler = (event) => void | Promise<void>
 *     interface BaseNetlifyFunction { formSubmitted?: FormSubmittedHandler }
 *
 * — so the default export is an object carrying the method, not a function.
 * The older arrangement, a file named `submission-created` exporting
 * `handler`, is not this. There is no `fetch` method here on purpose: this
 * answers an event, and an HTTP route on it would be a way in that nothing
 * needs.
 *
 * The handler returns nothing and cannot change what the visitor sees. By
 * the time it runs they have already been thanked, which is the right way
 * round: the inquiry is safe in Netlify's hands either way, and this is
 * only the part that carries it to a mailbox.
 */

import { send, alarm, shopInbox, mailLayout, mailHeading, mailText, esc } from './lib/mailer.mjs';

/** Netlify adds these to the stored submission; they are not the person. */
const PLUMBING = new Set(['ip', 'user_agent', 'referrer', 'bot-field', 'form-name']);

const firstOf = (data, keys) => {
  for (const k of keys) {
    const v = String(data[k] ?? '').trim();
    if (v) return v;
  }
  return '';
};

/** A line per field the visitor actually filled in, in the order given. */
export function fields(data) {
  return Object.entries(data || {})
    .filter(([k, v]) => !PLUMBING.has(k) && String(v ?? '').trim())
    .map(([k, v]) => [k, String(v).trim()]);
}

export function inquiryMail(data) {
  const name = firstOf(data, ['name']);
  const from = firstOf(data, ['email']);
  const message = firstOf(data, ['message']);

  /* Everything here was typed by a stranger into a public form, so every
     piece of it is escaped before it goes anywhere near the HTML. */
  const rows = fields(data)
    .filter(([k]) => k !== 'message')
    /* Not `top: false`: each pair needs room beneath it, or the next
       heading sits on the value above and the two read as one field. */
    .map(([k, v]) => `${mailHeading(esc(k))}${mailText(esc(v))}`)
    .join('');

  const subject = name ? `Inquiry from ${name}` : 'Inquiry from the contact form';

  const text = [
    'Somebody wrote through the contact form.',
    '',
    ...fields(data).map(([k, v]) => `${k}: ${v}`),
    '',
    from ? `Reply to this mail and it goes to ${from}.` : 'No address was given, so there is nobody to reply to.',
  ].join('\n');

  const html = mailLayout({
    title: subject,
    preheader: message.slice(0, 120),
    blocks: [
      `        ${mailText('Somebody wrote through the contact form.', { top: false })}`,
      rows || null,
      message ? `        ${mailHeading('message')}
        ${mailText(esc(message).replace(/\n/g, '<br>'), { top: false })}` : null,
      `        ${mailText(from
        ? `Reply to this mail and it goes to ${esc(from)}.`
        : 'No address was given, so there is nobody to reply to.', { dim: true, top: false })}`,
    ],
  });

  return { subject, text, html, from };
}

export async function notify(data, deps = {}) {
  const post = deps.send || send;
  const raise = deps.alarm || alarm;
  const to = deps.to || shopInbox();

  if (!to) {
    await raise('contact form has nowhere to go', 'MAIL_TO is not set');
    return { sent: false, reason: 'no-inbox' };
  }

  const mail = inquiryMail(data);
  const r = await post({
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    /* The whole point: pressing Reply answers the person who wrote, not
       the shop's own inbox. */
    ...(mail.from ? { replyTo: mail.from } : {}),
  });

  if (!r.sent && r.via !== 'log') {
    /* The submission is not lost — it is in Netlify's dashboard under
       Forms — but nobody has been told, and the page said somebody would
       be in touch shortly. */
    await raise('contact form inquiry not forwarded',
      `${mail.subject}: ${r.error}`);
  }
  return { sent: r.sent, reason: r.error || null };
}

export default {
  formSubmitted: async (event) => {
    await notify((event && event.data) || {});
  },
};

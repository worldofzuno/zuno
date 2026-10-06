/**
 * Checks on the contact form's forwarding, run with:
 *
 *     node --test tests/functions/contact.test.mjs
 *
 * Two things matter. Everything in an inquiry was typed by a stranger into
 * a public form, so none of it may reach the HTML unescaped — this is the
 * one mail the shop sends whose entire body is somebody else's words. And
 * a Reply has to reach the person who wrote, because an inquiry answered
 * into the shop's own inbox is an inquiry nobody answers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const mod = await import('../../netlify/functions/contact.mjs');

const SUBMISSION = {
  name: 'Anna Kundin',
  email: 'anna@example.ch',
  message: 'Do you ship to Liechtenstein?',
  ip: '203.0.113.4',
  user_agent: 'Mozilla/5.0',
  referrer: 'https://worldofzuno.com/',
  'bot-field': '',
};

/** Captures what would have been sent. */
function capture(result = { sent: true, via: 'resend', id: 'mail_1' }) {
  const sent = [];
  const raised = [];
  return {
    sent,
    raised,
    deps: {
      to: 'info@worldofzuno.com',
      send: async (m) => { sent.push(m); return result; },
      alarm: async (kind, detail) => { raised.push({ kind, detail }); },
    },
  };
}

test('the inquiry reaches the shop, and Reply reaches the person', async () => {
  const c = capture();
  const r = await mod.notify(SUBMISSION, c.deps);

  assert.equal(r.sent, true);
  assert.equal(c.sent.length, 1);
  assert.equal(c.sent[0].to, 'info@worldofzuno.com');
  assert.equal(c.sent[0].replyTo, 'anna@example.ch');
  assert.ok(c.sent[0].subject.includes('Anna Kundin'));
  assert.ok(c.sent[0].text.includes('Do you ship to Liechtenstein?'));
  assert.ok(c.sent[0].html.includes('Do you ship to Liechtenstein?'));
  assert.equal(c.raised.length, 0);
});

test("Netlify's own plumbing is not mistaken for what somebody wrote", () => {
  const shown = mod.fields(SUBMISSION).map(([k]) => k);
  assert.deepEqual(shown, ['name', 'email', 'message']);
  for (const noise of ['ip', 'user_agent', 'referrer', 'bot-field']) {
    assert.equal(shown.includes(noise), false, `${noise} is not a field a person filled in`);
  }

  /* An empty field is not a field. */
  assert.deepEqual(mod.fields({ name: 'A', phone: '   ' }).map(([k]) => k), ['name']);
});

test('every word of it is escaped, because a stranger typed it', () => {
  const { html, subject } = mod.inquiryMail({
    name: '<script>alert(1)</script>',
    email: '"><b>bold',
    message: 'Line one\nLine two <img src=x onerror=alert(1)>',
  });

  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('"><b>bold'), false);
  assert.ok(html.includes('&lt;script&gt;'), 'escaped, not dropped — it still reads back');

  /* A newline is the one piece of formatting that survives, as a break
     rather than as markup. */
  assert.ok(html.includes('Line one<br>Line two'));
  assert.ok(subject.includes('<script>'), 'the subject is plain text, not HTML');
});

test('an inquiry with no address says so rather than pretending', async () => {
  const c = capture();
  await mod.notify({ name: 'Anonymous', message: 'No address here' }, c.deps);

  assert.equal('replyTo' in c.sent[0], false, 'nothing to reply to, so no Reply-To');
  assert.ok(/nobody to reply to/i.test(c.sent[0].text));
});

test('a refused mail is raised, because the page promised an answer', async () => {
  const c = capture({ sent: false, via: 'resend', error: '403 domain is not verified' });
  const r = await mod.notify(SUBMISSION, c.deps);

  assert.equal(r.sent, false);
  assert.equal(c.raised.length, 1);
  assert.ok(c.raised[0].kind.includes('not forwarded'));
  assert.ok(c.raised[0].detail.includes('403'));
});

test('with no provider at all, no alarm is raised per inquiry', async () => {
  const c = capture({ sent: false, via: 'log', error: 'no mail provider configured' });
  await mod.notify(SUBMISSION, c.deps);
  assert.equal(c.raised.length, 0, 'that is a state the whole shop is in, not this inquiry');
});

test('nowhere to send it is itself worth an alarm', async () => {
  const c = capture();
  const r = await mod.notify(SUBMISSION, { ...c.deps, to: null });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'no-inbox');
  assert.equal(c.sent.length, 0);
  assert.ok(c.raised[0].kind.includes('nowhere to go'));
});

/* The shape is Netlify's, read off @netlify/types: the default export is an
   object carrying the method, not a function, and there is no fetch method
   because this answers an event rather than a request. */
test('it is wired the way Netlify subscribes to a submission', () => {
  assert.equal(typeof mod.default, 'object');
  assert.equal(typeof mod.default.formSubmitted, 'function');
  assert.equal('fetch' in mod.default, false, 'no HTTP route on an event handler');
});

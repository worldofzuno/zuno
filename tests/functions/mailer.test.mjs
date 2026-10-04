/**
 * Checks on the mailer, run with:
 *
 *     node --test tests/functions/mailer.test.mjs
 *
 * The adapters had never been tested: every other test runs with no
 * provider configured, which exercises exactly the branch that does not
 * send. So the shape of what goes to Resend and to Postmark — the one thing
 * a typo would break silently and invisibly — was being taken on trust.
 *
 * fetch is replaced rather than called. The point is what we send, not what
 * they do with it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { send, shopInbox, chosenProvider } = await import('../../netlify/functions/mailer.mjs');

const ENV = ['RESEND_API_KEY', 'POSTMARK_SERVER_TOKEN', 'MAIL_PROVIDER', 'MAIL_FROM', 'MAIL_TO'];
function clearEnv() { for (const k of ENV) delete process.env[k]; }

/** Captures the one request the adapter makes. */
function stubFetch(response = { ok: true, json: async () => ({ id: 'mail_1' }) }) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { status: 200, text: async () => '', ...response };
  };
  return calls;
}

const quiet = async (fn) => {
  const real = { log: console.log, error: console.error };
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { value: await fn(), log: lines.join('\n') }; }
  finally { Object.assign(console, real); }
};

const MSG = { to: 'kundin@example.ch', subject: 'Hello', text: 'Plain words.' };

test('with no provider nothing is sent, and it says so', async () => {
  clearEnv();
  const { value, log } = await quiet(() => send(MSG));
  assert.equal(value.sent, false);
  assert.equal(value.via, 'log');
  assert.ok(log.includes('Plain words.'), 'the message is written whole, so it can be sent by hand');
});

test('resend gets the fields resend documents', async () => {
  clearEnv();
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = stubFetch();
  const { value } = await quiet(() => send({ ...MSG, html: '<p>Hello</p>', replyTo: 'info@worldofzuno.com' }));

  assert.equal(value.sent, true);
  assert.equal(value.via, 'resend');
  assert.equal(value.id, 'mail_1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.authorization, 'Bearer re_test_key');
  assert.deepEqual(calls[0].body.to, ['kundin@example.ch'], 'resend wants an array');
  assert.equal(calls[0].body.subject, 'Hello');
  assert.equal(calls[0].body.text, 'Plain words.');
  assert.equal(calls[0].body.html, '<p>Hello</p>');
  assert.equal(calls[0].body.reply_to, 'info@worldofzuno.com', 'snake_case, not replyTo');
});

test('an attachment reaches resend in its own shape', async () => {
  clearEnv();
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = stubFetch();
  await quiet(() => send({
    ...MSG,
    attachments: [{ filename: 'zuno-backup-2026-10-05.json', content: 'eyJhIjoxfQ==', type: 'application/json' }],
  }));

  const a = calls[0].body.attachments;
  assert.equal(a.length, 1);
  assert.deepEqual(Object.keys(a[0]).sort(), ['content', 'content_type', 'filename']);
  assert.equal(a[0].filename, 'zuno-backup-2026-10-05.json');
  assert.equal(a[0].content, 'eyJhIjoxfQ==', 'base64, handed over untouched');
  assert.equal(a[0].content_type, 'application/json');
});

test('postmark gets postmark names for the same message', async () => {
  clearEnv();
  process.env.POSTMARK_SERVER_TOKEN = 'pm_test';
  const calls = stubFetch({ ok: true, json: async () => ({ MessageID: 'pm_1' }) });
  const { value } = await quiet(() => send({
    ...MSG, html: '<p>Hi</p>',
    attachments: [{ filename: 'b.json', content: 'eyJ9', type: 'application/json' }],
  }));

  assert.equal(value.via, 'postmark');
  assert.equal(value.id, 'pm_1');
  assert.equal(calls[0].body.TextBody, 'Plain words.');
  assert.equal(calls[0].body.HtmlBody, '<p>Hi</p>');
  assert.equal(calls[0].body.Attachments[0].Name, 'b.json');
  assert.equal(calls[0].body.Attachments[0].Content, 'eyJ9');
});

test('a refusal is reported, never swallowed', async () => {
  clearEnv();
  process.env.RESEND_API_KEY = 're_test_key';
  stubFetch({ ok: false, status: 403, text: async () => '{"message":"domain is not verified"}' });
  const { value, log } = await quiet(() => send(MSG));

  assert.equal(value.sent, false);
  assert.equal(value.via, 'resend');
  assert.ok(/403/.test(value.error));
  assert.ok(/not verified/.test(value.error), 'the reason reaches the caller, not just a shrug');
  assert.ok(log.includes('Plain words.'), 'and the message still lands in the log');
});

test('a message missing its parts is refused before any request', async () => {
  clearEnv();
  process.env.RESEND_API_KEY = 're_test_key';
  const calls = stubFetch();
  const { value } = await quiet(() => send({ to: 'kundin@example.ch' }));
  assert.equal(value.sent, false);
  assert.equal(calls.length, 0, 'nothing is asked of the provider');
});

test('the provider is chosen by whichever key exists', async () => {
  clearEnv();
  assert.equal(chosenProvider(), null);
  process.env.POSTMARK_SERVER_TOKEN = 'pm';
  assert.equal(chosenProvider(), 'postmark');
  process.env.RESEND_API_KEY = 're';
  assert.equal(chosenProvider(), 'resend', 'resend wins when both are set');
  process.env.MAIL_PROVIDER = 'postmark';
  assert.equal(chosenProvider(), 'postmark', 'unless one is named');
  process.env.MAIL_PROVIDER = 'carrier-pigeon';
  assert.equal(chosenProvider(), null, 'a name nobody implements is not a provider');
  clearEnv();
});

test('shopInbox is where shop-side notices go, or nowhere', () => {
  clearEnv();
  assert.equal(shopInbox(), null);
  process.env.MAIL_TO = 'info@worldofzuno.com';
  assert.equal(shopInbox(), 'info@worldofzuno.com');
  clearEnv();
});

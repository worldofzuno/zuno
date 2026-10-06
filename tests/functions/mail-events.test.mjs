/**
 * Checks on what Resend tells us after a mail was accepted, run with:
 *
 *     node --test tests/functions/mail-events.test.mjs
 *
 * This endpoint is public and its whole job is to raise alarms, so the
 * signature check is the feature. An endpoint that alarms on request is a
 * way to fill somebody's inbox, and one that alarms on a replayed delivery
 * is a way to do it twice.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';

const mod = await import('../../netlify/functions/mail-events.mjs');
const handler = mod.default;

const SECRET = 'whsec_' + Buffer.from('a signing secret, base64ed').toString('base64');

/** A delivery signed the way Svix signs one. */
function delivery(event, { secret = SECRET, at = Date.now(), id = 'msg_1', tamper = false } = {}) {
  const body = JSON.stringify(event);
  const ts = String(Math.floor(at / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return new Request('https://worldofzuno.com/.netlify/functions/mail-events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': `v1,${tamper ? 'AAAA' + sig.slice(4) : sig}`,
    },
    body,
  });
}

const BOUNCE = {
  type: 'email.bounced',
  data: {
    to: ['info@worldofzuno.com'],
    subject: 'ZUNO backup 2026-10-05 — CHF 0.00 outstanding',
    bounce: { type: 'Permanent', subType: 'NoEmail', message: 'The recipient does not exist.' },
  },
};

const quiet = async (fn) => {
  const real = { log: console.log, error: console.error };
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { res: await fn(), log: lines.join('\n') }; }
  finally { Object.assign(console, real); }
};

function withSecret(value, fn) {
  const had = process.env.RESEND_WEBHOOK_SECRET;
  if (value === null) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = value;
  return Promise.resolve(fn()).finally(() => {
    if (had === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = had;
  });
}

test('a signed bounce is taken, and says what bounced', async () => {
  await withSecret(SECRET, async () => {
    const { res, log } = await quiet(() => handler(delivery(BOUNCE)));
    assert.equal(res.status, 200);
    assert.ok(log.includes('a mail bounced'));
    assert.ok(log.includes('info@worldofzuno.com'), 'who never got it');
    assert.ok(log.includes('ZUNO backup'), 'and which mail');
    assert.ok(log.includes('does not exist'), 'and why');
  });
});

test('an unsigned delivery is refused', async () => {
  await withSecret(SECRET, async () => {
    const bare = new Request('https://worldofzuno.com/.netlify/functions/mail-events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BOUNCE),
    });
    const { res } = await quiet(() => handler(bare));
    assert.equal(res.status, 400);
  });
});

test('a tampered signature is refused', async () => {
  await withSecret(SECRET, async () => {
    const { res } = await quiet(() => handler(delivery(BOUNCE, { tamper: true })));
    assert.equal(res.status, 400);
  });
});

test('a body changed after signing is refused', async () => {
  await withSecret(SECRET, async () => {
    const req = delivery(BOUNCE);
    const swapped = new Request(req.url, {
      method: 'POST', headers: req.headers,
      body: JSON.stringify({ ...BOUNCE, data: { ...BOUNCE.data, to: ['someone@else.example'] } }),
    });
    const { res } = await quiet(() => handler(swapped));
    assert.equal(res.status, 400);
  });
});

/* A delivery captured today and posted next week must not raise it again. */
test('a stale delivery is refused', async () => {
  await withSecret(SECRET, async () => {
    const old = delivery(BOUNCE, { at: Date.now() - 20 * 60 * 1000 });
    const { res } = await quiet(() => handler(old));
    assert.equal(res.status, 400);
  });
});

test('a signature from another secret is refused', async () => {
  await withSecret(SECRET, async () => {
    const other = 'whsec_' + Buffer.from('somebody else entirely').toString('base64');
    const { res } = await quiet(() => handler(delivery(BOUNCE, { secret: other })));
    assert.equal(res.status, 400);
  });
});

test('with no secret configured nothing is accepted', async () => {
  await withSecret(null, async () => {
    const { res, log } = await quiet(() => handler(delivery(BOUNCE)));
    assert.equal(res.status, 400);
    assert.ok(log.includes('no signing secret'), 'and it says why, in the log');
  });
});

test('an event we did not subscribe to is acknowledged and dropped', async () => {
  await withSecret(SECRET, async () => {
    const { res, log } = await quiet(() =>
      handler(delivery({ type: 'email.opened', data: { to: ['a@b.ch'] } })));
    assert.equal(res.status, 200, 'so Resend stops retrying it');
    assert.equal(log.includes('[alarm]'), false);
  });
});

test('a complaint and a failure are heard too', async () => {
  await withSecret(SECRET, async () => {
    for (const [type, said] of [
      ['email.complained', 'marked as spam'],
      ['email.failed', 'could not be sent'],
    ]) {
      const { log } = await quiet(() =>
        handler(delivery({ type, data: { to: ['a@b.ch'], subject: 'x' } })));
      assert.ok(log.includes(said), `${type} should say "${said}"`);
    }
  });
});

test('GET is not a delivery', async () => {
  const { res } = await quiet(() =>
    handler(new Request('https://worldofzuno.com/.netlify/functions/mail-events')));
  assert.equal(res.status, 405);
});

test('the description survives a payload shaped differently', () => {
  assert.ok(mod.describe({ data: {} }).includes('unknown recipient'));
  assert.ok(mod.describe({ data: { to: 'one@example.ch' } }).includes('one@example.ch'));
  assert.ok(mod.describe({ data: { to: ['a@b.ch'], reason: 'mailbox full' } }).includes('mailbox full'));
  assert.equal(typeof mod.describe({}), 'string', 'and never throws');
});

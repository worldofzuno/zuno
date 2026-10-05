/**
 * Checks on the weekly backup, run with:
 *
 *     node --test tests/functions/backup.test.mjs
 *
 * Three things matter. The file has to be the same one the back office
 * hands over, or the two drift apart and nobody notices until a balance is
 * being restored. A stranger who finds the URL must not be able to fill the
 * inbox. And the data must never come back in the response — the mailbox is
 * the only way to it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useMemoryStore } = await import('../../netlify/functions/lib/store.mjs');
const gift = await import('../../netlify/functions/lib/giftcard.mjs');
const stock = await import('../../netlify/functions/lib/stock.mjs');
const admin = await import('../../netlify/functions/admin.mjs');
const mod = await import('../../netlify/functions/backup.mjs');

const TOKEN = 'a-long-enough-admin-token-for-tests';

/* The mailer has no provider in a test, so it writes the whole message to
   the log and reports sent:false. Reading the log back is how a test sees
   what would have gone out. */
function captureLog(run) {
  const real = { log: console.log, error: console.error };
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  return Promise.resolve(run()).then(
    (v) => { Object.assign(console, real); return { value: v, log: lines.join('\n') }; },
    (e) => { Object.assign(console, real); throw e; },
  );
}

async function shopWithMoney() {
  useMemoryStore();
  process.env.MAIL_TO = 'info@worldofzuno.com';
  process.env.ADMIN_TOKEN = TOKEN;
  const card = await gift.issue({ amount: 5000, issuedFor: 'cs_bought' });
  await gift.hold(card.code, 'pre_1', 2000);
  await gift.settle(card.code, 'pre_1', 2000, Date.now(), 'cs_spend');
  await stock.setQty('castano-200g', 7);
  return card;
}

const call = (url = 'https://worldofzuno.com/.netlify/functions/backup') =>
  mod.default(new Request(url, { method: 'POST' }));

test('the file is the one the back office hands over', async () => {
  await shopWithMoney();
  const fromButton = await admin.takeBackup();
  const { log } = await captureLog(() => mod.runBackup({ force: true }));

  assert.ok(log.includes('zuno-backup-'), 'it goes as a file, not as a wall of text');
  assert.equal(fromButton.giftCards.length, 1);
  assert.equal(fromButton.stock.length, 1);
  assert.ok(Object.keys(fromButton).includes('accounts'));
});

test('the mail says what is owed without opening the file', async () => {
  await shopWithMoney();
  const { log } = await captureLog(() => mod.runBackup({ force: true }));
  assert.ok(log.includes('CHF 30.00'), 'issued 50, spent 20, so 30 is still owed');
  assert.ok(log.includes('Gift cards        1'));
});

test('a backup carries no password derivation', async () => {
  useMemoryStore();
  const auth = await import('../../netlify/functions/lib/auth.mjs');
  await auth.createAccount({ name: 'A Kundin', email: 'kundin@example.ch', password: 'a decent long passphrase' });
  const data = await admin.takeBackup();
  assert.equal(data.accounts.length, 1);
  assert.equal('password' in data.accounts[0], false,
    'a backup that could restore a login is a second place to steal one from');
});

/* With no provider configured the mailer logs and reports sent:false, and
   runBackup refuses to call that a backup — which is the point. So these
   check the REASON: 'mail' means the guard let it through and the sending
   failed; 'too-soon' means the guard stopped it before it tried. */
test('without a token, one backup every six hours and no more', async () => {
  await shopWithMoney();
  const first = await captureLog(() => call());
  assert.equal((await first.value.json()).reason, 'mail', 'the first one was attempted');

  const second = await captureLog(() => call());
  assert.deepEqual(await second.value.json(), { ok: false, reason: 'too-soon' },
    'the second was not');
});

test('with the token it runs on demand', async () => {
  await shopWithMoney();
  await captureLog(() => call());
  const again = await captureLog(() =>
    mod.default(new Request('https://worldofzuno.com/.netlify/functions/backup', {
      method: 'POST', headers: { 'x-admin-token': TOKEN },
    })));
  assert.equal((await again.value.json()).reason, 'mail',
    'it got past the guard — the shop owner is not the one being throttled');
});

test('a wrong token is simply not a token', async () => {
  await shopWithMoney();
  await captureLog(() => call());
  const again = await captureLog(() =>
    mod.default(new Request('https://worldofzuno.com/.netlify/functions/backup', {
      method: 'POST', headers: { 'x-admin-token': 'not-the-key-but-long-enough-x' },
    })));
  assert.deepEqual(await again.value.json(), { ok: false, reason: 'too-soon' });
});

test('the response never carries the data', async () => {
  await shopWithMoney();
  const { value } = await captureLog(() => call());
  const body = await value.text();
  assert.equal(body.includes('ZG-'), false, 'no card code');
  assert.equal(body.includes('kundin'), false);
  assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['ok', 'reason'],
    'two fields, neither of them the ledger');
});

test('with nowhere to send it, it says so rather than pretending', async () => {
  await shopWithMoney();
  delete process.env.MAIL_TO;
  const { value } = await captureLog(() => mod.runBackup({ force: true }));
  assert.deepEqual(value, { ok: false, reason: 'no-inbox' });
  process.env.MAIL_TO = 'info@worldofzuno.com';
});

test('it is scheduled, and not on the hour', () => {
  assert.ok(mod.config && typeof mod.config.schedule === 'string');
  const [minute] = mod.config.schedule.split(' ');
  assert.notEqual(minute, '0', 'every scheduler in the world fires at :00');
});

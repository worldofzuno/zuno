/**
 * The weekly backup, mailed to the shop.
 *
 *   netlify/functions/backup.mjs   — runs itself, Mondays
 *
 * Gift card balances are money the shop owes. Stripe knows what was bought;
 * only this store knows what has been spent. The back office has had a
 * download button since the day it was built, and a button only helps the
 * week somebody remembers to press it. This is the week nobody does.
 *
 * It mails the same file the button hands over — one definition, in
 * admin.mjs — as an attachment, which is also the point: a copy that leaves
 * Netlify. A backup kept beside the thing it backs up is not a backup.
 *
 * Netlify refuses a direct HTTP call to a scheduled function in production
 * — it answers 403 before this file runs — which was worth finding out by
 * trying rather than assuming. The two guards below therefore protect a
 * door that is already shut:
 *
 *   - with the admin token it runs on demand, which is how it is exercised
 *     locally and in the tests
 *   - without one, at most one backup every six hours
 *
 * They stay because the 403 is Netlify's policy, not ours, and a guard that
 * costs nothing is a poor thing to remove on someone else's promise.
 *
 * It never returns the backup in the response. The only way to the data is
 * the mailbox it is sent to.
 */

import { takeBackup, tokenMatches, tokenProblem } from './admin.mjs';
import { send, shopInbox } from './mailer.mjs';
import { mutate } from './store.mjs';

/* Monday at 04:17 UTC. Not on the hour: every scheduler in the world fires
   at :00, and the quiet minutes are the ones that run on time. */
export const config = { schedule: '17 4 * * 1' };

const QUIET_MS = 6 * 60 * 60 * 1000;
const KEY = 'backup/last';

const chf = (rappen) => `CHF ${(rappen / 100).toFixed(2)}`;

/** True if enough time has passed since the last one. The timestamp is
    written as part of the same conditional write that reads it, so two
    requests arriving together cannot both come away with a yes. */
async function dueNow(now = Date.now()) {
  let allowed = false;
  await mutate(KEY, (cur) => {
    if (cur && cur.at && now - cur.at < QUIET_MS) return null;   // leave it be
    allowed = true;
    return { at: now };
  });
  return allowed;
}

export async function runBackup({ force = false, now = Date.now() } = {}) {
  if (!force && !(await dueNow(now))) {
    return { ok: false, reason: 'too-soon' };
  }

  const inbox = shopInbox();
  if (!inbox) {
    console.error('[backup] MAIL_TO is not set; nowhere to send it');
    return { ok: false, reason: 'no-inbox' };
  }

  const data = await takeBackup();
  const json = JSON.stringify(data, null, 2);
  const stamp = new Date(now).toISOString().slice(0, 10);

  const outstanding = data.giftCards.reduce((t, c) => {
    const spent = Object.values(c.spends || {}).reduce((x, v) => x + v.amount, 0);
    return t + Math.max(0, c.issued - spent);
  }, 0);

  /* The numbers that matter are in the mail itself, so the shop can see at a
     glance whether anything moved without opening the file. */
  const text = [
    `ZUNO backup — ${stamp}`,
    '',
    `Gift cards        ${data.giftCards.length}`,
    `Outstanding       ${chf(outstanding)}   (money still owed on them)`,
    `Accounts          ${data.accounts.length}`,
    `Stock records     ${data.stock.length}`,
    `File              ${(json.length / 1024).toFixed(1)} KB`,
    '',
    'The attachment is the whole ledger, with password derivations stripped.',
    'Keep it somewhere other than Netlify — a copy beside the thing it copies',
    'is not a backup. BACKOFFICE.md says how to put one back.',
  ].join('\n');

  const r = await send({
    to: inbox,
    subject: `ZUNO backup ${stamp} — ${chf(outstanding)} outstanding`,
    text,
    attachments: [{
      filename: `zuno-backup-${stamp}.json`,
      content: Buffer.from(json, 'utf8').toString('base64'),
      type: 'application/json',
    }],
  });

  if (!r.sent) {
    console.error(`[backup:unsent] ${r.error}`);
    return { ok: false, reason: 'mail', error: r.error, bytes: json.length };
  }
  console.log(`[backup:sent] ${stamp} ${data.giftCards.length} card(s), ` +
    `${data.accounts.length} account(s), ${chf(outstanding)} outstanding`);
  return { ok: true, bytes: json.length, outstanding };
}

export default async function handler(req) {
  const problem = tokenProblem();
  /* No token configured is not a reason to skip the backup — the schedule
     still runs — but it does mean nobody can ask for one by hand. */
  let forced = false;
  if (!problem) {
    const given = req.headers.get('x-admin-token')
      || (new URL(req.url).searchParams.get('token'));
    forced = tokenMatches(given);
  }

  try {
    const r = await runBackup({ force: forced });
    /* Never the data, and never a reason precise enough to probe with. */
    return new Response(JSON.stringify({ ok: r.ok, reason: r.reason || null }), {
      status: r.ok ? 200 : 202,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    console.error('[backup:failed]', e && e.message);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
}

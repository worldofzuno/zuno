/**
 * What the shop may sell right now, for the product page.
 *
 *   GET /.netlify/functions/stock-levels
 *   -> { "castano-200g": 7, "castano-500g": null }
 *
 * `null` means no limit is set for that size, which is the state every size
 * is in until someone sets a number.
 *
 * Read-only and public: a count of coffee bags is not a secret, and the page
 * needs it before anyone has done anything. It is also only a courtesy — the
 * checkout holds and checks the shelf for itself, so a stale number here
 * costs a clear error at the till rather than an oversold bag.
 */

import { levels } from './lib/stock.mjs';

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'GET only' }), { status: 405 });
  }

  let body;
  try {
    body = await levels();
  } catch (e) {
    /* A shelf nobody can read is not an unlimited shelf. This used to answer
       `null` for every size, which is the same answer as "no limit set" — so
       a shop whose store had fallen over offered everything, including the
       sizes it had none of. Saying nothing is the honest answer: the page
       leaves its counts as they were, and the checkout refuses for itself. */
    console.error('stock-levels failed:', e && e.message);
    return new Response(JSON.stringify({ error: 'unknown' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      /* Short, not none: the page asks on load, and a count that is thirty
         seconds old is fine when the checkout is the one that decides. */
      'cache-control': 'public, max-age=30',
    },
  });
}

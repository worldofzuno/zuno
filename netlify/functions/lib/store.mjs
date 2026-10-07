/**
 * The little bit of state this shop has.
 *
 * Netlify functions are stateless, so anything that has to be remembered
 * between two requests — a gift card balance, an account — lives here.
 * Netlify Blobs is the backing store: it comes with the hosting that is
 * already paid for, needs no second account, and supports the one thing a
 * balance cannot do without, which is a conditional write.
 *
 * Why conditional writes matter: two browsers redeeming the same gift card at
 * the same moment both read a balance of CHF 50 and both write CHF 0, and the
 * card has paid for CHF 100 of coffee. `update` therefore takes the ETag the
 * value was read with and fails if anything changed in between, and `mutate`
 * retries the whole read-decide-write cycle when it does.
 *
 * Outside Netlify — in the tests, and under a bare `node` — there is no Blobs
 * environment, so the same interface runs against a map in memory. That is
 * not a second implementation of the logic, only a second place to put bytes.
 */

const STORE = 'zuno';

/* --------------------------------------------------------- in memory --- */

/** Mirrors the ETag semantics, so the tests exercise the same code paths. */
function memoryStore() {
  const data = new Map();
  let seq = 0;
  const tag = () => `"mem-${++seq}"`;
  return {
    kind: 'memory',
    async read(key) {
      const row = data.get(key);
      return row ? { value: structuredClone(row.value), etag: row.etag } : { value: null, etag: null };
    },
    async create(key, value) {
      if (data.has(key)) return false;
      data.set(key, { value: structuredClone(value), etag: tag() });
      return true;
    },
    async update(key, value, etag) {
      const row = data.get(key);
      if (!row || row.etag !== etag) return false;
      data.set(key, { value: structuredClone(value), etag: tag() });
      return true;
    },
    async remove(key) { data.delete(key); },
    async list(prefix = '') {
      return [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}

/* ------------------------------------------------------ Netlify Blobs --- */

function blobStore(blobs) {
  return {
    kind: 'blobs',
    async read(key) {
      /* Strong consistency, because every read here is the first half of a
         read-decide-write. An eventually consistent read would hand out a
         balance that has already been spent. */
      const res = await blobs.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      return res ? { value: res.data, etag: res.etag || null } : { value: null, etag: null };
    },
    async create(key, value) {
      const r = await blobs.setJSON(key, value, { onlyIfNew: true });
      return r.modified === true;
    },
    async update(key, value, etag) {
      const r = await blobs.setJSON(key, value, { onlyIfMatch: etag });
      return r.modified === true;
    },
    async remove(key) { await blobs.delete(key); },
    async list(prefix = '') {
      const { blobs: found } = await blobs.list({ prefix, paginate: false });
      return found.map((b) => b.key).sort();
    },
  };
}

/* ------------------------------------------------------------- facade --- */

let cached = null;

/* Said once per instance, because `store()` is called on every request and
   a shop that cannot reach its store would otherwise mail on each one. */
let shouted = false;

/**
 * Mail, without going through the store.
 *
 * The usual alarm throttles itself with a conditional write, which needs
 * the very thing that has just failed — calling it here would recurse
 * until the stack gave out. So this one sends and does not count.
 */
async function shout(detail) {
  console.error(`[alarm] the store is unreachable: ${detail}`);
  if (shouted) return;
  shouted = true;
  try {
    const { send, shopInbox } = await import('./mailer.mjs');
    const to = shopInbox();
    if (!to) return;
    await send({
      to,
      subject: 'ZUNO: the store is unreachable',
      text: [
        'Netlify Blobs could not be reached, so this instance of the shop has',
        'no gift card balances, no accounts and no stock counts.',
        '',
        'Nothing is being served from memory instead: the checkout answers',
        'that it cannot start, and Stripe is asked to deliver its webhooks',
        'again rather than being told an order was handled.',
        '',
        `What it said: ${detail}`,
      ].join('\n'),
    });
  } catch (e) {
    /* Nothing left to try. The log line above is the record. */
    console.error(`[alarm:undeliverable] ${e && e.message}`);
  }
}

/**
 * The store for this process. Netlify Blobs where it exists, memory where it
 * does not — and it says which, so a caller that must not run against memory
 * can refuse.
 *
 * On Netlify there is no "where it does not". Standing in a map in memory
 * for a store that holds money looked like resilience and was the opposite:
 * every gift card read as "not valid", every size read as unlimited, and a
 * card minted for a customer who had paid disappeared with the instance —
 * all of it behind a warning in a log nobody was watching. Failing is the
 * kinder answer. The checkout then says it cannot start, and the webhook
 * returns a 500 so Stripe delivers the order again later.
 */
export async function store() {
  if (cached) return cached;
  try {
    const { getStore } = await import('@netlify/blobs');
    cached = blobStore(getStore({ name: STORE, consistency: 'strong' }));
  } catch (e) {
    const said = (e && e.message) || 'unknown error';
    if (process.env.NETLIFY) {
      await shout(said);
      throw new Error(`store: Netlify Blobs is unreachable: ${said}`);
    }
    /* No Blobs environment: a test, or `node` on a laptop. Not an error, but
       worth saying once, because data written here does not outlive the
       process. */
    console.warn('store: no Netlify Blobs environment, keeping state in memory:', said);
    cached = memoryStore();
  }
  return cached;
}

/** Only for the tests, which need a clean store per case. */
export function useMemoryStore() {
  cached = memoryStore();
  return cached;
}

export function resetStore() {
  cached = null;
}

/**
 * Read, decide, write — and start over if someone else wrote first.
 *
 * `decide` receives the current value (null when the key is new) and returns
 * either the next value, or null to leave it alone. It may be called more
 * than once, so it must not have side effects of its own.
 *
 * Throws after `attempts` collisions rather than looping, because a key that
 * is contended that heavily is a bug worth hearing about.
 */
export async function mutate(key, decide, attempts = 5) {
  const s = await store();
  for (let i = 0; i < attempts; i++) {
    const { value, etag } = await s.read(key);
    const next = await decide(value);
    if (next === null || next === undefined) return { ok: false, value, reason: 'unchanged' };

    const written = value === null
      ? await s.create(key, next)
      : await s.update(key, next, etag);
    if (written) return { ok: true, value: next };
  }
  throw new Error(`store: ${key} changed under us ${attempts} times running`);
}

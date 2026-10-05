/**
 * Checks on the store, run with:
 *
 *     node --test tests/functions/store.test.mjs
 *
 * The point of these is one thing: a conditional write must actually be
 * conditional. Everything a balance depends on rests on `update` refusing a
 * stale ETag, so that is what is tested hardest.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useMemoryStore, mutate } = await import('../../netlify/functions/lib/store.mjs');

test('a key that was never written reads as nothing', async () => {
  const s = useMemoryStore();
  assert.deepEqual(await s.read('nope'), { value: null, etag: null });
});

test('what goes in comes back out', async () => {
  const s = useMemoryStore();
  assert.equal(await s.create('a', { n: 1 }), true);
  const { value, etag } = await s.read('a');
  assert.deepEqual(value, { n: 1 });
  assert.ok(etag);
});

test('create refuses to overwrite', async () => {
  const s = useMemoryStore();
  assert.equal(await s.create('a', { n: 1 }), true);
  assert.equal(await s.create('a', { n: 2 }), false);
  assert.deepEqual((await s.read('a')).value, { n: 1 });
});

test('update needs the ETag the value was read with', async () => {
  const s = useMemoryStore();
  await s.create('a', { n: 1 });
  const first = await s.read('a');

  assert.equal(await s.update('a', { n: 2 }, first.etag), true);
  // the old ETag is now stale and must be refused
  assert.equal(await s.update('a', { n: 99 }, first.etag), false);
  assert.deepEqual((await s.read('a')).value, { n: 2 });
});

test('the stored value is a copy, not a handle on ours', async () => {
  const s = useMemoryStore();
  const mine = { n: 1, deep: { x: 1 } };
  await s.create('a', mine);
  mine.n = 2;
  mine.deep.x = 2;
  assert.deepEqual((await s.read('a')).value, { n: 1, deep: { x: 1 } });
});

test('listing is by prefix and in order', async () => {
  const s = useMemoryStore();
  await s.create('gift/B', 1);
  await s.create('gift/A', 1);
  await s.create('other/C', 1);
  assert.deepEqual(await s.list('gift/'), ['gift/A', 'gift/B']);
});

test('remove is gone, and removing nothing is fine', async () => {
  const s = useMemoryStore();
  await s.create('a', 1);
  await s.remove('a');
  await s.remove('a');
  assert.equal((await s.read('a')).value, null);
});

/* -------------------------------------------------------------- mutate */

test('mutate writes what the decision returns', async () => {
  useMemoryStore();
  const r = await mutate('k', (cur) => ({ n: (cur ? cur.n : 0) + 1 }));
  assert.deepEqual(r, { ok: true, value: { n: 1 } });
  const r2 = await mutate('k', (cur) => ({ n: cur.n + 1 }));
  assert.deepEqual(r2.value, { n: 2 });
});

test('returning nothing leaves the value alone', async () => {
  const s = useMemoryStore();
  await mutate('k', () => ({ n: 1 }));
  const r = await mutate('k', () => null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unchanged');
  assert.deepEqual((await s.read('k')).value, { n: 1 });
});

test('a write that lands first makes us read again and win on the retry', async () => {
  const s = useMemoryStore();
  await s.create('k', { n: 0 });

  /* The first decision is interrupted: someone else writes between our read
     and our write. Without the ETag check this would lose their increment. */
  let calls = 0;
  const r = await mutate('k', async (cur) => {
    calls++;
    if (calls === 1) await s.update('k', { n: 100 }, (await s.read('k')).etag);
    return { n: cur.n + 1 };
  });

  assert.equal(calls, 2, 'the decision must be made again on the fresh value');
  assert.deepEqual(r.value, { n: 101 }, 'the other write must not be lost');
});

test('two increments racing both land', async () => {
  const s = useMemoryStore();
  await s.create('k', { n: 0 });
  await Promise.all(
    Array.from({ length: 5 }, () => mutate('k', (cur) => ({ n: cur.n + 1 })))
  );
  assert.deepEqual((await s.read('k')).value, { n: 5 });
});

test('a key under permanent contention throws rather than spinning', async () => {
  const s = useMemoryStore();
  await s.create('k', { n: 0 });
  await assert.rejects(
    () => mutate('k', async (cur) => {
      // always write underneath ourselves, so no attempt can ever succeed
      await s.update('k', { n: cur.n + 100 }, (await s.read('k')).etag);
      return { n: cur.n + 1 };
    }, 3),
    /changed under us 3 times/
  );
});

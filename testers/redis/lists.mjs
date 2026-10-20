import { R } from '../../lib/protocols/resp.mjs';
import { word, words, randInt, key } from '../../lib/harness/random.mjs';
import { RedisClient } from './client.mjs';
import { startServer } from './base.mjs';

// LRANGE semantics, used to compute expected responses.
function lrange(list, start, stop) {
  const n = list.length;
  if (start < 0) start = Math.max(n + start, 0);
  if (stop < 0) stop = n + stop;
  if (start >= n || start > stop) return [];
  return list.slice(start, Math.min(stop, n - 1) + 1);
}

export const stages = {
  async mh6(t) {
    const { client } = await startServer(t);
    await client.check(['RPUSH', key(), word()], R.int(1));
  },

  async tn7(t) {
    const { client } = await startServer(t);
    const k = key();
    const items = words(randInt(2, 4));
    for (let i = 0; i < items.length; i++) await client.check(['RPUSH', k, items[i]], R.int(i + 1));
  },

  async lx4(t) {
    const { client } = await startServer(t);
    const k = key();
    const first = words(3), second = words(2);
    await client.check(['RPUSH', k, ...first], R.int(3));
    await client.check(['RPUSH', k, ...second], R.int(5));
  },

  async sf6(t) {
    const { client } = await startServer(t);
    const k = key();
    const list = words(randInt(4, 7));
    await client.check(['RPUSH', k, ...list], R.int(list.length));
    const cases = [[0, 1], [0, list.length - 1], [1, 2], [2, list.length + 5], [list.length, list.length + 2], [3, 1]];
    for (const [a, b] of cases) await client.check(['LRANGE', k, String(a), String(b)], R.array(lrange(list, a, b)));
    await client.check(['LRANGE', `missing_${key()}`, '0', '1'], R.array([]));
  },

  async ri1(t) {
    const { client } = await startServer(t);
    const k = key();
    const list = words(randInt(4, 7));
    await client.check(['RPUSH', k, ...list], R.int(list.length));
    const n = list.length;
    const cases = [[0, -1], [-2, -1], [-n, 1], [-(n + 3), -2], [1, -2], [-1, -3]];
    for (const [a, b] of cases) await client.check(['LRANGE', k, String(a), String(b)], R.array(lrange(list, a, b)));
  },

  async gu5(t) {
    const { client } = await startServer(t);
    const k = key();
    const [c, b, a] = words(3);
    await client.check(['LPUSH', k, c], R.int(1));
    await client.check(['LPUSH', k, b, a], R.int(3));
    await client.check(['LRANGE', k, '0', '-1'], R.array([a, b, c]));
  },

  async fv6(t) {
    const { client } = await startServer(t);
    const k = key();
    const list = words(randInt(2, 8));
    await client.check(['RPUSH', k, ...list], R.int(list.length));
    await client.check(['LLEN', k], R.int(list.length));
    await client.check(['LLEN', `missing_${key()}`], R.int(0));
  },

  async ef1(t) {
    const { client } = await startServer(t);
    const k = key();
    const list = words(randInt(3, 6));
    await client.check(['RPUSH', k, ...list], R.int(list.length));
    await client.check(['LPOP', k], R.bulk(list[0]));
    await client.check(['LRANGE', k, '0', '-1'], R.array(list.slice(1)));
    await client.check(['LPOP', `missing_${key()}`], R.nullBulk());
  },

  async jp1(t) {
    const { client } = await startServer(t);
    const k = key();
    const list = words(randInt(4, 7));
    const n = randInt(2, list.length - 1);
    await client.check(['RPUSH', k, ...list], R.int(list.length));
    await client.check(['LPOP', k, String(n)], R.array(list.slice(0, n)));
    await client.check(['LRANGE', k, '0', '-1'], R.array(list.slice(n)));
    await client.check(['LPOP', k, String(list.length + 5)], R.array(list.slice(n)));
  },

  async ec3(t) {
    const { proc, clients } = await startServer(t, [], { clients: 2 });
    const [blocker, pusher] = clients;
    const k = key(), v = word();
    blocker.send('BLPOP', k, '0');
    await blocker.expectNothing(300, 'BLPOP to block until an element is pushed');
    await pusher.check(['RPUSH', k, v], R.int(1));
    await blocker.expect(R.array([k, v]));

    // First blocked client is served first.
    const names = ['client-3', 'client-4', 'client-5'];
    const waiters = [];
    for (const name of names) waiters.push(await RedisClient.connect(t, { proc, name }));
    const k2 = key(), v2 = word();
    for (const w of waiters) { w.send('BLPOP', k2, '0'); await t.sleep(50); }
    await pusher.check(['RPUSH', k2, v2], R.int(1));
    await waiters[0].expect(R.array([k2, v2]));
    await waiters[1].expectNothing(300, 'client-4 to remain blocked');
    await waiters[2].expectNothing(10, 'client-5 to remain blocked');
  },

  async xj7(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    const [blocker, pusher] = clients;
    const k = key();
    const started = Date.now();
    blocker.send('BLPOP', k, '0.1');
    await blocker.expect(R.nullArray(), { timeout: 2000 });
    const elapsed = Date.now() - started;
    t.assert(elapsed >= 90, `BLPOP with timeout 0.1 returned after ${elapsed}ms; expected it to block for ~100ms`);

    const k2 = key(), v = word();
    blocker.send('BLPOP', k2, '2');
    await blocker.expectNothing(200, 'BLPOP to block');
    await pusher.check(['RPUSH', k2, v], R.int(1));
    await blocker.expect(R.array([k2, v]));
  },
};

export { lrange };

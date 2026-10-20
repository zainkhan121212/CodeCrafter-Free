import { R, show } from '../../lib/protocols/resp.mjs';
import { randInt, key } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';

const n = () => String(randInt(1, 999));

// Client 1 sets two keys, watches `watch` of them and queues a write; returns the keys and values.
async function watchAndQueue(c1, keys, watched) {
  const vals = keys.map(() => n());
  for (const [i, k] of keys.entries()) await c1.check(['SET', k, vals[i]], R.simple('OK'));
  await c1.check(['WATCH', ...watched], R.simple('OK'));
  await c1.check(['MULTI'], R.simple('OK'));
  return vals;
}

export const stages = {
  async jb7(t) {
    const { client } = await startServer(t);
    await client.check(['WATCH', key()], R.simple('OK'));
    await client.check(['PING'], R.simple('PONG'));
  },

  async jq9(t) {
    const { client } = await startServer(t);
    await client.check(['MULTI'], R.simple('OK'));
    const reply = await client.command('WATCH', key());
    const msg = reply.type === 'error' ? reply.value : '';
    if (!['ERR', 'WATCH', 'inside MULTI', 'not allowed'].every(w => msg.includes(w))) t.fail(`Expected an error like "ERR WATCH inside MULTI is not allowed", got ${show(reply)}`);
    t.log.success(`✔︎ Received ${show(reply)}`);
  },

  async mh8(t) {
    const { clients } = await startServer(t, [], { clients: 4 });
    const [c1, c2, c3, c4] = clients;
    const [foo, bar] = [key(), `${key()}_b`];
    const [, barVal] = await watchAndQueue(c1, [foo, bar], [foo]);
    await c1.check(['SET', bar, n()], R.simple('QUEUED'));
    await c2.check(['SET', foo, n()], R.simple('OK'));
    await c1.check(['EXEC'], R.nullArray());
    await c1.check(['GET', bar], R.bulk(barVal));

    const [baz, caz] = [`${key()}_c`, `${key()}_d`];
    await watchAndQueue(c3, [baz, caz], [baz]);
    const newCaz = n();
    await c3.check(['SET', caz, newCaz], R.simple('QUEUED'));
    await c4.check(['SET', caz, n()], R.simple('OK'));
    await c3.check(['EXEC'], R.array([R.simple('OK')]));
    await c4.check(['GET', caz], R.bulk(newCaz));
  },

  async fp0(t) {
    const { clients: [c1, c2] } = await startServer(t, [], { clients: 2 });
    const [foo, bar] = [key(), `${key()}_b`];
    const [, barVal] = await watchAndQueue(c1, [foo, bar], [foo, bar]);
    await c1.check(['SET', bar, n()], R.simple('QUEUED'));
    await c2.check(['SET', foo, n()], R.simple('OK'));
    await c1.check(['EXEC'], R.nullArray());
    await c2.check(['GET', bar], R.bulk(barVal));
  },

  async uo9(t) {
    const { clients: [c1, c2] } = await startServer(t, [], { clients: 2 });
    const foo = key(), v = n();
    await c1.check(['WATCH', foo], R.simple('OK'));
    await c2.check(['SET', foo, v], R.simple('OK'));
    await c1.check(['MULTI'], R.simple('OK'));
    await c1.check(['SET', foo, n()], R.simple('QUEUED'));
    await c1.check(['EXEC'], R.nullArray());
    await c1.check(['GET', foo], R.bulk(v));
  },

  async bn1(t) {
    const { clients: [c1, c2] } = await startServer(t, [], { clients: 2 });
    const [foo, bar] = [key(), `${key()}_b`];
    for (const k of [foo, bar]) await c1.check(['SET', k, n()], R.simple('OK'));
    await c1.check(['WATCH', foo, bar], R.simple('OK'));
    await c2.check(['SET', foo, n()], R.simple('OK'));
    await c1.check(['UNWATCH'], R.simple('OK'));
    await c1.check(['MULTI'], R.simple('OK'));
    const v = n();
    await c1.check(['SET', foo, v], R.simple('QUEUED'));
    await c1.check(['EXEC'], R.array([R.simple('OK')]));
    await c2.check(['GET', foo], R.bulk(v));
    await c2.check(['UNWATCH'], R.simple('OK'));
  },

  async fn4(t) {
    const { clients: [c1, c2] } = await startServer(t, [], { clients: 2 });
    const [foo, bar] = [key(), `${key()}_b`];
    await watchAndQueue(c1, [foo, bar], [foo]);
    await c1.check(['SET', bar, n()], R.simple('QUEUED'));
    await c2.check(['SET', foo, n()], R.simple('OK'));
    await c1.check(['EXEC'], R.nullArray());
    const v = n();
    await c1.check(['MULTI'], R.simple('OK'));
    await c1.check(['SET', bar, v], R.simple('QUEUED'));
    await c1.check(['EXEC'], R.array([R.simple('OK')]));
    await c2.check(['GET', bar], R.bulk(v));
  },

  async hq1(t) {
    const { clients: [c1, c2] } = await startServer(t, [], { clients: 2 });
    const [foo, bar] = [key(), `${key()}_b`];
    await watchAndQueue(c1, [foo, bar], [foo, bar]);
    await c1.check(['SET', bar, n()], R.simple('QUEUED'));
    await c2.check(['SET', foo, n()], R.simple('OK'));
    await c1.check(['DISCARD'], R.simple('OK'));
    const v = n();
    await c1.check(['MULTI'], R.simple('OK'));
    await c1.check(['SET', bar, v], R.simple('QUEUED'));
    await c1.check(['EXEC'], R.array([R.simple('OK')]));
    await c2.check(['GET', bar], R.bulk(v));
  },
};

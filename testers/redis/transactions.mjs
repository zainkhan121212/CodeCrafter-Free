import { R } from '../../lib/protocols/resp.mjs';
import { word, randInt, key } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';

const NOT_INT = 'ERR value is not an integer or out of range';

export const stages = {
  async si4(t) {
    const { client } = await startServer(t);
    const k = key(), n = randInt(1, 100);
    await client.check(['SET', k, String(n)], R.simple('OK'));
    await client.check(['INCR', k], R.int(n + 1));
    await client.check(['INCR', k], R.int(n + 2));
    await client.check(['GET', k], R.bulk(String(n + 2)));
  },

  async lz8(t) {
    const { client } = await startServer(t);
    const [a, b] = [key(), `${key()}_2`];
    await client.check(['INCR', a], R.int(1));
    await client.check(['INCR', a], R.int(2));
    await client.check(['INCR', b], R.int(1));
  },

  async mk1(t) {
    const { client } = await startServer(t);
    const k = key();
    await client.check(['SET', k, word()], R.simple('OK'));
    await client.check(['INCR', k], R.error(NOT_INT));
  },

  async pn0(t) {
    const { client } = await startServer(t);
    await client.check(['MULTI'], R.simple('OK'));
  },

  async lo4(t) {
    const { client } = await startServer(t);
    await client.check(['EXEC'], R.error('ERR EXEC without MULTI'));
  },

  async we1(t) {
    const { client } = await startServer(t);
    await client.check(['MULTI'], R.simple('OK'));
    await client.check(['EXEC'], R.array([]));
    await client.check(['EXEC'], R.error('ERR EXEC without MULTI'));
  },

  async rs9(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    const [tx, other] = clients;
    const k = key();
    await tx.check(['MULTI'], R.simple('OK'));
    await tx.check(['SET', k, String(randInt(1, 100))], R.simple('QUEUED'));
    await tx.check(['INCR', k], R.simple('QUEUED'));
    await other.check(['GET', k], R.nullBulk());
  },

  async fy6(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    const [tx, other] = clients;
    const [a, b] = [key(), `${key()}_2`];
    const n = randInt(1, 100);
    await tx.check(['MULTI'], R.simple('OK'));
    await tx.check(['SET', a, String(n)], R.simple('QUEUED'));
    await tx.check(['INCR', a], R.simple('QUEUED'));
    await tx.check(['INCR', b], R.simple('QUEUED'));
    await tx.check(['GET', b], R.simple('QUEUED'));
    await tx.check(['EXEC'], R.array([R.simple('OK'), R.int(n + 1), R.int(1), R.bulk('1')]));
    await other.check(['GET', a], R.bulk(String(n + 1)));
  },

  async rl9(t) {
    const { client } = await startServer(t);
    const k = key();
    await client.check(['MULTI'], R.simple('OK'));
    await client.check(['SET', k, String(randInt(1, 100))], R.simple('QUEUED'));
    await client.check(['INCR', k], R.simple('QUEUED'));
    await client.check(['DISCARD'], R.simple('OK'));
    await client.check(['GET', k], R.nullBulk());
    await client.check(['DISCARD'], R.error('ERR DISCARD without MULTI'));
  },

  async sg9(t) {
    const { client } = await startServer(t);
    const [a, b] = [key(), `${key()}_2`];
    const v = word(), n = randInt(1, 100);
    await client.check(['SET', a, v], R.simple('OK'));
    await client.check(['SET', b, String(n)], R.simple('OK'));
    await client.check(['MULTI'], R.simple('OK'));
    await client.check(['INCR', a], R.simple('QUEUED'));
    await client.check(['INCR', b], R.simple('QUEUED'));
    await client.check(['EXEC'], R.array([R.error(NOT_INT), R.int(n + 1)]));
    await client.check(['GET', a], R.bulk(v));
    await client.check(['GET', b], R.bulk(String(n + 1)));
  },

  async jf8(t) {
    const { clients } = await startServer(t, [], { clients: 3 });
    const k = key();
    for (const c of clients) await c.check(['MULTI'], R.simple('OK'));
    for (const c of clients) await c.check(['INCR', k], R.simple('QUEUED'));
    let expected = 1;
    for (const c of [clients[2], clients[0], clients[1]]) await c.check(['EXEC'], R.array([R.int(expected++)]));
  },
};

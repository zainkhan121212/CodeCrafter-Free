import { RedisClient } from './client.mjs';
import { R } from '../../lib/protocols/resp.mjs';
import { word, randInt, key } from '../../lib/harness/random.mjs';

// Starts the learner's server and opens one client connection.
export async function startServer(t, args = [], { clients = 1, port = 6379, names = null } = {}) {
  const proc = t.spawn(args);
  const list = [];
  for (let i = 0; i < clients; i++) {
    list.push(await RedisClient.connect(t, { port, proc, name: names ? names[i] : clients > 1 ? `client-${i + 1}` : null }));
  }
  return { proc, client: list[0], clients: list };
}

export const stages = {
  async jm1(t) {
    const proc = t.spawn();
    t.log.info('Connecting to port 6379...');
    await RedisClient.connect(t, { proc });
    t.log.success('Connection successful');
  },

  async rg2(t) {
    const { client } = await startServer(t);
    await client.check(['PING'], R.simple('PONG'));
  },

  async wy1(t) {
    const { client } = await startServer(t);
    const n = randInt(2, 4);
    for (let i = 0; i < n; i++) await client.check(['PING'], R.simple('PONG'));
  },

  async zu2(t) {
    const { clients } = await startServer(t, [], { clients: 3 });
    // Interleave requests across connections so a server handling one client at a time fails.
    await clients[0].check(['PING'], R.simple('PONG'));
    await clients[1].check(['PING'], R.simple('PONG'));
    await clients[0].check(['PING'], R.simple('PONG'));
    await clients[1].check(['PING'], R.simple('PONG'));
    await clients[2].check(['PING'], R.simple('PONG'));
    clients[0].close();
    t.log.info('client-1: connection closed');
    await clients[1].check(['PING'], R.simple('PONG'));
    await clients[2].check(['PING'], R.simple('PONG'));
  },

  async qq0(t) {
    const { client } = await startServer(t);
    const msg = word();
    await client.check(['ECHO', msg], R.bulk(msg));
    const msg2 = `${word()} ${word()}`;
    await client.check(['echo', msg2], R.bulk(msg2));
  },

  async la7(t) {
    const { client } = await startServer(t);
    const [k, v] = [key(), word()];
    await client.check(['SET', k, v], R.simple('OK'));
    await client.check(['GET', k], R.bulk(v));
    const [k2, v2] = [key(), `${word()} ${word()}`];
    await client.check(['set', k2, v2], R.simple('OK'));
    await client.check(['get', k2], R.bulk(v2));
    await client.check(['GET', `missing_${key()}`], R.nullBulk());
  },

  async yz1(t) {
    const { client } = await startServer(t);
    const [k, v] = [key(), word()];
    const px = randInt(100, 200);
    await client.check(['SET', k, v, 'px', String(px)], R.simple('OK'));
    await client.check(['GET', k], R.bulk(v));
    t.log.info(`Sleeping for ${px + 100}ms`);
    await t.sleep(px + 100);
    await client.check(['GET', k], R.nullBulk());
    // A key without expiry must survive.
    const [k2, v2] = [key(), word()];
    await client.check(['SET', k2, v2], R.simple('OK'));
    const [k3, v3] = [key(), word()];
    await client.check(['SET', k3, v3, 'EX', '1'], R.simple('OK'));
    await client.check(['GET', k3], R.bulk(v3));
    await t.sleep(150);
    await client.check(['GET', k2], R.bulk(v2));
  },
};


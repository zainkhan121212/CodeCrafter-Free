import { R, show } from '../../lib/protocols/resp.mjs';
import { word, words, randInt } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';

const sub = (channel, count) => R.array([R.bulk('subscribe'), R.bulk(channel), R.int(count)]);
const message = (channel, msg) => R.array(['message', channel, msg]);

export const stages = {
  async mx3(t) {
    const { client } = await startServer(t);
    const ch = word();
    await client.check(['SUBSCRIBE', ch], sub(ch, 1));
  },

  async zc8(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    for (const c of clients) {
      const chans = words(randInt(2, 4));
      for (const [i, ch] of chans.entries()) await c.check(['SUBSCRIBE', ch], sub(ch, i + 1));
      await c.check(['SUBSCRIBE', chans[0]], sub(chans[0], chans.length));
    }
  },

  async aw8(t) {
    const { client } = await startServer(t);
    const [a, b] = words(2);
    await client.check(['SUBSCRIBE', a], sub(a, 1));
    for (const cmd of [['SET', word(), word()], ['GET', word()], ['ECHO', word()]]) {
      const reply = await client.command(...cmd);
      const ok = reply.type === 'error' && reply.value.toLowerCase().startsWith(`err can't execute '${cmd[0].toLowerCase()}'`);
      if (!ok) t.fail(`Expected an error starting with "ERR Can't execute '${cmd[0].toLowerCase()}'", got ${show(reply)}`);
      t.log.success(`✔︎ Received ${show(reply)}`);
    }
    await client.check(['SUBSCRIBE', b], sub(b, 2));
  },

  async lf1(t) {
    const { clients: [subscriber, other] } = await startServer(t, [], { clients: 2 });
    const ch = word();
    await subscriber.check(['SUBSCRIBE', ch], sub(ch, 1));
    await subscriber.check(['PING'], R.array(['pong', '']));
    await other.check(['PING'], R.simple('PONG'));
  },

  async hf2(t) {
    const { clients } = await startServer(t, [], { clients: 4 });
    const [c1, c2, c3, publisher] = clients;
    const [foo, bar] = words(2);
    await c1.check(['SUBSCRIBE', foo], sub(foo, 1));
    await c2.check(['SUBSCRIBE', bar], sub(bar, 1));
    await c3.check(['SUBSCRIBE', bar], sub(bar, 1));
    await publisher.check(['PUBLISH', bar, word()], R.int(2));
    await publisher.check(['PUBLISH', foo, word()], R.int(1));
    await publisher.check(['PUBLISH', `nobody_${word()}`, word()], R.int(0));
  },

  async dn4(t) {
    const { clients } = await startServer(t, [], { clients: 4 });
    const [c1, c2, c3, publisher] = clients;
    const [foo, bar] = words(2);
    await c1.check(['SUBSCRIBE', foo], sub(foo, 1));
    await c2.check(['SUBSCRIBE', foo], sub(foo, 1));
    await c3.check(['SUBSCRIBE', bar], sub(bar, 1));
    const m1 = word(), m2 = word();
    await publisher.check(['PUBLISH', foo, m1], R.int(2));
    await c1.expect(message(foo, m1));
    await c2.expect(message(foo, m1));
    await c3.expectNothing(200, 'no message on a channel it did not subscribe to');
    await publisher.check(['PUBLISH', bar, m2], R.int(1));
    await c3.expect(message(bar, m2));
    await c1.expectNothing(200, 'no message on a channel it did not subscribe to');
  },

  async ze9(t) {
    const { clients } = await startServer(t, [], { clients: 3 });
    const [c1, c2, publisher] = clients;
    const [foo, bar, baz] = words(3);
    await c1.check(['SUBSCRIBE', foo], sub(foo, 1));
    await c1.check(['SUBSCRIBE', baz], sub(baz, 2));
    await c2.check(['SUBSCRIBE', foo], sub(foo, 1));
    await c2.check(['SUBSCRIBE', bar], sub(bar, 2));
    const before = `before-${word()}`;
    await publisher.check(['PUBLISH', foo, before], R.int(2));
    await c1.expect(message(foo, before));
    await c2.expect(message(foo, before));
    const reply = await c1.command('UNSUBSCRIBE', foo);
    const v = reply.value;
    const ok = reply.type === 'array' && v?.length === 3 && ['unsubscribe', 'unsubscribed'].includes(v[0].value) && v[1].value === foo && v[2].value === 1;
    if (!ok) t.fail(`Expected ${show(R.array([R.bulk('unsubscribe'), R.bulk(foo), R.int(1)]))}, got ${show(reply)}`);
    t.log.success(`client-1: ✔︎ Received ${show(reply)}`);
    const after = `after-${word()}`;
    await publisher.check(['PUBLISH', foo, after], R.int(1));
    await c2.expect(message(foo, after));
    await c1.expectNothing(200, 'no message after unsubscribing');
    const third = word();
    await publisher.check(['PUBLISH', baz, third], R.int(1));
    await c1.expect(message(baz, third));
  },
};

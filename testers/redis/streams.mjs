import { R } from '../../lib/protocols/resp.mjs';
import { word, randInt, key } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';

const entry = (id, fields) => R.array([id, R.array(fields)]);
const streamsReply = streams => R.array(streams.map(([k, entries]) => R.array([k, R.array(entries.map(([id, f]) => entry(id, f)))])));
const field = () => [word(), String(randInt(1, 100))];
const ERR_SMALLER = 'ERR The ID specified in XADD is equal or smaller than the target stream top item';
const ERR_ZERO = 'ERR The ID specified in XADD must be greater than 0-0';

export const stages = {
  async cc3(t) {
    const { client } = await startServer(t);
    const k = key();
    await client.check(['SET', k, word()], R.simple('OK'));
    await client.check(['TYPE', k], R.simple('string'));
    await client.check(['TYPE', `missing_${key()}`], R.simple('none'));
  },

  async cf6(t) {
    const { client } = await startServer(t);
    const k = key(), id = `0-${randInt(1, 9)}`;
    await client.check(['XADD', k, id, ...field()], R.bulk(id));
    await client.check(['TYPE', k], R.simple('stream'));
    const s = key();
    await client.check(['SET', s, word()], R.simple('OK'));
    await client.check(['TYPE', s], R.simple('string'));
  },

  async hq8(t) {
    const { client } = await startServer(t);
    const k = key();
    const ms = randInt(1, 9);
    await client.check(['XADD', k, `${ms}-1`, ...field()], R.bulk(`${ms}-1`));
    await client.check(['XADD', k, `${ms}-2`, ...field()], R.bulk(`${ms}-2`));
    await client.check(['XADD', k, `${ms}-2`, ...field()], R.error(ERR_SMALLER));
    await client.check(['XADD', k, `${ms - 1}-3`, ...field()], R.error(ERR_SMALLER));
    await client.check(['XADD', k, '0-0', ...field()], R.error(ERR_ZERO));
    await client.check(['XADD', k, `${ms + 1}-0`, ...field()], R.bulk(`${ms + 1}-0`));
  },

  async yh3(t) {
    const { client } = await startServer(t);
    const k = key(), ms = randInt(1, 999);
    await client.check(['XADD', k, '0-*', ...field()], R.bulk('0-1'));
    await client.check(['XADD', k, `${ms}-*`, ...field()], R.bulk(`${ms}-0`));
    await client.check(['XADD', k, `${ms}-*`, ...field()], R.bulk(`${ms}-1`));
  },

  async xu6(t) {
    const { client } = await startServer(t);
    const before = Date.now();
    const reply = await client.command('XADD', key(), '*', ...field());
    const after = Date.now();
    const m = reply.type === 'bulk' && /^(\d+)-(\d+)$/.exec(reply.value || '');
    if (!m) t.fail(`Expected a bulk string ID like "1526919030474-0", got ${JSON.stringify(reply)}`);
    const ms = Number(m[1]);
    if (ms < before - 1000 || ms > after + 1000) t.fail(`Expected the time part to be the current Unix time in milliseconds (~${before}), got ${ms}`);
    if (m[2] !== '0') t.fail(`Expected the sequence number to be 0, got ${m[2]}`);
    t.log.success(`✔︎ Received a valid auto-generated ID ${reply.value}`);
  },

  async zx1(t) {
    const { client } = await startServer(t);
    const k = key();
    const entries = [];
    for (let i = 1; i <= randInt(3, 5); i++) {
      const f = field();
      entries.push([`0-${i}`, f]);
      await client.check(['XADD', k, `0-${i}`, ...f], R.bulk(`0-${i}`));
    }
    const a = randInt(1, entries.length - 1), b = randInt(a + 1, entries.length);
    await client.check(['XRANGE', k, `0-${a}`, `0-${b}`], R.array(entries.slice(a - 1, b).map(([id, f]) => entry(id, f))));
    await client.check(['XRANGE', k, '0', `0-${b}`], R.array(entries.slice(0, b).map(([id, f]) => entry(id, f))));
  },

  async yp1(t) {
    const { client } = await startServer(t);
    const k = key();
    const entries = [];
    for (let i = 1; i <= randInt(3, 5); i++) { const f = field(); entries.push([`0-${i}`, f]); await client.check(['XADD', k, `0-${i}`, ...f], R.bulk(`0-${i}`)); }
    const b = randInt(1, entries.length);
    await client.check(['XRANGE', k, '-', `0-${b}`], R.array(entries.slice(0, b).map(([id, f]) => entry(id, f))));
  },

  async fs1(t) {
    const { client } = await startServer(t);
    const k = key();
    const entries = [];
    for (let i = 1; i <= randInt(3, 5); i++) { const f = field(); entries.push([`0-${i}`, f]); await client.check(['XADD', k, `0-${i}`, ...f], R.bulk(`0-${i}`)); }
    const a = randInt(1, entries.length);
    await client.check(['XRANGE', k, `0-${a}`, '+'], R.array(entries.slice(a - 1).map(([id, f]) => entry(id, f))));
  },

  async um0(t) {
    const { client } = await startServer(t);
    const k = key(), f = field();
    await client.check(['XADD', k, '0-1', ...f], R.bulk('0-1'));
    await client.check(['XREAD', 'STREAMS', k, '0-0'], streamsReply([[k, [['0-1', f]]]]));
  },

  async ru9(t) {
    const { client } = await startServer(t);
    const [k1, k2] = [key(), `other_${key()}`];
    const f1 = field(), f2 = field(), f3 = field();
    await client.check(['XADD', k1, '0-1', ...f1], R.bulk('0-1'));
    await client.check(['XADD', k1, '0-2', ...f3], R.bulk('0-2'));
    await client.check(['XADD', k2, '0-2', ...f2], R.bulk('0-2'));
    await client.check(['XREAD', 'streams', k1, k2, '0-1', '0-1'], streamsReply([[k1, [['0-2', f3]]], [k2, [['0-2', f2]]]]));
  },

  async bs1(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    const [reader, writer] = clients;
    const k = key(), f1 = field(), f2 = field();
    await writer.check(['XADD', k, '0-1', ...f1], R.bulk('0-1'));
    reader.send('XREAD', 'BLOCK', '1000', 'streams', k, '0-1');
    await t.sleep(300);
    await writer.check(['XADD', k, '0-2', ...f2], R.bulk('0-2'));
    await reader.expect(streamsReply([[k, [['0-2', f2]]]]));
    reader.send('XREAD', 'block', '1000', 'streams', k, '0-2');
    await reader.expectNothing(800, 'XREAD to block until the timeout');
    await reader.expect(R.nullArray(), { timeout: 2000 });
  },

  async hw1(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    const [reader, writer] = clients;
    const k = key(), f1 = field(), f2 = field();
    await writer.check(['XADD', k, '0-1', ...f1], R.bulk('0-1'));
    reader.send('XREAD', 'BLOCK', '0', 'streams', k, '0-1');
    await reader.expectNothing(1000, 'XREAD BLOCK 0 to keep blocking');
    await writer.check(['XADD', k, '0-2', ...f2], R.bulk('0-2'));
    await reader.expect(streamsReply([[k, [['0-2', f2]]]]));
  },

  async xu1(t) {
    const { clients } = await startServer(t, [], { clients: 2 });
    const [reader, writer] = clients;
    const k = key(), f1 = field(), f2 = field();
    await writer.check(['XADD', k, '0-1', ...f1], R.bulk('0-1'));
    reader.send('XREAD', 'BLOCK', '0', 'streams', k, '$');
    await reader.expectNothing(500, 'XREAD with $ to only return new entries');
    await writer.check(['XADD', k, '0-2', ...f2], R.bulk('0-2'));
    await reader.expect(streamsReply([[k, [['0-2', f2]]]]));
    reader.send('XREAD', 'BLOCK', '1000', 'streams', k, '$');
    await reader.expect(R.nullArray(), { timeout: 2500 });
  },
};

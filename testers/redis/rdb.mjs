import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { R, show } from '../../lib/protocols/resp.mjs';
import { word, words, randInt, key } from '../../lib/harness/random.mjs';
import { RedisClient } from './client.mjs';

// ---------- RDB writer (https://rdb.fnordig.de/file_format.html) ----------
function length(n) {
  if (n < 64) return Buffer.from([n]);
  if (n < 16384) return Buffer.from([0x40 | (n >> 8), n & 0xff]);
  const b = Buffer.alloc(5); b[0] = 0x80; b.writeUInt32BE(n, 1); return b;
}
const str = s => { const b = Buffer.from(s); return Buffer.concat([length(b.length), b]); };

// entries: [{ key, value, expiresAtMs? , expiresAtSec? }]
export function buildRdb(entries) {
  const parts = [Buffer.from('REDIS0011'),
    Buffer.from([0xfa]), str('redis-ver'), str('7.2.0'),
    Buffer.from([0xfa]), str('redis-bits'), Buffer.from([0xc0, 0x40]),
    Buffer.from([0xfe, 0x00]),
    Buffer.from([0xfb]), length(entries.length), length(entries.filter(e => e.expiresAtMs || e.expiresAtSec).length)];
  for (const e of entries) {
    if (e.expiresAtMs) { const b = Buffer.alloc(9); b[0] = 0xfc; b.writeBigUInt64LE(BigInt(e.expiresAtMs), 1); parts.push(b); }
    else if (e.expiresAtSec) { const b = Buffer.alloc(5); b[0] = 0xfd; b.writeUInt32LE(e.expiresAtSec, 1); parts.push(b); }
    parts.push(Buffer.from([0x00]), str(e.key), str(e.value));
  }
  parts.push(Buffer.from([0xff]), Buffer.alloc(8));
  return Buffer.concat(parts);
}

async function startWithRdb(t, entries) {
  const dir = await t.tmpDir('ccfree-rdb-');
  const file = `${word()}.rdb`;
  if (entries) {
    await writeFile(join(dir, file), buildRdb(entries));
    t.log.info(`Created RDB file ${file} with ${entries.length} key(s): ${entries.map(e => e.key).join(', ')}`);
  }
  const proc = t.spawn(['--dir', dir, '--dbfilename', file]);
  return { client: await RedisClient.connect(t, { proc }), dir, file };
}

async function expectKeys(t, client, expected) {
  const reply = await client.command('KEYS', '*');
  const got = reply.type === 'array' && reply.value ? reply.value.map(v => v.value).sort() : null;
  if (!got || JSON.stringify(got) !== JSON.stringify([...expected].sort())) t.fail(`Expected KEYS * to return ${JSON.stringify(expected)} (any order), got ${show(reply)}`);
  t.log.success(`✔︎ Received ${show(reply)}`);
}

const entriesOf = n => words(n).map(w => ({ key: `${w}_${randInt(1, 99)}`, value: word() }));

export const stages = {
  async zg5(t) {
    const { client, dir, file } = await startWithRdb(t, null);
    await client.check(['CONFIG', 'GET', 'dir'], R.array(['dir', dir]));
    await client.check(['CONFIG', 'GET', 'dbfilename'], R.array(['dbfilename', file]));
  },

  async jz6(t) {
    const entries = entriesOf(1);
    const { client } = await startWithRdb(t, entries);
    await expectKeys(t, client, entries.map(e => e.key));
  },

  async gc6(t) {
    const entries = entriesOf(1);
    const { client } = await startWithRdb(t, entries);
    await client.check(['GET', entries[0].key], R.bulk(entries[0].value));
  },

  async jw4(t) {
    const entries = entriesOf(randInt(3, 5));
    const { client } = await startWithRdb(t, entries);
    await expectKeys(t, client, entries.map(e => e.key));
  },

  async dq3(t) {
    const entries = entriesOf(randInt(3, 5));
    const { client } = await startWithRdb(t, entries);
    for (const e of entries) await client.check(['GET', e.key], R.bulk(e.value));
    await client.check(['GET', `missing_${key()}`], R.nullBulk());
  },

  async sm4(t) {
    const now = Date.now();
    const entries = entriesOf(randInt(4, 6)).map((e, i) => ({
      ...e,
      ...(i % 3 === 0 ? { expiresAtMs: now + 10 * 60 * 1000 } : i % 3 === 1 ? { expiresAtMs: now - 60 * 1000 } : {}),
    }));
    entries.push({ key: `sec_${key()}`, value: word(), expiresAtSec: Math.floor(now / 1000) - 3600 });
    const { client } = await startWithRdb(t, entries);
    for (const e of entries) {
      const expired = (e.expiresAtMs && e.expiresAtMs < now) || (e.expiresAtSec && e.expiresAtSec * 1000 < now);
      await client.check(['GET', e.key], expired ? R.nullBulk() : R.bulk(e.value));
    }
  },
};

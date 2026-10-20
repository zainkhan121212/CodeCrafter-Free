import { R } from '../../lib/protocols/resp.mjs';
import { words, randInt, key, pick } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';

// Non-integer scores with up to two decimals, so every language prints them the same way.
const score = () => `${randInt(1, 99)}.${pick(['1', '25', '5', '75', '3', '9'])}`;

class Model {
  constructor() { this.m = new Map(); }
  add(member, s) { const isNew = !this.m.has(member); this.m.set(member, Number(s)); return isNew ? 1 : 0; }
  sorted() { return [...this.m].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k]) => k); }
  range(start, stop) {
    const list = this.sorted(), n = list.length;
    if (start < 0) start = Math.max(n + start, 0);
    if (stop < 0) stop = n + stop;
    if (start >= n || start > stop) return [];
    return list.slice(start, Math.min(stop, n - 1) + 1);
  }
}

async function fill(client, k, model, entries) {
  for (const [s, m] of entries) await client.check(['ZADD', k, s, m], R.int(model.add(m, s)));
}

// Some members share a score, so ties must be ordered lexicographically.
function entriesWithTies(n) {
  const members = words(n);
  const shared = score();
  return members.map((m, i) => [i < 2 ? shared : score(), m]);
}

export const stages = {
  async ct1(t) {
    const { client } = await startServer(t);
    await client.check(['ZADD', key(), score(), words(1)[0]], R.int(1));
  },

  async hf1(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    const entries = words(randInt(3, 5)).map(m => [score(), m]);
    await fill(client, k, model, entries);
    await client.check(['ZADD', k, score(), entries[0][1]], R.int(0));
  },

  async lg6(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    await fill(client, k, model, entriesWithTies(randInt(4, 6)));
    for (const m of model.sorted()) await client.check(['ZRANK', k, m], R.int(model.sorted().indexOf(m)));
    await client.check(['ZRANK', k, 'missing_member'], R.nullBulk());
    await client.check(['ZRANK', `missing_${key()}`, 'member'], R.nullBulk());
  },

  async ic1(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    await fill(client, k, model, entriesWithTies(randInt(4, 6)));
    const n = model.m.size;
    for (const [a, b] of [[0, 1], [1, n - 1], [2, n + 3], [n, n + 1], [3, 1]]) await client.check(['ZRANGE', k, String(a), String(b)], R.array(model.range(a, b)));
    await client.check(['ZRANGE', `missing_${key()}`, '0', '1'], R.array([]));
  },

  async bj4(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    await fill(client, k, model, entriesWithTies(randInt(4, 6)));
    const n = model.m.size;
    for (const [a, b] of [[0, -1], [-2, -1], [2, -1], [-(n + 2), 1], [-1, -3]]) await client.check(['ZRANGE', k, String(a), String(b)], R.array(model.range(a, b)));
  },

  async kn4(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    const entries = words(randInt(3, 6)).map(m => [score(), m]);
    await fill(client, k, model, entries);
    await client.check(['ZCARD', k], R.int(entries.length));
    await client.check(['ZADD', k, score(), entries[0][1]], R.int(0));
    await client.check(['ZCARD', k], R.int(entries.length));
    await client.check(['ZCARD', `missing_${key()}`], R.int(0));
  },

  async gd7(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    const entries = words(randInt(3, 5)).map(m => [score(), m]);
    await fill(client, k, model, entries);
    const [s, m] = pick(entries);
    await client.check(['ZSCORE', k, m], R.bulk(s));
    const updated = score();
    await client.check(['ZADD', k, updated, m], R.int(0));
    await client.check(['ZSCORE', k, m], R.bulk(updated));
    await client.check(['ZSCORE', k, 'missing_member'], R.nullBulk());
    await client.check(['ZSCORE', `missing_${key()}`, 'member'], R.nullBulk());
  },

  async sq7(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Model();
    await fill(client, k, model, entriesWithTies(randInt(3, 5)));
    const victim = pick(model.sorted());
    await client.check(['ZREM', k, victim], R.int(1));
    model.m.delete(victim);
    await client.check(['ZRANGE', k, '0', '-1'], R.array(model.sorted()));
    await client.check(['ZREM', k, 'missing_member'], R.int(0));
    await client.check(['ZCARD', k], R.int(model.m.size));
  },
};

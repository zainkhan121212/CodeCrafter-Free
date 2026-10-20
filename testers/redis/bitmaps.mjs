import { R } from '../../lib/protocols/resp.mjs';
import { randInt, key, pick } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';

// Bit model: offset 0 is the most significant bit of byte 0.
class Bits {
  constructor(buf = Buffer.alloc(0)) { this.b = Buffer.from(buf); }
  set(off, v) {
    const byte = off >> 3;
    if (byte >= this.b.length) this.b = Buffer.concat([this.b, Buffer.alloc(byte + 1 - this.b.length)]);
    const old = (this.b[byte] >> (7 - (off & 7))) & 1;
    if (v) this.b[byte] |= 0x80 >> (off & 7); else this.b[byte] &= ~(0x80 >> (off & 7));
    return old;
  }
  get(off) { const byte = off >> 3; return byte < this.b.length ? (this.b[byte] >> (7 - (off & 7))) & 1 : 0; }
  count(start = 0, end = this.b.length - 1) {
    let n = 0;
    for (let i = start; i <= Math.min(end, this.b.length - 1); i++) for (let x = this.b[i]; x; x >>= 1) n += x & 1;
    return n;
  }
}

function op(kind, a, b) {
  const len = Math.max(a.b.length, b.b.length);
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++) out[i] = kind === 'AND' ? (a.b[i] ?? 0) & (b.b[i] ?? 0) : (a.b[i] ?? 0) | (b.b[i] ?? 0);
  return new Bits(out);
}

async function setbits(client, k, model, offsets) {
  for (const o of offsets) await client.check(['SETBIT', k, String(o), '1'], R.int(model.set(o, 1)));
}

export const stages = {
  async bq9(t) {
    const { client } = await startServer(t);
    const k = key(), off = randInt(0, 7);
    await client.check(['SETBIT', k, String(off), '1'], R.int(0));
    await client.check(['SETBIT', k, String(off), '1'], R.int(1));
  },

  async qj1(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Bits();
    const on = randInt(0, 6);
    await setbits(client, k, model, [on]);
    await client.check(['GETBIT', k, String(on)], R.int(1));
    await client.check(['GETBIT', k, String(on + 1)], R.int(0));
    await client.check(['GETBIT', k, '100'], R.int(0));
    await client.check(['GETBIT', `missing_${key()}`, String(on)], R.int(0));
  },

  async yj2(t) {
    const { client } = await startServer(t);
    const k = key(), ch = pick(['A', 'B', 'C', 'Q', 'z', '@', 'k']);
    await client.check(['SET', k, ch], R.simple('OK'));
    const model = new Bits(Buffer.from(ch));
    for (const o of [0, 1, randInt(2, 7), 7]) await client.check(['GETBIT', k, String(o)], R.int(model.get(o)));
  },

  async pk5(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Bits();
    // Bit 1 gives "@"; adding bits 7 or 6 gives "A" or "B" — all printable.
    await setbits(client, k, model, [1, pick([6, 7])]);
    await client.check(['GET', k], R.bulk(model.b.toString('latin1')));
  },

  async yf6(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Bits();
    await setbits(client, k, model, [1]);
    await client.check(['STRLEN', k], R.int(1));
    const far = randInt(8, 23);
    await client.check(['SETBIT', k, String(far), '1'], R.int(model.set(far, 1)));
    await client.check(['GETBIT', k, String(far)], R.int(1));
    await client.check(['STRLEN', k], R.int(model.b.length));
    await client.check(['STRLEN', `missing_${key()}`], R.int(0));
  },

  async nx3(t) {
    const { client } = await startServer(t);
    const k = key(), model = new Bits();
    await setbits(client, k, model, [1, randInt(2, 7), 10, randInt(16, 23)]);
    await client.check(['BITCOUNT', k], R.int(model.count()));
    for (const [a, b] of [[0, 0], [1, 1], [0, 1], [1, 5]]) await client.check(['BITCOUNT', k, String(a), String(b)], R.int(model.count(a, b)));
    await client.check(['BITCOUNT', `missing_${key()}`], R.int(0));
  },

  async hv4(t) {
    const { client } = await startServer(t);
    const [k1, k2, dest] = [key(), `${key()}_2`, `dest_${key()}`];
    const a = new Bits(), b = new Bits();
    await setbits(client, k1, a, [0, randInt(1, 3), 4]);
    await setbits(client, k2, b, [0, randInt(5, 7)]);
    const result = op('AND', a, b);
    await client.check(['BITOP', 'AND', dest, k1, k2], R.int(result.b.length));
    for (const o of [0, 4, 6]) await client.check(['GETBIT', dest, String(o)], R.int(result.get(o)));
  },

  async dk2(t) {
    const { client } = await startServer(t);
    const [k1, k2, dest] = [key(), `${key()}_2`, `dest_${key()}`];
    const a = new Bits(), b = new Bits();
    await setbits(client, k1, a, [1, 10]);
    await setbits(client, k2, b, [1]);
    const result = op('AND', a, b);
    await client.check(['BITOP', 'AND', dest, k1, k2], R.int(result.b.length));
    await client.check(['GETBIT', dest, '1'], R.int(1));
    await client.check(['GETBIT', dest, '10'], R.int(0));
  },

  async fr8(t) {
    const { client } = await startServer(t);
    const [k1, k2, d1, k3, k4, d2] = [key(), `${key()}_2`, `dest_${key()}`, `${key()}_3`, `${key()}_4`, `dest2_${key()}`];
    const a = new Bits(), b = new Bits(), c = new Bits(), d = new Bits();
    await setbits(client, k1, a, [0, 4]);
    await setbits(client, k2, b, [0, 6]);
    await client.check(['BITOP', 'OR', d1, k1, k2], R.int(1));
    await client.check(['GETBIT', d1, '4'], R.int(1));
    await client.check(['GETBIT', d1, '6'], R.int(1));
    await setbits(client, k3, c, [1, 10]);
    await setbits(client, k4, d, [1]);
    await client.check(['BITOP', 'OR', d2, k3, k4], R.int(2));
    await client.check(['GETBIT', d2, '10'], R.int(1));
    await client.check(['BITCOUNT', d2], R.int(op('OR', c, d).count()));
  },
};

// Bencode (BEP 3). Strings decode to Buffers; use toJSONValue() for display.

export function encode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === 'string') return encode(Buffer.from(value));
  if (typeof value === 'number' || typeof value === 'bigint') return Buffer.from(`i${value}e`);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(encode), Buffer.from('e')]);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return Buffer.concat([Buffer.from('d'), ...keys.flatMap(k => [encode(k), encode(value[k])]), Buffer.from('e')]);
  }
  throw new Error(`cannot bencode ${typeof value}`);
}

export function decode(buf, start = 0) {
  let i = start;
  function next() {
    const c = buf[i];
    if (c === 0x69) { // i
      const end = buf.indexOf(0x65, i);
      const n = buf.toString('latin1', i + 1, end);
      i = end + 1;
      const big = BigInt(n);
      return big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(big) : big;
    }
    if (c === 0x6c) { // l
      i++;
      const list = [];
      while (buf[i] !== 0x65) list.push(next());
      i++;
      return list;
    }
    if (c === 0x64) { // d
      i++;
      const dict = {};
      while (buf[i] !== 0x65) { const k = next().toString('latin1'); dict[k] = next(); }
      i++;
      return dict;
    }
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) throw new Error('invalid bencode');
    const len = Number(buf.toString('latin1', i, colon));
    const s = buf.subarray(colon + 1, colon + 1 + len);
    i = colon + 1 + len;
    return s;
  }
  const value = next();
  return { value, end: i };
}

export function toJSONValue(v) {
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(toJSONValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJSONValue(x)]));
  return v;
}

// Byte span of the top-level "info" dictionary inside a torrent file.
export function infoSpan(torrent) {
  const key = Buffer.from('4:info');
  const at = torrent.indexOf(key) + key.length;
  return torrent.subarray(at, decode(torrent, at).end);
}

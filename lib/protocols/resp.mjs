// RESP2/RESP3 encoding and incremental parsing (https://redis.io/docs/latest/develop/reference/protocol-spec/).
// Parsed values are tagged: { type: 'simple'|'error'|'integer'|'bulk'|'array'|'null'|'double'|'boolean'|'map'|'verbatim', value }.

export class RespError extends Error {}

export const encodeCommand = args => {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) {
    const b = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
    parts.push(`$${b.length}\r\n`, b, '\r\n');
  }
  return Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
};

// Encode a tagged value (used by fake masters/replicas in tests).
export function encode(v) {
  switch (v.type) {
    case 'simple': return Buffer.from(`+${v.value}\r\n`);
    case 'error': return Buffer.from(`-${v.value}\r\n`);
    case 'integer': return Buffer.from(`:${v.value}\r\n`);
    case 'bulk': {
      if (v.value === null) return Buffer.from('$-1\r\n');
      const b = Buffer.isBuffer(v.value) ? v.value : Buffer.from(v.value);
      return Buffer.concat([Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n')]);
    }
    case 'array':
      if (v.value === null) return Buffer.from('*-1\r\n');
      return Buffer.concat([Buffer.from(`*${v.value.length}\r\n`), ...v.value.map(encode)]);
    default: throw new Error(`cannot encode ${v.type}`);
  }
}

function readLine(buf, offset) {
  const end = buf.indexOf('\r\n', offset);
  return end < 0 ? null : { line: buf.toString('utf8', offset, end), next: end + 2 };
}

// Returns { value, length } or null if the buffer does not yet hold a complete value.
export function parse(buf, offset = 0) {
  if (offset >= buf.length) return null;
  const kind = String.fromCharCode(buf[offset]);
  const l = readLine(buf, offset + 1);
  if (!l) return null;
  const done = value => ({ value, length: l.next - offset });
  switch (kind) {
    case '+': return done({ type: 'simple', value: l.line });
    case '-': return done({ type: 'error', value: l.line });
    case ':': {
      if (!/^-?\d+$/.test(l.line)) throw new RespError(`Invalid RESP integer: ${JSON.stringify(l.line)}`);
      return done({ type: 'integer', value: Number(l.line) });
    }
    case '_': return done({ type: 'null', value: null });
    case '#': return done({ type: 'boolean', value: l.line === 't' });
    case ',': return done({ type: 'double', value: Number(l.line) });
    case '$': case '=': {
      const n = Number(l.line);
      if (!Number.isInteger(n) || n < -1) throw new RespError(`Invalid bulk string length: ${JSON.stringify(l.line)}`);
      if (n === -1) return done({ type: 'bulk', value: null });
      if (buf.length < l.next + n + 2) return null;
      if (buf[l.next + n] !== 13 || buf[l.next + n + 1] !== 10) throw new RespError(`Bulk string of declared length ${n} is not followed by \\r\\n`);
      return { value: { type: kind === '=' ? 'verbatim' : 'bulk', value: buf.toString('utf8', l.next, l.next + n) }, length: l.next + n + 2 - offset };
    }
    case '*': case '%': case '~': case '>': {
      const n = Number(l.line);
      if (!Number.isInteger(n) || n < -1) throw new RespError(`Invalid aggregate length: ${JSON.stringify(l.line)}`);
      if (n === -1) return done({ type: 'array', value: null });
      const count = kind === '%' ? n * 2 : n;
      const items = [];
      let pos = l.next;
      for (let i = 0; i < count; i++) {
        const item = parse(buf, pos);
        if (!item) return null;
        items.push(item.value);
        pos += item.length;
      }
      const type = kind === '%' ? 'map' : 'array';
      return { value: { type, value: items }, length: pos - offset };
    }
    default:
      throw new RespError(`Invalid RESP data type byte ${JSON.stringify(kind)} in ${JSON.stringify(buf.toString('latin1', offset, Math.min(buf.length, offset + 40)))}`);
  }
}

// Human-readable rendering for logs, e.g. "PONG", ["a", "b"], (integer) 3, (nil).
export function show(v) {
  if (!v) return String(v);
  switch (v.type) {
    case 'simple': return JSON.stringify(v.value);
    case 'error': return `(error) ${JSON.stringify(v.value)}`;
    case 'integer': return `(integer) ${v.value}`;
    case 'bulk': case 'verbatim': return v.value === null ? '(null bulk string)' : JSON.stringify(v.value);
    case 'array': return v.value === null ? '(null array)' : `[${v.value.map(show).join(', ')}]`;
    case 'map': return `{${v.value.map(show).join(', ')}}`;
    case 'null': return '(null)';
    default: return JSON.stringify(v.value);
  }
}

const TYPE_NAMES = { simple: 'simple string', error: 'error', integer: 'integer', bulk: 'bulk string', array: 'array', null: 'null', map: 'map', double: 'double', boolean: 'boolean', verbatim: 'verbatim string' };
export const typeName = v => (v.type === 'bulk' && v.value === null ? 'null bulk string' : v.type === 'array' && v.value === null ? 'null array' : TYPE_NAMES[v.type]);

// Constructors for expected values. Plain strings inside arrays mean bulk strings.
export const R = {
  simple: value => ({ type: 'simple', value }),
  bulk: value => ({ type: 'bulk', value }),
  nullBulk: () => ({ type: 'bulk', value: null }),
  int: value => ({ type: 'integer', value }),
  array: items => ({ type: 'array', value: items.map(x => (typeof x === 'string' ? R.bulk(x) : x === null ? R.nullBulk() : typeof x === 'number' ? R.int(x) : x)) }),
  nullArray: () => ({ type: 'array', value: null }),
  error: prefix => ({ type: 'error', value: prefix, match: 'prefix' }),
};

// Compares a received value to an expected one. Returns null when they match, otherwise a description.
export function diff(actual, expected, path = '') {
  const where = path ? ` at ${path}` : '';
  if (expected.type === 'error') {
    if (actual.type !== 'error') return `Expected an error${where}, got ${typeName(actual)} ${show(actual)}`;
    if (expected.value && !actual.value.toUpperCase().startsWith(expected.value.toUpperCase())) return `Expected error starting with ${JSON.stringify(expected.value)}${where}, got ${JSON.stringify(actual.value)}`;
    return null;
  }
  const sameType = actual.type === expected.type && (actual.value === null) === (expected.value === null);
  if (!sameType) return `Expected ${typeName(expected)}${expected.value !== null && expected.type !== 'array' ? ` ${show(expected)}` : ''}${where}, got ${typeName(actual)} ${show(actual)}`;
  if (expected.type === 'array' && expected.value) {
    if (actual.value.length !== expected.value.length) return `Expected array of length ${expected.value.length}${where}, got length ${actual.value.length}: ${show(actual)}`;
    for (let i = 0; i < expected.value.length; i++) {
      const d = diff(actual.value[i], expected.value[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (actual.value !== expected.value) return `Expected ${show(expected)}${where}, got ${show(actual)}`;
  return null;
}

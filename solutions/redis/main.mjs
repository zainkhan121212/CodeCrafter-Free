// Reference Redis server used to verify the Redis tester. Spoilers!
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, encodeCommand } from '../../lib/protocols/resp.mjs';
import { encode as geoEncode, decode as geoDecode, distance, validLat, validLon } from '../../lib/protocols/geo.mjs';

// ---------- config ----------
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const config = {
  port: Number(flag('port', 6379)),
  dir: flag('dir', process.cwd()),
  dbfilename: flag('dbfilename', 'dump.rdb'),
  appendonly: flag('appendonly', 'no'),
  appenddirname: flag('appenddirname', 'appendonlydir'),
  appendfilename: flag('appendfilename', 'appendonly.aof'),
  appendfsync: flag('appendfsync', 'everysec'),
};
const replicaof = flag('replicaof', null);
const REPL_ID = randomBytes(20).toString('hex');
const EMPTY_RDB = Buffer.from('524544495330303131fa0972656469732d76657205372e322e30fa0a72656469732d62697473c040fa056374696d65c26d08bc65fa08757365642d6d656dc2b0c41000fa08616f662d62617365c000fff06e3bfec0ff5aa2', 'hex');

// ---------- RESP encoding ----------
const E = {
  simple: s => `+${s}\r\n`,
  error: s => `-${s}\r\n`,
  int: n => `:${n}\r\n`,
  bulk: s => { if (s === null || s === undefined) return '$-1\r\n'; const b = Buffer.isBuffer(s) ? s : Buffer.from(String(s)); return Buffer.concat([Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n')]); },
  nullArray: '*-1\r\n',
  // Items: raw encoded values (string/Buffer); plain JS strings are NOT auto-wrapped here.
  arr: items => Buffer.concat([Buffer.from(`*${items.length}\r\n`), ...items.map(x => Buffer.isBuffer(x) ? x : Buffer.from(x))]),
};
const bulks = list => E.arr(list.map(E.bulk));

// ---------- data ----------
const db = new Map(); // key -> { type, value, expiresAt }
const versions = new Map(); // key -> write counter (for WATCH)
const touch = k => versions.set(k, (versions.get(k) || 0) + 1);

function entry(k) {
  const e = db.get(k);
  if (!e) return null;
  if (e.expiresAt && Date.now() >= e.expiresAt) { db.delete(k); return null; }
  return e;
}
const typed = (k, type, create) => {
  let e = entry(k);
  if (!e && create) { e = { type, value: create() }; db.set(k, e); }
  return e;
};

// ---------- persistence: RDB ----------
function loadRdb() {
  const file = join(config.dir, config.dbfilename);
  if (!existsSync(file)) return;
  const b = readFileSync(file);
  let i = 9;
  const len = () => {
    const first = b[i++];
    const type = first >> 6;
    if (type === 0) return first & 0x3f;
    if (type === 1) return ((first & 0x3f) << 8) | b[i++];
    if (type === 2) { const v = b.readUInt32BE(i); i += 4; return v; }
    return { special: first & 0x3f };
  };
  const str = () => {
    const l = len();
    if (typeof l === 'object') {
      if (l.special === 0) return String(b.readInt8(i++));
      if (l.special === 1) { const v = b.readInt16LE(i); i += 2; return String(v); }
      if (l.special === 2) { const v = b.readInt32LE(i); i += 4; return String(v); }
      throw new Error('compressed strings are not supported');
    }
    const s = b.subarray(i, i + l); i += l; return s;
  };
  let expiresAt = null;
  while (i < b.length) {
    const op = b[i++];
    if (op === 0xff) break;
    if (op === 0xfa) { str(); str(); continue; }
    if (op === 0xfe) { len(); continue; }
    if (op === 0xfb) { len(); len(); continue; }
    if (op === 0xfc) { expiresAt = Number(b.readBigUInt64LE(i)); i += 8; continue; }
    if (op === 0xfd) { expiresAt = b.readUInt32LE(i) * 1000; i += 4; continue; }
    const k = str().toString(), v = str();
    if (op === 0 && !(expiresAt && expiresAt <= Date.now())) db.set(k, { type: 'string', value: Buffer.from(v), expiresAt });
    expiresAt = null;
  }
}

// ---------- persistence: AOF ----------
let aofFile = null;
function setupAof() {
  if (config.appendonly !== 'yes') return;
  const dir = join(config.dir, config.appenddirname);
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, `${config.appendfilename}.manifest`);
  let name = `${config.appendfilename}.1.incr.aof`;
  if (existsSync(manifest)) {
    const m = readFileSync(manifest, 'utf8').match(/^file (\S+) seq \d+ type i$/m);
    if (m) name = m[1];
  } else writeFileSync(manifest, `file ${name} seq 1 type i\n`);
  aofFile = join(dir, name);
  if (!existsSync(aofFile)) writeFileSync(aofFile, '');
  const data = readFileSync(aofFile);
  let pos = 0;
  const fake = { state: freshState(), write() {} };
  fake.state.authenticated = true;
  fake.state.replaying = true;
  while (pos < data.length) {
    const p = parse(data, pos);
    if (!p) break;
    pos += p.length;
    execute(fake, p.value.value.map(v => v.value));
  }
}

// ---------- replication (master side) ----------
const replicas = new Set(); // sockets
let masterOffset = 0;
const WRITE_COMMANDS = new Set(['SET', 'INCR', 'RPUSH', 'LPUSH', 'LPOP', 'XADD', 'ZADD', 'ZREM', 'SETBIT', 'BITOP', 'GEOADD', 'DEL']);

function propagate(args) {
  if (!replicas.size) return;
  const buf = encodeCommand(args);
  masterOffset += buf.length;
  for (const r of replicas) r.write(buf);
}

// ---------- blocking ----------
const listWaiters = new Map(); // key -> [waiter]
const streamWaiters = new Set(); // { socket, specs: [{ key, after }], timer }

function serveListWaiters(k) {
  const q = listWaiters.get(k);
  while (q?.length) {
    const list = entry(k)?.value;
    if (!list?.length) break;
    const w = q.shift();
    clearTimeout(w.timer);
    w.socket.write(bulks([k, list.shift()]));
  }
}

// ---------- streams ----------
const cmpId = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
const fmtId = id => `${id[0]}-${id[1]}`;
const parseId = (s, fallbackSeq) => { const [ms, seq] = s.split('-'); return [Number(ms), seq === undefined ? fallbackSeq : Number(seq)]; };
const entryReply = e => E.arr([E.bulk(fmtId(e.id)), bulks(e.fields)]);

function readStreams(specs) {
  const out = [];
  for (const { key, after } of specs) {
    const s = entry(key)?.value || [];
    const items = s.filter(e => cmpId(e.id, after) > 0);
    if (items.length) out.push(E.arr([E.bulk(key), E.arr(items.map(entryReply))]));
  }
  return out;
}

function serveStreamWaiters() {
  for (const w of [...streamWaiters]) {
    const out = readStreams(w.specs);
    if (out.length) { clearTimeout(w.timer); streamWaiters.delete(w); w.socket.write(E.arr(out)); }
  }
}

// ---------- sorted sets ----------
const zsorted = z => [...z].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const fmtScore = n => String(n);

// ---------- pub/sub ----------
const channels = new Map(); // channel -> Set(socket)

// ---------- auth ----------
const user = { flags: ['nopass'], passwords: [] };

function freshState() {
  return { multi: null, watched: new Map(), subs: new Set(), authenticated: user.flags.includes('nopass'), isReplica: false };
}

function range(list, a, b) {
  const n = list.length;
  let start = Number(a), stop = Number(b);
  if (start < 0) start = Math.max(n + start, 0);
  if (stop < 0) stop = n + stop;
  if (start >= n || start > stop) return [];
  return list.slice(start, Math.min(stop, n - 1) + 1);
}

function bitsOf(k) { const e = entry(k); return e ? e.value : Buffer.alloc(0); }

// Executes a command. `conn` has { state, write }. Returns a reply (string/Buffer) or null (no reply yet).
function execute(conn, args) {
  const st = conn.state;
  const name = String(args[0]).toUpperCase();
  const a = args.slice(1);

  if (!st.authenticated && name !== 'AUTH') return E.error('NOAUTH Authentication required.');
  if (st.subs.size && !['SUBSCRIBE', 'UNSUBSCRIBE', 'PSUBSCRIBE', 'PUNSUBSCRIBE', 'PING', 'QUIT', 'RESET'].includes(name)) {
    return E.error(`ERR Can't execute '${name.toLowerCase()}': only (P|S)SUBSCRIBE / (P|S)UNSUBSCRIBE / PING / QUIT / RESET are allowed in this context`);
  }
  if (st.multi && !['EXEC', 'DISCARD', 'MULTI', 'WATCH'].includes(name)) { st.multi.push(args); return E.simple('QUEUED'); }

  const reply = run(conn, name, a, args);
  if (WRITE_COMMANDS.has(name) && !String(reply).startsWith('-')) {
    if (aofFile && !st.replaying) appendFileSync(aofFile, encodeCommand(args));
    if (!st.fromMaster) propagate(args);
  }
  return reply;
}

function run(conn, name, a, args) {
  const st = conn.state;
  switch (name) {
    case 'PING': return st.subs.size ? bulks(['pong', '']) : E.simple('PONG');
    case 'ECHO': return E.bulk(a[0]);
    case 'SET': {
      let expiresAt = null;
      for (let i = 2; i < a.length; i++) {
        const o = String(a[i]).toUpperCase();
        if (o === 'PX') expiresAt = Date.now() + Number(a[++i]);
        else if (o === 'EX') expiresAt = Date.now() + Number(a[++i]) * 1000;
      }
      db.set(a[0], { type: 'string', value: Buffer.from(a[1]), expiresAt });
      touch(a[0]);
      return E.simple('OK');
    }
    case 'GET': { const e = entry(a[0]); return E.bulk(e ? e.value : null); }
    case 'INCR': {
      const e = entry(a[0]);
      const n = e ? Number(e.value.toString()) : 0;
      if (e && (e.type !== 'string' || !/^-?\d+$/.test(e.value.toString()))) return E.error('ERR value is not an integer or out of range');
      db.set(a[0], { type: 'string', value: Buffer.from(String(n + 1)), expiresAt: e?.expiresAt ?? null });
      touch(a[0]);
      return E.int(n + 1);
    }
    case 'TYPE': return E.simple(entry(a[0])?.type ?? 'none');
    case 'KEYS': return bulks([...db.keys()].filter(k => entry(k)));
    case 'CONFIG': return a[0].toUpperCase() === 'GET' && a[1] in config ? bulks([a[1], String(config[a[1]])]) : E.arr([]);
    case 'INFO': return E.bulk(`# Replication\r\nrole:${replicaof ? 'slave' : 'master'}\r\nmaster_replid:${REPL_ID}\r\nmaster_repl_offset:0\r\n`);

    // lists
    case 'RPUSH': case 'LPUSH': {
      const list = typed(a[0], 'list', () => []).value;
      for (const v of a.slice(1)) name === 'RPUSH' ? list.push(v) : list.unshift(v);
      const n = list.length;
      touch(a[0]);
      serveListWaiters(a[0]);
      return E.int(n);
    }
    case 'LRANGE': return bulks(range(entry(a[0])?.value || [], a[1], a[2]));
    case 'LLEN': return E.int(entry(a[0])?.value.length ?? 0);
    case 'LPOP': {
      const list = entry(a[0])?.value;
      touch(a[0]);
      if (a[1] === undefined) return E.bulk(list?.length ? list.shift() : null);
      return list ? bulks(list.splice(0, Number(a[1]))) : E.nullArray;
    }
    case 'BLPOP': {
      const timeout = Number(a.at(-1));
      for (const k of a.slice(0, -1)) { const list = entry(k)?.value; if (list?.length) return bulks([k, list.shift()]); }
      const k = a[0];
      const w = { socket: conn, timer: null };
      listWaiters.set(k, [...(listWaiters.get(k) || []), w]);
      if (timeout > 0) w.timer = setTimeout(() => { listWaiters.set(k, listWaiters.get(k).filter(x => x !== w)); conn.write(E.nullArray); }, timeout * 1000);
      return null;
    }

    // streams
    case 'XADD': {
      const [k, rawId, ...fields] = a;
      const existing = entry(k)?.value || [];
      const last = existing.at(-1)?.id || [0, 0];
      let id;
      if (rawId === '*') { const ms = Date.now(); id = [ms, ms === last[0] ? last[1] + 1 : 0]; }
      else {
        const [msS, seqS] = rawId.split('-');
        const ms = Number(msS);
        const seq = seqS === '*' ? (ms === last[0] ? last[1] + 1 : ms === 0 ? 1 : 0) : Number(seqS);
        id = [ms, seq];
      }
      if (id[0] === 0 && id[1] === 0) return E.error('ERR The ID specified in XADD must be greater than 0-0');
      if (existing.length && cmpId(id, last) <= 0) return E.error('ERR The ID specified in XADD is equal or smaller than the target stream top item');
      typed(k, 'stream', () => []).value.push({ id, fields });
      touch(k);
      serveStreamWaiters();
      return E.bulk(fmtId(id));
    }
    case 'XRANGE': {
      const s = entry(a[0])?.value || [];
      const start = a[1] === '-' ? [0, 0] : parseId(a[1], 0);
      const end = a[2] === '+' ? [Infinity, Infinity] : parseId(a[2], Infinity);
      return E.arr(s.filter(e => cmpId(e.id, start) >= 0 && cmpId(e.id, end) <= 0).map(entryReply));
    }
    case 'XREAD': {
      let block = null;
      let i = 0;
      if (a[0].toUpperCase() === 'BLOCK') { block = Number(a[1]); i = 2; }
      const rest = a.slice(i + 1);
      const keys = rest.slice(0, rest.length / 2), ids = rest.slice(rest.length / 2);
      const specs = keys.map((key, j) => ({ key, after: ids[j] === '$' ? (entry(key)?.value.at(-1)?.id || [0, 0]) : parseId(ids[j], 0) }));
      const out = readStreams(specs);
      if (out.length || block === null) return out.length ? E.arr(out) : E.nullArray;
      const w = { socket: conn, specs, timer: null };
      streamWaiters.add(w);
      if (block > 0) w.timer = setTimeout(() => { streamWaiters.delete(w); conn.write(E.nullArray); }, block);
      return null;
    }

    // transactions
    case 'MULTI': st.multi = []; return E.simple('OK');
    case 'EXEC': {
      if (!st.multi) return E.error('ERR EXEC without MULTI');
      const queued = st.multi;
      st.multi = null;
      const dirty = [...st.watched].some(([k, v]) => (versions.get(k) || 0) !== v);
      st.watched.clear();
      if (dirty) return E.nullArray;
      return E.arr(queued.map(q => execute(conn, q)));
    }
    case 'DISCARD':
      if (!st.multi) return E.error('ERR DISCARD without MULTI');
      st.multi = null; st.watched.clear();
      return E.simple('OK');
    case 'WATCH':
      if (st.multi) return E.error('ERR WATCH inside MULTI is not allowed');
      for (const k of a) st.watched.set(k, versions.get(k) || 0);
      return E.simple('OK');
    case 'UNWATCH': st.watched.clear(); return E.simple('OK');

    // replication
    case 'REPLCONF':
      if (a[0].toUpperCase() === 'ACK') { conn.ackOffset = Number(a[1]); conn.onAck?.(); return null; }
      return E.simple('OK');
    case 'PSYNC':
      conn.write(E.simple(`FULLRESYNC ${REPL_ID} 0`));
      conn.write(Buffer.concat([Buffer.from(`$${EMPTY_RDB.length}\r\n`), EMPTY_RDB]));
      replicas.add(conn);
      st.isReplica = true;
      return null;
    case 'WAIT': {
      const need = Number(a[0]), timeout = Number(a[1]);
      if (masterOffset === 0) return E.int(replicas.size);
      const target = masterOffset;
      const getack = encodeCommand(['REPLCONF', 'GETACK', '*']);
      let done = false;
      const count = () => [...replicas].filter(r => (r.ackOffset || 0) >= target).length;
      const finish = () => { if (done) return; done = true; for (const r of replicas) r.onAck = null; conn.write(E.int(count())); };
      for (const r of replicas) { r.onAck = () => { if (count() >= need) finish(); }; r.write(getack); }
      masterOffset += getack.length;
      setTimeout(finish, timeout);
      return null;
    }

    // pub/sub
    case 'SUBSCRIBE': {
      const out = [];
      for (const ch of a) {
        st.subs.add(ch);
        if (!channels.has(ch)) channels.set(ch, new Set());
        channels.get(ch).add(conn);
        out.push(E.arr([E.bulk('subscribe'), E.bulk(ch), E.int(st.subs.size)]));
      }
      return Buffer.concat(out.map(x => Buffer.from(x)));
    }
    case 'UNSUBSCRIBE': {
      const out = [];
      for (const ch of a.length ? a : [...st.subs]) {
        st.subs.delete(ch);
        channels.get(ch)?.delete(conn);
        out.push(E.arr([E.bulk('unsubscribe'), E.bulk(ch), E.int(st.subs.size)]));
      }
      return Buffer.concat(out.map(x => Buffer.from(x)));
    }
    case 'PUBLISH': {
      const subs = channels.get(a[0]) || new Set();
      for (const s of subs) s.write(bulks(['message', a[0], a[1]]));
      return E.int(subs.size);
    }

    // sorted sets
    case 'ZADD': {
      const z = typed(a[0], 'zset', () => new Map()).value;
      const isNew = !z.has(a[2]);
      z.set(a[2], Number(a[1]));
      touch(a[0]);
      return E.int(isNew ? 1 : 0);
    }
    case 'ZRANK': {
      const z = entry(a[0])?.value;
      const i = z ? zsorted(z).findIndex(([m]) => m === a[1]) : -1;
      return i < 0 ? E.bulk(null) : E.int(i);
    }
    case 'ZRANGE': { const z = entry(a[0])?.value; return bulks(z ? range(zsorted(z), a[1], a[2]).map(([m]) => m) : []); }
    case 'ZCARD': return E.int(entry(a[0])?.value.size ?? 0);
    case 'ZSCORE': { const s = entry(a[0])?.value.get(a[1]); return E.bulk(s === undefined ? null : fmtScore(s)); }
    case 'ZREM': { const z = entry(a[0])?.value; const had = z?.delete(a[1]) ? 1 : 0; touch(a[0]); return E.int(had); }

    // bitmaps
    case 'SETBIT': {
      const off = Number(a[1]), byte = off >> 3;
      let buf = bitsOf(a[0]);
      if (byte >= buf.length) buf = Buffer.concat([buf, Buffer.alloc(byte + 1 - buf.length)]);
      const old = (buf[byte] >> (7 - (off & 7))) & 1;
      if (a[2] === '1') buf[byte] |= 0x80 >> (off & 7); else buf[byte] &= ~(0x80 >> (off & 7));
      db.set(a[0], { type: 'string', value: buf, expiresAt: null });
      touch(a[0]);
      return E.int(old);
    }
    case 'GETBIT': { const off = Number(a[1]); const buf = bitsOf(a[0]); return E.int(off >> 3 < buf.length ? (buf[off >> 3] >> (7 - (off & 7))) & 1 : 0); }
    case 'STRLEN': return E.int(bitsOf(a[0]).length);
    case 'BITCOUNT': {
      const buf = bitsOf(a[0]);
      const s = a[1] === undefined ? 0 : Number(a[1]), e = a[2] === undefined ? buf.length - 1 : Number(a[2]);
      let n = 0;
      for (let i = s; i <= Math.min(e, buf.length - 1); i++) for (let x = buf[i]; x; x >>= 1) n += x & 1;
      return E.int(n);
    }
    case 'BITOP': {
      const op = a[0].toUpperCase(), srcs = a.slice(2).map(bitsOf);
      const len = Math.max(...srcs.map(b => b.length));
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = srcs.reduce((acc, b, j) => (j === 0 ? (b[i] ?? 0) : op === 'AND' ? acc & (b[i] ?? 0) : acc | (b[i] ?? 0)), 0);
      db.set(a[1], { type: 'string', value: out, expiresAt: null });
      touch(a[1]);
      return E.int(len);
    }

    // geospatial
    case 'GEOADD': {
      const lon = Number(a[1]), lat = Number(a[2]);
      if (!validLon(lon) || !validLat(lat)) return E.error(`ERR invalid longitude,latitude pair ${a[1]},${a[2]}`);
      const z = typed(a[0], 'zset', () => new Map()).value;
      const isNew = !z.has(a[3]);
      z.set(a[3], geoEncode(lon, lat));
      touch(a[0]);
      return E.int(isNew ? 1 : 0);
    }
    case 'GEOPOS': {
      const z = entry(a[0])?.value;
      return E.arr(a.slice(1).map(m => { const s = z?.get(m); if (s === undefined) return E.nullArray; const p = geoDecode(s); return bulks([String(p.lon), String(p.lat)]); }));
    }
    case 'GEODIST': {
      const z = entry(a[0])?.value;
      const s1 = z?.get(a[1]), s2 = z?.get(a[2]);
      if (s1 === undefined || s2 === undefined) return E.bulk(null);
      const p1 = geoDecode(s1), p2 = geoDecode(s2);
      return E.bulk(distance(p1.lon, p1.lat, p2.lon, p2.lat).toFixed(4));
    }
    case 'GEOSEARCH': {
      const z = entry(a[0])?.value || new Map();
      const lon = Number(a[2]), lat = Number(a[3]);
      const unit = { m: 1, km: 1000, mi: 1609.34, ft: 0.3048 }[String(a[6]).toLowerCase()] || 1;
      const radius = Number(a[5]) * unit;
      return bulks([...z].filter(([, s]) => { const p = geoDecode(s); return distance(lon, lat, p.lon, p.lat) <= radius; }).map(([m]) => m));
    }

    // auth
    case 'ACL': {
      const sub = a[0].toUpperCase();
      if (sub === 'WHOAMI') return E.bulk('default');
      if (sub === 'GETUSER') return E.arr([E.bulk('flags'), bulks(user.flags), E.bulk('passwords'), bulks(user.passwords)]);
      if (sub === 'SETUSER') {
        for (const rule of a.slice(2)) if (rule.startsWith('>')) { user.passwords.push(createHash('sha256').update(rule.slice(1)).digest('hex')); user.flags = user.flags.filter(f => f !== 'nopass'); }
        return E.simple('OK');
      }
      return E.error('ERR unknown ACL subcommand');
    }
    case 'AUTH': {
      const pw = a.length === 2 ? a[1] : a[0];
      if (user.flags.includes('nopass') || user.passwords.includes(createHash('sha256').update(pw).digest('hex'))) { st.authenticated = true; return E.simple('OK'); }
      return E.error('WRONGPASS invalid username-password pair or user is disabled.');
    }
    default:
      return E.error(`ERR unknown command '${args[0]}'`);
  }
}

// ---------- server ----------
function serve(socket) {
  socket.state = freshState();
  let buf = Buffer.alloc(0);
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const p = parse(buf);
      if (!p) break;
      buf = buf.subarray(p.length);
      const reply = execute(socket, p.value.value.map(v => v.value));
      if (reply !== null) socket.write(reply);
    }
  });
  socket.on('close', () => {
    replicas.delete(socket);
    for (const subs of channels.values()) subs.delete(socket);
  });
  socket.on('error', () => {});
}

// ---------- replica mode ----------
function connectToMaster() {
  const [host, port] = replicaof.split(' ');
  const sock = net.connect(Number(port), host);
  sock.state = freshState();
  sock.state.fromMaster = true;
  sock.state.authenticated = true;
  let buf = Buffer.alloc(0);
  let stage = 0; // 0 PING, 1 REPLCONF port, 2 REPLCONF capa, 3 PSYNC, 4 RDB, 5 streaming
  let offset = 0;
  sock.on('connect', () => sock.write(encodeCommand(['PING'])));
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (stage < 4) {
        const end = buf.indexOf('\r\n');
        if (end < 0) return;
        const line = buf.toString('latin1', 0, end);
        buf = buf.subarray(end + 2);
        stage++;
        if (stage === 1) sock.write(encodeCommand(['REPLCONF', 'listening-port', String(config.port)]));
        else if (stage === 2) sock.write(encodeCommand(['REPLCONF', 'capa', 'psync2']));
        else if (stage === 3) sock.write(encodeCommand(['PSYNC', '?', '-1']));
        void line;
        continue;
      }
      if (stage === 4) {
        const end = buf.indexOf('\r\n');
        if (end < 0) return;
        const n = Number(buf.toString('latin1', 1, end));
        if (buf.length < end + 2 + n) return;
        buf = buf.subarray(end + 2 + n);
        stage = 5;
        continue;
      }
      const p = parse(buf);
      if (!p) return;
      buf = buf.subarray(p.length);
      const args = p.value.value.map(v => v.value);
      if (String(args[0]).toUpperCase() === 'REPLCONF' && String(args[1]).toUpperCase() === 'GETACK') sock.write(encodeCommand(['REPLCONF', 'ACK', String(offset)]));
      else execute(sock, args);
      offset += p.length;
    }
  });
  sock.on('error', () => {});
}

loadRdb();
setupAof();
net.createServer(serve).listen(config.port, '127.0.0.1');
if (replicaof) connectToMaster();

// Reference Redis solution used to verify the Redis tester. Spoilers!
import net from 'node:net';
import { parse } from '../../lib/protocols/resp.mjs';

const enc = {
  simple: s => `+${s}\r\n`,
  error: s => `-${s}\r\n`,
  int: n => `:${n}\r\n`,
  bulk: s => (s === null || s === undefined ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n${s}\r\n`),
  nullArray: () => '*-1\r\n',
  array: items => (items === null ? '*-1\r\n' : `*${items.length}\r\n${items.map(x => (typeof x === 'string' && /^[*$+:\-]/.test(x) && x.endsWith('\r\n') ? x : enc.bulk(x))).join('')}`),
  raw: items => `*${items.length}\r\n${items.join('')}`,
};

const db = new Map(); // key -> { type, value, expiresAt }
const blocked = new Map(); // list key -> [{ socket, keys, timer }]

function getEntry(key) {
  const e = db.get(key);
  if (!e) return null;
  if (e.expiresAt && Date.now() >= e.expiresAt) { db.delete(key); return null; }
  return e;
}

function getList(key, create = false) {
  let e = getEntry(key);
  if (!e && create) { e = { type: 'list', value: [] }; db.set(key, e); }
  return e ? e.value : null;
}

function wakeBlocked(key) {
  const queue = blocked.get(key);
  const list = getList(key);
  while (queue?.length && list?.length) {
    const waiter = queue.shift();
    clearTimeout(waiter.timer);
    for (const k of waiter.keys) if (k !== key) blocked.set(k, (blocked.get(k) || []).filter(w => w !== waiter));
    waiter.socket.write(enc.array([key, list.shift()]));
  }
}

const commands = {
  PING: () => enc.simple('PONG'),
  ECHO: ([msg]) => enc.bulk(msg),
  SET: ([key, value, ...opts]) => {
    let expiresAt = null;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i].toUpperCase();
      if (o === 'PX') expiresAt = Date.now() + Number(opts[++i]);
      else if (o === 'EX') expiresAt = Date.now() + Number(opts[++i]) * 1000;
    }
    db.set(key, { type: 'string', value, expiresAt });
    return enc.simple('OK');
  },
  GET: ([key]) => enc.bulk(getEntry(key)?.value ?? null),
  RPUSH: ([key, ...values]) => {
    const list = getList(key, true);
    list.push(...values);
    const n = list.length;
    wakeBlocked(key);
    return enc.int(n);
  },
  LPUSH: ([key, ...values]) => {
    const list = getList(key, true);
    for (const v of values) list.unshift(v);
    const n = list.length;
    wakeBlocked(key);
    return enc.int(n);
  },
  LRANGE: ([key, a, b]) => {
    const list = getList(key) || [];
    let start = Number(a), stop = Number(b);
    const n = list.length;
    if (start < 0) start = Math.max(n + start, 0);
    if (stop < 0) stop = n + stop;
    if (start >= n || start > stop) return enc.array([]);
    return enc.array(list.slice(start, Math.min(stop, n - 1) + 1));
  },
  LLEN: ([key]) => enc.int(getList(key)?.length ?? 0),
  LPOP: ([key, count]) => {
    const list = getList(key);
    if (count === undefined) return enc.bulk(list?.length ? list.shift() : null);
    if (!list) return enc.nullArray();
    return enc.array(list.splice(0, Number(count)));
  },
  BLPOP: (args, socket) => {
    const timeout = Number(args.at(-1));
    const keys = args.slice(0, -1);
    for (const k of keys) {
      const list = getList(k);
      if (list?.length) return enc.array([k, list.shift()]);
    }
    const waiter = { socket, keys, timer: null };
    for (const k of keys) blocked.set(k, [...(blocked.get(k) || []), waiter]);
    if (timeout > 0) {
      waiter.timer = setTimeout(() => {
        for (const k of keys) blocked.set(k, (blocked.get(k) || []).filter(w => w !== waiter));
        socket.write(enc.nullArray());
      }, timeout * 1000);
    }
    return null;
  },
};

function handle(socket, args) {
  const name = String(args[0]).toUpperCase();
  const fn = commands[name];
  if (!fn) return enc.error(`ERR unknown command '${args[0]}'`);
  return fn(args.slice(1), socket);
}

const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const parsed = parse(buffer);
      if (!parsed) break;
      buffer = buffer.subarray(parsed.length);
      const args = parsed.value.value.map(v => v.value);
      const reply = handle(socket, args);
      if (reply !== null) socket.write(reply);
    }
  });
  socket.on('error', () => {});
});

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 6379;
server.listen(port, '127.0.0.1');

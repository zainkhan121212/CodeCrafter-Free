// Reference Kafka broker used to verify the Kafka tester. Spoilers!
import net from 'node:net';
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Reader, Writer, splitBatches } from '../../lib/protocols/kafka.mjs';

let logDir = '/tmp/kraft-combined-logs';
if (process.argv[2] && existsSync(process.argv[2])) {
  const m = readFileSync(process.argv[2], 'utf8').match(/^log\.dirs=(.+)$/m);
  if (m) logDir = m[1].trim();
}

function metadata() {
  const topics = new Map(); // name -> { id, partitions: Set }
  const byId = new Map();
  const file = join(logDir, '__cluster_metadata-0', '00000000000000000000.log');
  if (!existsSync(file)) return { topics, byId };
  for (const { bytes } of splitBatches(readFileSync(file)).batches) {
    const r = new Reader(bytes);
    r.pos = 57;
    const count = r.int32();
    for (let i = 0; i < count; i++) {
      const len = r.varint();
      const end = r.pos + len;
      r.int8(); r.varint(); r.varint();
      const keyLen = r.varint(); if (keyLen > 0) r.bytes(keyLen);
      const valueLen = r.varint();
      const v = new Reader(r.bytes(valueLen));
      r.pos = end;
      v.int8();
      const type = v.int8();
      v.int8();
      if (type === 2) {
        const name = v.compactString();
        const id = v.uuid();
        const t = { name, id, partitions: new Set() };
        topics.set(name, t);
        byId.set(id, t);
      } else if (type === 3) {
        const partition = v.int32();
        const id = v.uuid();
        byId.get(id)?.partitions.add(partition);
      }
    }
  }
  return { topics, byId };
}

const API_KEYS = [[0, 0, 11], [1, 0, 16], [18, 0, 4], [75, 0, 0]];

function handle(req) {
  const r = new Reader(req);
  const apiKey = r.int16(), version = r.int16(), correlationId = r.int32();
  r.string(); r.tags();
  const w = new Writer().int32(correlationId);
  if (apiKey === 18) {
    if (version < 0 || version > 4) return w.int16(35).frame();
    return w.int16(0).compactArray(API_KEYS, (x, [k, min, max]) => x.int16(k).int16(min).int16(max).tags()).int32(0).tags().frame();
  }
  w.tags(); // response header v1
  const meta = metadata();
  if (apiKey === 75) {
    const names = r.compactArray(x => { const n = x.compactString(); x.tags(); return n; }) || [];
    w.int32(0).compactArray([...names].sort(), (x, name) => {
      const t = meta.topics.get(name);
      x.int16(t ? 0 : 3).compactString(name).uuid(t ? t.id : '00000000-0000-0000-0000-000000000000').bool(false)
        .compactArray(t ? [...t.partitions].sort() : [], (y, p) => y.int16(0).int32(p).int32(1).int32(0)
          .compactArray([1], (z, n) => z.int32(n)).compactArray([1], (z, n) => z.int32(n))
          .compactArray([], () => {}).compactArray([], () => {}).compactArray([], () => {}).tags())
        .int32(0x0df8).tags();
    }).raw([0xff]).tags();
    return w.frame();
  }
  if (apiKey === 1) {
    r.int32(); r.int32(); r.int32(); r.int8(); r.int32(); r.int32();
    const topics = r.compactArray(x => {
      const id = x.uuid();
      const parts = x.compactArray(y => { const p = y.int32(); y.int32(); y.int64(); y.int32(); y.int64(); y.int32(); y.tags(); return p; });
      x.tags();
      return { id, parts };
    }) || [];
    w.int32(0).int16(0).int32(0).compactArray(topics, (x, t) => {
      const topic = meta.byId.get(t.id);
      x.uuid(t.id).compactArray(t.parts, (y, p) => {
        const file = topic && join(logDir, `${topic.name}-${p}`, '00000000000000000000.log');
        const records = file && existsSync(file) ? readFileSync(file) : null;
        y.int32(p).int16(topic ? 0 : 100).int64(0).int64(0).int64(0).compactArray([], () => {}).int32(-1).compactBytes(records || Buffer.alloc(0)).tags();
      }).tags();
    }).tags();
    return w.frame();
  }
  if (apiKey === 0) {
    r.compactString(); r.int16(); r.int32();
    const topics = r.compactArray(x => {
      const name = x.compactString();
      const parts = x.compactArray(y => { const index = y.int32(); const records = y.compactBytes(); y.tags(); return { index, records }; });
      x.tags();
      return { name, parts };
    }) || [];
    w.compactArray(topics, (x, t) => {
      const topic = meta.topics.get(t.name);
      x.compactString(t.name).compactArray(t.parts, (y, p) => {
        const ok = topic && topic.partitions.has(p.index);
        if (ok) {
          const dir = join(logDir, `${t.name}-${p.index}`);
          mkdirSync(dir, { recursive: true });
          appendFileSync(join(dir, '00000000000000000000.log'), p.records);
        }
        y.int32(p.index).int16(ok ? 0 : 3).int64(ok ? 0 : -1).int64(-1).int64(ok ? 0 : -1).compactArray([], () => {}).uvarint(0).tags();
      }).tags();
    }).int32(0).tags();
    return w.frame();
  }
  return w.frame();
}

net.createServer(socket => {
  let buf = Buffer.alloc(0);
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readInt32BE(0)) {
      const len = buf.readInt32BE(0);
      const req = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      socket.write(handle(req));
    }
  });
  socket.on('error', () => {});
}).listen(9092, '127.0.0.1');

// Kafka wire protocol pieces for the Kafka tester: primitive readers/writers, record batches (with CRC-32C),
// cluster metadata records, and the request/response formats used by the course.
import { randomBytes } from 'node:crypto';

// ---------- CRC-32C (Castagnoli) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
export function crc32c(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------- writer ----------
export class Writer {
  constructor() { this.parts = []; }
  raw(b) { this.parts.push(Buffer.from(b)); return this; }
  int8(n) { const b = Buffer.alloc(1); b.writeInt8(n); return this.raw(b); }
  int16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); return this.raw(b); }
  int32(n) { const b = Buffer.alloc(4); b.writeInt32BE(n); return this.raw(b); }
  uint32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return this.raw(b); }
  int64(n) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return this.raw(b); }
  bool(v) { return this.int8(v ? 1 : 0); }
  uvarint(n) {
    const out = [];
    let v = n >>> 0;
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
    return this.raw(out);
  }
  varint(n) { return this.uvarint(((n << 1) ^ (n >> 31)) >>> 0); }
  uuid(hex) { return this.raw(Buffer.from(hex.replace(/-/g, ''), 'hex')); }
  string(s) { const b = Buffer.from(s); return this.int16(b.length).raw(b); }
  nullableString(s) { return s === null ? this.int16(-1) : this.string(s); }
  compactString(s) { const b = Buffer.from(s); return this.uvarint(b.length + 1).raw(b); }
  compactNullableString(s) { return s === null ? this.uvarint(0) : this.compactString(s); }
  compactBytes(b) { return b === null ? this.uvarint(0) : this.uvarint(b.length + 1).raw(b); }
  compactArray(items, fn) { this.uvarint(items.length + 1); items.forEach(x => fn(this, x)); return this; }
  tags() { return this.uvarint(0); }
  build() { return Buffer.concat(this.parts); }
  // Prefixes the content with its int32 length (a full request/response frame).
  frame() { const body = this.build(); const len = Buffer.alloc(4); len.writeInt32BE(body.length); return Buffer.concat([len, body]); }
}

// ---------- reader ----------
export class KafkaDecodeError extends Error {}
export class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  need(n, what) { if (this.pos + n > this.buf.length) throw new KafkaDecodeError(`Response ended early while reading ${what} (offset ${this.pos}, need ${n} byte(s), ${this.buf.length - this.pos} left)`); }
  int8(what = 'int8') { this.need(1, what); return this.buf.readInt8(this.pos++); }
  int16(what = 'int16') { this.need(2, what); const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  int32(what = 'int32') { this.need(4, what); const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  uint32(what = 'uint32') { this.need(4, what); const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  int64(what = 'int64') { this.need(8, what); const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return Number(v); }
  bool(what) { return this.int8(what) !== 0; }
  uvarint(what = 'varint') {
    let v = 0, shift = 0;
    for (;;) {
      this.need(1, what);
      const b = this.buf[this.pos++];
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
      shift += 7;
      if (shift > 28) throw new KafkaDecodeError(`Invalid varint while reading ${what}`);
    }
  }
  varint(what) { const z = this.uvarint(what); return (z >>> 1) ^ -(z & 1); }
  bytes(n, what = 'bytes') { this.need(n, what); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  uuid(what = 'uuid') { const h = this.bytes(16, what).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
  string(what) { const n = this.int16(what); return n < 0 ? null : this.bytes(n, what).toString('utf8'); }
  compactString(what) { const n = this.uvarint(what); return n === 0 ? null : this.bytes(n - 1, what).toString('utf8'); }
  compactBytes(what) { const n = this.uvarint(what); return n === 0 ? null : this.bytes(n - 1, what); }
  compactArray(fn, what = 'array') { const n = this.uvarint(what); if (n === 0) return null; const out = []; for (let i = 0; i < n - 1; i++) out.push(fn(this, i)); return out; }
  tags(what = 'tagged fields') {
    const n = this.uvarint(what);
    for (let i = 0; i < n; i++) { this.uvarint(what); const size = this.uvarint(what); this.bytes(size, what); }
  }
  remaining() { return this.buf.length - this.pos; }
  done(what = 'response') { if (this.remaining()) throw new KafkaDecodeError(`${this.remaining()} unexpected extra byte(s) at the end of the ${what}`); }
}

// ---------- record batches ----------
export function record({ key = null, value, offsetDelta = 0, timestampDelta = 0 }) {
  const w = new Writer().int8(0).varint(timestampDelta).varint(offsetDelta);
  if (key === null) w.varint(-1); else w.varint(key.length).raw(key);
  if (value === null) w.varint(-1); else w.varint(value.length).raw(value);
  w.uvarint(0); // headers
  const body = w.build();
  return new Writer().varint(body.length).raw(body).build();
}

export function recordBatch({ baseOffset = 0, values, timestamp = Date.now(), producerId = -1 }) {
  const records = values.map((value, i) => record({ value: Buffer.isBuffer(value) ? value : Buffer.from(value), offsetDelta: i }));
  const afterCrc = new Writer()
    .int16(0) // attributes
    .int32(values.length - 1) // last offset delta
    .int64(timestamp).int64(timestamp)
    .int64(producerId).int16(-1).int32(-1)
    .int32(values.length)
    .raw(Buffer.concat(records)).build();
  const crc = crc32c(afterCrc);
  const afterLength = new Writer().int32(0).int8(2).uint32(crc).raw(afterCrc).build();
  return new Writer().int64(baseOffset).int32(afterLength.length).raw(afterLength).build();
}

// Splits a concatenation of record batches; returns [{ baseOffset, recordCount, bytes }].
export function splitBatches(buf) {
  const out = [];
  let pos = 0;
  while (pos + 12 <= buf.length) {
    const len = buf.readInt32BE(pos + 8);
    if (pos + 12 + len > buf.length) break;
    const bytes = buf.subarray(pos, pos + 12 + len);
    out.push({ baseOffset: Number(buf.readBigInt64BE(pos)), recordCount: bytes.readInt32BE(57), bytes });
    pos += 12 + len;
  }
  return { batches: out, rest: buf.length - pos };
}

// ---------- cluster metadata (__cluster_metadata-0) ----------
export const newUuid = () => {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const featureLevelRecord = () => new Writer().int8(1).int8(12).int8(0).compactString('metadata.version').int16(20).tags().build();
const topicRecord = (name, id) => new Writer().int8(1).int8(2).int8(0).compactString(name).uuid(id).tags().build();
const partitionRecord = (partition, topicId) => new Writer().int8(1).int8(3).int8(1)
  .int32(partition).uuid(topicId)
  .compactArray([1], (w, x) => w.int32(x)) // replicas
  .compactArray([1], (w, x) => w.int32(x)) // isr
  .compactArray([], () => {}) // removing replicas
  .compactArray([], () => {}) // adding replicas
  .int32(1).int32(0).int32(0) // leader, leader epoch, partition epoch
  .compactArray([newUuid()], (w, x) => w.uuid(x)) // directories
  .tags().build();

// topics: [{ name, id, partitions: [0, 1, ...] }]
export function clusterMetadataLog(topics) {
  let offset = 0;
  const batches = [recordBatch({ baseOffset: offset++, values: [featureLevelRecord()] })];
  for (const t of topics) {
    const values = [topicRecord(t.name, t.id), ...t.partitions.map(p => partitionRecord(p, t.id))];
    batches.push(recordBatch({ baseOffset: offset, values }));
    offset += values.length;
  }
  return Buffer.concat(batches);
}

// ---------- requests (client side) ----------
const header = (w, apiKey, apiVersion, correlationId, clientId = 'kafka-cli') => w.int16(apiKey).int16(apiVersion).int32(correlationId).nullableString(clientId).tags();

export const apiVersionsRequest = (correlationId, version = 4) =>
  header(new Writer(), 18, version, correlationId).compactString('kafka-cli').compactString('0.1').tags().frame();

// The cursor is nullable; null is encoded as a single 0xff byte.
export const describeTopicPartitionsRequest = (correlationId, names) =>
  header(new Writer(), 75, 0, correlationId).compactArray(names, (w, n) => w.compactString(n).tags()).int32(100).raw([0xff]).tags().frame();

export const fetchRequest = (correlationId, topics) =>
  header(new Writer(), 1, 16, correlationId)
    .int32(500).int32(1).int32(52428800).int8(0).int32(0).int32(0)
    .compactArray(topics, (w, t) => w.uuid(t.id).compactArray(t.partitions, (w2, p) => w2.int32(p).int32(-1).int64(0).int32(-1).int64(-1).int32(1048576).tags()).tags())
    .compactArray([], () => {})
    .compactString('')
    .tags().frame();

// topics: [{ name, partitions: [{ index, records: Buffer }] }]
export const produceRequest = (correlationId, topics) =>
  header(new Writer(), 0, 11, correlationId)
    .uvarint(0) // transactional_id: null
    .int16(-1).int32(1500)
    .compactArray(topics, (w, t) => w.compactString(t.name).compactArray(t.partitions, (w2, p) => w2.int32(p.index).compactBytes(p.records).tags()).tags())
    .tags().frame();

// ---------- responses (decoded by the tester) ----------
export function decodeApiVersionsResponse(r) {
  const errorCode = r.int16('error_code');
  if (errorCode !== 0 && r.remaining() === 0) return { errorCode, apiKeys: [] };
  const apiKeys = r.compactArray(x => { const k = { apiKey: x.int16('api_key'), min: x.int16('min_version'), max: x.int16('max_version') }; x.tags(); return k; }, 'api_keys') || [];
  const throttle = r.int32('throttle_time_ms');
  r.tags();
  return { errorCode, apiKeys, throttle };
}

export function decodeDescribeTopicPartitionsResponse(r) {
  const throttle = r.int32('throttle_time_ms');
  const topics = r.compactArray(x => {
    const t = { errorCode: x.int16('topic error_code'), name: x.compactString('topic_name'), id: x.uuid('topic_id'), isInternal: x.bool('is_internal') };
    t.partitions = x.compactArray(p => {
      const part = { errorCode: p.int16('partition error_code'), index: p.int32('partition_index'), leaderId: p.int32('leader_id'), leaderEpoch: p.int32('leader_epoch') };
      for (const f of ['replica_nodes', 'isr_nodes', 'eligible_leader_replicas', 'last_known_elr', 'offline_replicas']) p.compactArray(y => y.int32(f), f);
      p.tags();
      return part;
    }, 'partitions') || [];
    t.authorizedOperations = x.int32('topic_authorized_operations');
    x.tags();
    return t;
  }, 'topics') || [];
  const cursorByte = r.buf[r.pos];
  let nextCursor = null;
  if (cursorByte === 0xff) r.pos++;
  else { nextCursor = { topic: r.compactString('cursor topic'), partition: r.int32('cursor partition') }; r.tags(); }
  r.tags();
  return { throttle, topics, nextCursor };
}

export function decodeFetchResponse(r) {
  const out = { throttle: r.int32('throttle_time_ms'), errorCode: r.int16('error_code'), sessionId: r.int32('session_id') };
  out.responses = r.compactArray(x => {
    const t = { topicId: x.uuid('topic_id') };
    t.partitions = x.compactArray(p => {
      const part = { index: p.int32('partition_index'), errorCode: p.int16('error_code'), highWatermark: p.int64('high_watermark'), lastStableOffset: p.int64('last_stable_offset'), logStartOffset: p.int64('log_start_offset') };
      p.compactArray(a => { a.int64('producer_id'); a.int64('first_offset'); a.tags(); }, 'aborted_transactions');
      part.preferredReadReplica = p.int32('preferred_read_replica');
      part.records = p.compactBytes('records');
      p.tags();
      return part;
    }, 'partitions') || [];
    x.tags();
    return t;
  }, 'responses') || [];
  r.tags();
  return out;
}

export function decodeProduceResponse(r) {
  const topics = r.compactArray(x => {
    const t = { name: x.compactString('name') };
    t.partitions = x.compactArray(p => {
      const part = { index: p.int32('index'), errorCode: p.int16('error_code'), baseOffset: p.int64('base_offset'), logAppendTimeMs: p.int64('log_append_time_ms'), logStartOffset: p.int64('log_start_offset') };
      p.compactArray(e => { e.int32('batch_index'); e.compactString('batch_index_error_message'); e.tags(); }, 'record_errors');
      p.compactString('error_message');
      p.tags();
      return part;
    }, 'partition_responses') || [];
    x.tags();
    return t;
  }, 'responses') || [];
  const throttle = r.int32('throttle_time_ms');
  r.tags();
  return { topics, throttle };
}

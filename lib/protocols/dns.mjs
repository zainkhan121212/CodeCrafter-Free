// DNS message encoding/decoding (RFC 1035) for the DNS server tester.

export function encodeName(name) {
  const parts = name.split('.').filter(Boolean).map(l => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)]));
  return Buffer.concat([...parts, Buffer.from([0])]);
}

export function encodeHeader({ id, qr = 0, opcode = 0, aa = 0, tc = 0, rd = 0, ra = 0, z = 0, rcode = 0, qdcount = 0, ancount = 0, nscount = 0, arcount = 0 }) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(id, 0);
  h.writeUInt16BE((qr << 15) | (opcode << 11) | (aa << 10) | (tc << 9) | (rd << 8) | (ra << 7) | (z << 4) | rcode, 2);
  h.writeUInt16BE(qdcount, 4);
  h.writeUInt16BE(ancount, 6);
  h.writeUInt16BE(nscount, 8);
  h.writeUInt16BE(arcount, 10);
  return h;
}

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

// Builds a query. With `compress`, each later question whose name shares a suffix with an earlier one
// encodes its first label and then points at that suffix.
export function buildQuery({ id, opcode = 0, rd = 0, questions, compress = false }) {
  const parts = [encodeHeader({ id, opcode, rd, qdcount: questions.length })];
  let offset = 12;
  const suffixes = new Map();
  for (const { name, type = 1, cls = 1 } of questions) {
    const labels = name.split('.');
    let encoded = null;
    if (compress) {
      for (let i = 1; i < labels.length; i++) {
        const suffix = labels.slice(i).join('.');
        if (suffixes.has(suffix)) {
          const prefix = labels.slice(0, i).map(l => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
          encoded = Buffer.concat([...prefix, u16(0xc000 | suffixes.get(suffix))]);
          break;
        }
      }
    }
    if (!encoded) {
      encoded = encodeName(name);
      let pos = offset;
      for (let i = 0; i < labels.length; i++) {
        suffixes.set(labels.slice(i).join('.'), pos);
        pos += labels[i].length + 1;
      }
    }
    parts.push(encoded, u16(type), u16(cls));
    offset += encoded.length + 4;
  }
  return Buffer.concat(parts);
}

export function buildResponse({ id, rd = 1, questions, answers, opcode = 0, rcode = 0 }) {
  const parts = [encodeHeader({ id, qr: 1, opcode, rd, ra: 1, rcode, qdcount: questions.length, ancount: answers.length })];
  for (const q of questions) parts.push(encodeName(q.name), u16(q.type ?? 1), u16(q.cls ?? 1));
  for (const a of answers) {
    const ip = Buffer.from(a.ip.split('.').map(Number));
    parts.push(encodeName(a.name), u16(1), u16(1), u32(a.ttl ?? 60), u16(4), ip);
  }
  return Buffer.concat(parts);
}

export class DnsParseError extends Error {}

function decodeName(buf, pos, depth = 0) {
  const labels = [];
  let end = null;
  for (let guard = 0; guard < 128; guard++) {
    if (pos >= buf.length) throw new DnsParseError('Domain name runs past the end of the packet');
    const len = buf[pos];
    if (len === 0) return { name: labels.join('.'), next: end ?? pos + 1 };
    if ((len & 0xc0) === 0xc0) {
      if (depth > 10) throw new DnsParseError('Too many compression pointers');
      const ptr = buf.readUInt16BE(pos) & 0x3fff;
      const rest = decodeName(buf, ptr, depth + 1);
      if (rest.name) labels.push(rest.name);
      return { name: labels.join('.'), next: end ?? pos + 2 };
    }
    if (len > 63) throw new DnsParseError(`Invalid label length ${len}`);
    labels.push(buf.toString('latin1', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  throw new DnsParseError('Domain name is too long');
}

export function parseMessage(buf) {
  if (buf.length < 12) throw new DnsParseError(`Expected at least 12 bytes (the header), got ${buf.length}`);
  const flags = buf.readUInt16BE(2);
  const header = {
    id: buf.readUInt16BE(0), qr: flags >> 15, opcode: (flags >> 11) & 0xf, aa: (flags >> 10) & 1, tc: (flags >> 9) & 1,
    rd: (flags >> 8) & 1, ra: (flags >> 7) & 1, z: (flags >> 4) & 7, rcode: flags & 0xf,
    qdcount: buf.readUInt16BE(4), ancount: buf.readUInt16BE(6), nscount: buf.readUInt16BE(8), arcount: buf.readUInt16BE(10),
  };
  let pos = 12;
  const questions = [];
  for (let i = 0; i < header.qdcount; i++) {
    const { name, next } = decodeName(buf, pos);
    if (next + 4 > buf.length) throw new DnsParseError(`Question ${i + 1} is truncated`);
    questions.push({ name, type: buf.readUInt16BE(next), cls: buf.readUInt16BE(next + 2) });
    pos = next + 4;
  }
  const answers = [];
  for (let i = 0; i < header.ancount; i++) {
    const { name, next } = decodeName(buf, pos);
    if (next + 10 > buf.length) throw new DnsParseError(`Answer ${i + 1} is truncated`);
    const rdlength = buf.readUInt16BE(next + 8);
    if (next + 10 + rdlength > buf.length) throw new DnsParseError(`Answer ${i + 1} RDATA is truncated`);
    const rdata = buf.subarray(next + 10, next + 10 + rdlength);
    answers.push({ name, type: buf.readUInt16BE(next), cls: buf.readUInt16BE(next + 2), ttl: buf.readUInt32BE(next + 4), rdlength, rdata, ip: rdlength === 4 ? [...rdata].join('.') : null });
    pos = next + 10 + rdlength;
  }
  return { header, questions, answers };
}

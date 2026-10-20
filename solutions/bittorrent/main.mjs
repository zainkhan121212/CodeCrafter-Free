// Reference BitTorrent client used to verify the BitTorrent tester. Spoilers!
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { encode, decode, toJSONValue, infoSpan } from '../../lib/protocols/bencode.mjs';

const sha1 = b => createHash('sha1').update(b).digest();
const [command, ...args] = process.argv.slice(2);
const PEER_ID = randomBytes(20);
const BLOCK = 16384;

function readTorrent(path) {
  const buf = readFileSync(path);
  const { value } = decode(buf);
  const infoBytes = infoSpan(buf);
  return { announce: value.announce.toString(), info: value.info, infoHash: sha1(infoBytes) };
}

function parseMagnet(link) {
  const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
  return { infoHash: Buffer.from(params.get('xt').replace('urn:btih:', ''), 'hex'), announce: params.get('tr'), name: params.get('dn') };
}

async function getPeers(announce, infoHash, left) {
  const q = `info_hash=${[...infoHash].map(b => `%${b.toString(16).padStart(2, '0')}`).join('')}&peer_id=${PEER_ID.toString('hex').slice(0, 20)}&port=6881&uploaded=0&downloaded=0&left=${left}&compact=1`;
  const res = Buffer.from(await (await fetch(`${announce}?${q}`)).arrayBuffer());
  const { value } = decode(res);
  if (value['failure reason']) throw new Error(value['failure reason'].toString());
  const peers = [];
  for (let i = 0; i < value.peers.length; i += 6) peers.push(`${[...value.peers.subarray(i, i + 4)].join('.')}:${value.peers.readUInt16BE(i + 4)}`);
  return peers;
}

// A connection to one peer with a simple message queue.
class Peer {
  constructor(addr, infoHash, { extensions = false } = {}) {
    this.addr = addr; this.infoHash = infoHash; this.extensions = extensions;
    this.buf = Buffer.alloc(0); this.waiters = [];
  }
  connect() {
    const [host, port] = this.addr.split(':');
    return new Promise((resolve, reject) => {
      this.sock = net.connect(Number(port), host, () => {
        const reserved = Buffer.alloc(8);
        if (this.extensions) reserved[5] = 0x10;
        this.sock.write(Buffer.concat([Buffer.from([19]), Buffer.from('BitTorrent protocol'), reserved, this.infoHash, PEER_ID]));
      });
      this.sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); const w = this.waiters; this.waiters = []; w.forEach(f => f()); });
      this.sock.on('error', reject);
      this.readExact(68).then(hs => {
        this.remoteId = hs.subarray(48, 68);
        this.remoteExtensions = !!(hs[25] & 0x10);
        resolve(this);
      }, reject);
    });
  }
  async readExact(n) {
    while (this.buf.length < n) await new Promise(r => this.waiters.push(r));
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  async message() {
    for (;;) {
      const len = (await this.readExact(4)).readUInt32BE(0);
      if (len === 0) continue;
      const m = await this.readExact(len);
      return { id: m[0], payload: m.subarray(1) };
    }
  }
  async waitFor(id) {
    for (;;) { const m = await this.message(); if (m.id === id) return m; }
  }
  send(id, payload = Buffer.alloc(0)) {
    const head = Buffer.alloc(5);
    head.writeUInt32BE(payload.length + 1);
    head[4] = id;
    this.sock.write(Buffer.concat([head, payload]));
  }
  async extensionHandshake() {
    this.send(20, Buffer.concat([Buffer.from([0]), encode({ m: { ut_metadata: 16 } })]));
    for (;;) {
      const m = await this.waitFor(20);
      if (m.payload[0] === 0) { this.peerMetadataId = decode(m.payload.subarray(1)).value.m.ut_metadata; return this.peerMetadataId; }
    }
  }
  async metadata() {
    this.send(20, Buffer.concat([Buffer.from([this.peerMetadataId]), encode({ msg_type: 0, piece: 0 })]));
    for (;;) {
      const m = await this.waitFor(20);
      if (m.payload[0] !== 16) continue;
      const { end } = decode(m.payload, 1);
      return decode(m.payload.subarray(end)).value;
    }
  }
  async ready() {
    this.send(2);
    await this.waitFor(1);
  }
  async downloadPiece(info, index) {
    const pieceLength = info['piece length'];
    const size = Math.min(pieceLength, info.length - index * pieceLength);
    const blocks = [];
    for (let begin = 0; begin < size; begin += BLOCK) {
      const p = Buffer.alloc(12);
      p.writeUInt32BE(index, 0); p.writeUInt32BE(begin, 4); p.writeUInt32BE(Math.min(BLOCK, size - begin), 8);
      this.send(6, p);
    }
    for (let got = 0; got < size;) {
      const m = await this.waitFor(7);
      const begin = m.payload.readUInt32BE(4);
      blocks.push({ begin, data: m.payload.subarray(8) });
      got += m.payload.length - 8;
    }
    const piece = Buffer.concat(blocks.sort((a, b) => a.begin - b.begin).map(b => b.data));
    if (!sha1(piece).equals(info.pieces.subarray(index * 20, index * 20 + 20))) throw new Error(`piece ${index} hash mismatch`);
    return piece;
  }
  close() { this.sock.destroy(); }
}

function printInfo(announce, info, infoHash) {
  console.log(`Tracker URL: ${announce}`);
  console.log(`Length: ${info.length}`);
  console.log(`Info Hash: ${infoHash.toString('hex')}`);
  console.log(`Piece Length: ${info['piece length']}`);
  console.log('Piece Hashes:');
  for (let i = 0; i < info.pieces.length; i += 20) console.log(info.pieces.subarray(i, i + 20).toString('hex'));
}

async function downloadAll(peers, info, infoHash, extensions, preparedPeer) {
  const count = Math.ceil(info.length / info['piece length']);
  const queue = [...Array(count).keys()];
  const pieces = new Array(count);
  const workers = peers.map(async (addr, i) => {
    const peer = i === 0 && preparedPeer ? preparedPeer : await new Peer(addr, infoHash, { extensions }).connect();
    if (!(i === 0 && preparedPeer)) { await peer.waitFor(5); if (extensions && peer.remoteExtensions) await peer.extensionHandshake(); }
    await peer.ready();
    while (queue.length) { const idx = queue.shift(); pieces[idx] = await peer.downloadPiece(info, idx); }
    peer.close();
  });
  await Promise.all(workers);
  return Buffer.concat(pieces);
}

async function magnetPeer(link) {
  const m = parseMagnet(link);
  const [addr] = await getPeers(m.announce, m.infoHash, 999);
  const peer = await new Peer(addr, m.infoHash, { extensions: true }).connect();
  await peer.waitFor(5);
  if (peer.remoteExtensions) await peer.extensionHandshake();
  return { m, peer };
}

switch (command) {
  case 'decode': console.log(JSON.stringify(toJSONValue(decode(Buffer.from(args[0])).value))); break;
  case 'info': { const t = readTorrent(args[0]); printInfo(t.announce, t.info, t.infoHash); break; }
  case 'peers': { const t = readTorrent(args[0]); for (const p of await getPeers(t.announce, t.infoHash, t.info.length)) console.log(p); break; }
  case 'handshake': { const t = readTorrent(args[0]); const p = await new Peer(args[1], t.infoHash).connect(); console.log(`Peer ID: ${p.remoteId.toString('hex')}`); p.close(); break; }
  case 'download_piece': {
    const t = readTorrent(args[2]);
    const [addr] = await getPeers(t.announce, t.infoHash, t.info.length);
    const p = await new Peer(addr, t.infoHash).connect();
    await p.waitFor(5); await p.ready();
    writeFileSync(args[1], await p.downloadPiece(t.info, Number(args[3])));
    p.close();
    break;
  }
  case 'download': {
    const t = readTorrent(args[2]);
    writeFileSync(args[1], await downloadAll(await getPeers(t.announce, t.infoHash, t.info.length), t.info, t.infoHash, false));
    break;
  }
  case 'magnet_parse': { const m = parseMagnet(args[0]); console.log(`Tracker URL: ${m.announce}`); console.log(`Info Hash: ${m.infoHash.toString('hex')}`); break; }
  case 'magnet_handshake': {
    const { peer } = await magnetPeer(args[0]);
    console.log(`Peer ID: ${peer.remoteId.toString('hex')}`);
    console.log(`Peer Metadata Extension ID: ${peer.peerMetadataId}`);
    peer.close();
    break;
  }
  case 'magnet_info': { const { m, peer } = await magnetPeer(args[0]); printInfo(m.announce, await peer.metadata(), m.infoHash); peer.close(); break; }
  case 'magnet_download_piece': {
    const { peer } = await magnetPeer(args[2]);
    const info = await peer.metadata();
    await peer.ready();
    writeFileSync(args[1], await peer.downloadPiece(info, Number(args[3])));
    peer.close();
    break;
  }
  case 'magnet_download': {
    const { m, peer } = await magnetPeer(args[2]);
    const info = await peer.metadata();
    const peers = await getPeers(m.announce, m.infoHash, info.length);
    writeFileSync(args[1], await downloadAll(peers, info, m.infoHash, true, peer));
    break;
  }
  default: console.error(`Unknown command: ${command}`); process.exit(1);
}

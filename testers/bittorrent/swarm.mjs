// A local BitTorrent "swarm" for tests: an HTTP tracker plus seeder peers that speak the peer wire protocol
// (BEP 3), the extension protocol (BEP 10) and metadata exchange (BEP 9).
import http from 'node:http';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { encode, decode } from '../../lib/protocols/bencode.mjs';

const sha1 = b => createHash('sha1').update(b).digest();
const PSTR = Buffer.from('BitTorrent protocol');

export function makeTorrent({ content, name, pieceLength = 32768, announce }) {
  const pieces = [];
  for (let off = 0; off < content.length; off += pieceLength) pieces.push(sha1(content.subarray(off, off + pieceLength)));
  const info = { length: content.length, name, 'piece length': pieceLength, pieces: Buffer.concat(pieces) };
  const infoBytes = encode(info);
  return { info, infoBytes, infoHash: sha1(infoBytes), file: encode({ announce, 'created by': 'CodeCrafter Free', info }), pieceHashes: pieces.map(p => p.toString('hex')) };
}

function percentDecodeBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%') { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else if (s[i] === '+') out.push(0x20);
    else out.push(s.charCodeAt(i));
  }
  return Buffer.from(out);
}

export class Swarm {
  constructor({ content, torrent, magnet = false, seeders = 2, log }) {
    this.content = content;
    this.torrent = torrent;
    this.magnet = magnet;
    this.seederCount = seeders;
    this.log = log;
    this.events = { announces: [], handshakes: [], extHandshakes: [], metadataRequests: [], requests: 0 };
    this.servers = [];
    this.peerId = randomBytes(20);
    this.metadataExtId = 1 + Math.floor(Math.random() * 200);
  }

  async start() {
    const tracker = http.createServer((req, res) => this.announce(req, res));
    await new Promise(r => tracker.listen(0, '127.0.0.1', r));
    this.servers.push(tracker);
    this.trackerUrl = `http://127.0.0.1:${tracker.address().port}/announce`;
    this.peers = [];
    for (let i = 0; i < this.seederCount; i++) {
      const srv = net.createServer(sock => this.serve(sock));
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      this.servers.push(srv);
      this.peers.push(`127.0.0.1:${srv.address().port}`);
    }
    return this;
  }

  close() {
    for (const s of this.servers) { s.close(); s.closeAllConnections?.(); }
    for (const sock of this.sockets || []) sock.destroy();
  }

  announce(req, res) {
    const query = (req.url.split('?')[1] || '').split('&').map(kv => kv.split('='));
    const params = Object.fromEntries(query.map(([k, v]) => [k, v ?? '']));
    const infoHash = percentDecodeBytes(params.info_hash || '');
    this.events.announces.push({ params, infoHash });
    const fail = reason => { res.writeHead(200); res.end(encode({ 'failure reason': reason })); };
    if (!infoHash.equals(this.torrent.infoHash)) return fail(`info_hash does not match (expected the raw 20-byte SHA-1 of the info dictionary, URL-encoded)`);
    for (const p of ['peer_id', 'port', 'compact']) if (!(p in params)) return fail(`missing query parameter: ${p}`);
    const peers = Buffer.concat(this.peers.map(p => {
      const [ip, port] = p.split(':');
      const b = Buffer.alloc(6);
      ip.split('.').forEach((x, i) => { b[i] = Number(x); });
      b.writeUInt16BE(Number(port), 4);
      return b;
    }));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(encode({ interval: 60, 'min interval': 60, complete: this.peers.length, incomplete: 0, peers }));
  }

  serve(sock) {
    (this.sockets ??= new Set()).add(sock);
    sock.on('close', () => this.sockets.delete(sock));
    sock.on('error', () => {});
    let buf = Buffer.alloc(0);
    let handshaken = false;
    let clientMetadataId = null;
    const send = (id, payload = Buffer.alloc(0)) => {
      const head = Buffer.alloc(5);
      head.writeUInt32BE(payload.length + 1);
      head[4] = id;
      sock.write(Buffer.concat([head, payload]));
    };
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (!handshaken) {
        if (buf.length < 68) return;
        const hs = buf.subarray(0, 68);
        buf = buf.subarray(68);
        const reserved = hs.subarray(20, 28);
        const infoHash = hs.subarray(28, 48);
        this.events.handshakes.push({ valid: hs[0] === 19 && hs.subarray(1, 20).equals(PSTR), reserved: Buffer.from(reserved), infoHash: Buffer.from(infoHash) });
        if (!infoHash.equals(this.torrent.infoHash)) { sock.destroy(); return; }
        const ourReserved = Buffer.alloc(8);
        if (this.magnet) ourReserved[5] = 0x10;
        sock.write(Buffer.concat([Buffer.from([19]), PSTR, ourReserved, this.torrent.infoHash, this.peerId]));
        handshaken = true;
        const pieces = Math.ceil(this.content.length / this.torrent.info['piece length']);
        const bitfield = Buffer.alloc(Math.ceil(pieces / 8));
        for (let i = 0; i < pieces; i++) bitfield[i >> 3] |= 0x80 >> (i & 7);
        send(5, bitfield);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < 4 + len) break;
        const msg = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        if (len === 0) continue; // keep-alive
        const id = msg[0];
        const payload = msg.subarray(1);
        if (id === 2) send(1); // interested -> unchoke
        else if (id === 6) {
          const index = payload.readUInt32BE(0), begin = payload.readUInt32BE(4), length = payload.readUInt32BE(8);
          this.events.requests++;
          const start = index * this.torrent.info['piece length'] + begin;
          const block = this.content.subarray(start, start + length);
          const head = Buffer.alloc(8);
          head.writeUInt32BE(index, 0);
          head.writeUInt32BE(begin, 4);
          send(7, Buffer.concat([head, block]));
        } else if (id === 20) {
          const extId = payload[0];
          const body = payload.subarray(1);
          if (extId === 0) {
            let dict = null;
            try { dict = decode(body).value; } catch { /* invalid */ }
            const utm = dict?.m?.ut_metadata;
            this.events.extHandshakes.push({ dict, utMetadata: typeof utm === 'number' ? utm : null });
            clientMetadataId = typeof utm === 'number' ? utm : null;
            send(20, Buffer.concat([Buffer.from([0]), encode({ m: { ut_metadata: this.metadataExtId }, metadata_size: this.torrent.infoBytes.length })]));
          } else if (extId === this.metadataExtId) {
            let dict = null;
            try { dict = decode(body).value; } catch { /* invalid */ }
            this.events.metadataRequests.push(dict);
            if (dict?.msg_type === 0 && clientMetadataId) {
              const header = encode({ msg_type: 1, piece: dict.piece ?? 0, total_size: this.torrent.infoBytes.length });
              send(20, Buffer.concat([Buffer.from([clientMetadataId]), header, this.torrent.infoBytes]));
            }
          }
        }
      }
    });
  }
}

export function magnetLink(torrent, name, trackerUrl) {
  return `magnet:?xt=urn:btih:${torrent.infoHash.toString('hex')}&dn=${encodeURIComponent(name)}&tr=${encodeURIComponent(trackerUrl)}`;
}

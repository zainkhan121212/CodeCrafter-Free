// BitTorrent tester. Everything runs locally: the tester creates a random file and .torrent, and starts an HTTP
// tracker plus seeder peers on 127.0.0.1, so no internet connection is needed.
import { writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { word, words, randInt, pick } from '../../lib/harness/random.mjs';
import { Swarm, makeTorrent, magnetLink } from './swarm.mjs';

const PIECE = 32768;

async function run(t, args, { cwd, timeout = 15000 } = {}) {
  t.log.info(`$ ./your_program.sh ${args.map(a => (/[\s&?]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const r = await t.exec(args, { cwd, timeout });
  if (r.exitCode !== 0) throw new TestFailure(`Expected exit code 0, got ${r.exitCode}`);
  return r;
}

async function decodeCase(t, bencoded, expected) {
  const { stdout } = await run(t, ['decode', bencoded]);
  let actual;
  try { actual = JSON.parse(stdout.trim()); } catch { throw new TestFailure(`Expected JSON output ${JSON.stringify(JSON.stringify(expected))}, got ${JSON.stringify(stdout)}`); }
  if (!isDeepStrictEqual(actual, expected)) throw new TestFailure(`Expected ${JSON.stringify(expected)}, got ${stdout.trim()}`);
  t.log.success(`✓ Output is ${JSON.stringify(expected)}`);
}

// Checks that `expected` lines appear in stdout, in order (extra lines from later stages are fine).
function expectLines(t, stdout, expected) {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
  let i = 0;
  for (const want of expected) {
    while (i < lines.length && lines[i] !== want) i++;
    if (i === lines.length) throw new TestFailure(`Expected output to contain the line ${JSON.stringify(want)} (in order).\nGot:\n${stdout}`);
    i++;
  }
  t.log.success(`✓ Output contains the expected ${expected.length} line(s)`);
}

async function fixture(t, { magnet = false, pieces = randInt(3, 5), seeders = 2 } = {}) {
  const dir = await t.tmpDir('ccfree-bt-');
  const name = `${word()}.${pick(['txt', 'iso', 'gif', 'bin'])}`;
  const content = randomBytes(PIECE * (pieces - 1) + randInt(1000, PIECE - 1));
  const swarm = new Swarm({ content, torrent: null, magnet, seeders, log: t.log });
  await swarm.start(); // starts the tracker so we know its URL
  swarm.torrent = makeTorrent({ content, name, pieceLength: PIECE, announce: swarm.trackerUrl });
  t.onCleanup(() => swarm.close());
  await writeFile(join(dir, 'sample.torrent'), swarm.torrent.file);
  t.log.info(`Created sample.torrent for ${name} (${content.length} bytes, ${pieces} pieces); tracker at ${swarm.trackerUrl}`);
  return { dir, swarm, content, name, torrent: swarm.torrent, magnet: magnetLink(swarm.torrent, name, swarm.trackerUrl) };
}

const infoLines = f => [
  `Tracker URL: ${f.swarm.trackerUrl}`,
  `Length: ${f.content.length}`,
  `Info Hash: ${f.torrent.infoHash.toString('hex')}`,
  `Piece Length: ${PIECE}`,
  'Piece Hashes:',
  ...f.torrent.pieceHashes,
];

async function expectFile(t, path, expected, what) {
  const data = await readFile(path).catch(() => null);
  if (!data) throw new TestFailure(`Expected ${what} to be written to ${path}`);
  if (data.length !== expected.length) throw new TestFailure(`Expected ${what} to be ${expected.length} bytes, got ${data.length}`);
  if (!data.equals(expected)) throw new TestFailure(`${what} contents do not match`);
  t.log.success(`✓ ${what} was downloaded correctly (${expected.length} bytes)`);
}

function checkExtensionBit(t, swarm) {
  const hs = swarm.events.handshakes.at(-1);
  if (!hs) throw new TestFailure('No handshake was received from your program');
  if (!(hs.reserved[5] & 0x10)) throw new TestFailure(`Expected the extension protocol bit (20th bit from the right, reserved[5] = 0x10) to be set in your handshake, got reserved bytes ${hs.reserved.toString('hex')}`);
  t.log.success('✓ Handshake announces extension protocol support');
}

function checkExtensionHandshake(t, swarm) {
  const ext = swarm.events.extHandshakes.at(-1);
  if (!ext) throw new TestFailure('Expected to receive an extension handshake message (message id 20, extended message id 0)');
  if (!(ext.utMetadata >= 1 && ext.utMetadata <= 255)) throw new TestFailure(`Expected the extension handshake to contain {"m": {"ut_metadata": <1-255>}}, got ${JSON.stringify(ext.dict && Object.keys(ext.dict))}`);
  t.log.success(`✓ Received extension handshake with ut_metadata ID ${ext.utMetadata}`);
}

export const stages = {
  async ns2(t) {
    for (const s of [word(), `${word()}:${word()}`, words(2).join(' ')]) await decodeCase(t, `${Buffer.byteLength(s)}:${s}`, s);
  },
  async eb4(t) {
    for (const n of [randInt(1, 999), -randInt(1, 999), 4294967300 + randInt(0, 99), 0]) await decodeCase(t, `i${n}e`, n);
  },
  async ah1(t) {
    const w = word(), n = randInt(1, 999);
    await decodeCase(t, 'le', []);
    await decodeCase(t, `l${w.length}:${w}i${n}ee`, [w, n]);
    await decodeCase(t, `lli${n}e${w.length}:${w}ee`, [[n, w]]);
  },
  async mn6(t) {
    const [a, b] = words(2).sort();
    const n = randInt(1, 999);
    await decodeCase(t, 'de', {});
    await decodeCase(t, `d${a.length}:${a}${b.length}:${b}${b.length}:${b}i${n}ee`, { [a]: b, [b]: n });
    await decodeCase(t, `d10:inner_dictd4:key16:value14:key2i42e8:list_keyl5:item15:item2i3eeee`, { inner_dict: { key1: 'value1', key2: 42, list_key: ['item1', 'item2', 3] } });
  },
  async ow9(t) {
    const f = await fixture(t);
    expectLines(t, (await run(t, ['info', 'sample.torrent'], { cwd: f.dir })).stdout, infoLines(f).slice(0, 2));
  },
  async rb2(t) {
    const f = await fixture(t);
    expectLines(t, (await run(t, ['info', 'sample.torrent'], { cwd: f.dir })).stdout, infoLines(f).slice(0, 3));
  },
  async bf7(t) {
    const f = await fixture(t);
    expectLines(t, (await run(t, ['info', 'sample.torrent'], { cwd: f.dir })).stdout, infoLines(f));
  },
  async fi9(t) {
    const f = await fixture(t, { seeders: 3 });
    const { stdout } = await run(t, ['peers', 'sample.torrent'], { cwd: f.dir });
    const announce = f.swarm.events.announces.at(-1);
    if (!announce) throw new TestFailure('Your program did not contact the tracker');
    if (!announce.infoHash.equals(f.torrent.infoHash)) throw new TestFailure('The info_hash sent to the tracker is wrong (it must be the raw 20-byte SHA-1, URL-encoded)');
    const actual = stdout.trim().split(/\r?\n/).map(l => l.trim()).sort();
    if (!isDeepStrictEqual(actual, [...f.swarm.peers].sort())) throw new TestFailure(`Expected peers (any order):\n${f.swarm.peers.join('\n')}\nGot:\n${stdout}`);
    t.log.success(`✓ Printed all ${f.swarm.peers.length} peers`);
  },
  async ca4(t) {
    const f = await fixture(t, { seeders: 1 });
    const { stdout } = await run(t, ['handshake', 'sample.torrent', f.swarm.peers[0]], { cwd: f.dir });
    const hs = f.swarm.events.handshakes.at(-1);
    if (!hs?.valid) throw new TestFailure('Did not receive a valid handshake ("\\x13BitTorrent protocol" + 8 reserved bytes + info hash + peer id)');
    expectLines(t, stdout, [`Peer ID: ${f.swarm.peerId.toString('hex')}`]);
  },
  async nd2(t) {
    const f = await fixture(t);
    const pieces = f.torrent.pieceHashes.length;
    for (const index of [randInt(0, pieces - 2), pieces - 1]) {
      const out = join(f.dir, `piece-${index}`);
      await run(t, ['download_piece', '-o', out, 'sample.torrent', String(index)], { cwd: f.dir });
      await expectFile(t, out, f.content.subarray(index * PIECE, (index + 1) * PIECE), `Piece ${index}`);
    }
  },
  async jv8(t) {
    const f = await fixture(t, { pieces: randInt(6, 10) });
    const out = join(f.dir, f.name);
    await run(t, ['download', '-o', out, 'sample.torrent'], { cwd: f.dir, timeout: 30000 });
    await expectFile(t, out, f.content, 'File');
  },

  async hw0(t) {
    const f = await fixture(t);
    expectLines(t, (await run(t, ['magnet_parse', f.magnet])).stdout, [`Tracker URL: ${f.swarm.trackerUrl}`, `Info Hash: ${f.torrent.infoHash.toString('hex')}`]);
  },
  async pk2(t) {
    const f = await fixture(t, { magnet: true, seeders: 1 });
    const { stdout } = await run(t, ['magnet_handshake', f.magnet]);
    checkExtensionBit(t, f.swarm);
    expectLines(t, stdout, [`Peer ID: ${f.swarm.peerId.toString('hex')}`]);
  },
  async xi4(t) {
    const f = await fixture(t, { magnet: true, seeders: 1 });
    const { stdout } = await run(t, ['magnet_handshake', f.magnet]);
    checkExtensionBit(t, f.swarm);
    expectLines(t, stdout, [`Peer ID: ${f.swarm.peerId.toString('hex')}`]);
    checkExtensionHandshake(t, f.swarm);
  },
  async jk6(t) {
    const f = await fixture(t, { magnet: true, seeders: 1 });
    const { stdout } = await run(t, ['magnet_handshake', f.magnet]);
    checkExtensionHandshake(t, f.swarm);
    expectLines(t, stdout, [`Peer ID: ${f.swarm.peerId.toString('hex')}`, `Peer Metadata Extension ID: ${f.swarm.metadataExtId}`]);
  },
  async ns5(t) {
    const f = await fixture(t, { magnet: true, seeders: 1 });
    await run(t, ['magnet_info', f.magnet]);
    checkExtensionHandshake(t, f.swarm);
    const req = f.swarm.events.metadataRequests.at(-1);
    if (!req) throw new TestFailure(`Expected a metadata request sent with the peer's ut_metadata extension ID (${f.swarm.metadataExtId})`);
    if (req.msg_type !== 0 || req.piece !== 0) throw new TestFailure(`Expected metadata request {"msg_type": 0, "piece": 0}, got ${JSON.stringify(req)}`);
    t.log.success('✓ Received a valid metadata request');
  },
  async zh1(t) {
    const f = await fixture(t, { magnet: true, seeders: 1 });
    expectLines(t, (await run(t, ['magnet_info', f.magnet])).stdout, infoLines(f));
  },
  async qv6(t) {
    const f = await fixture(t, { magnet: true });
    const index = randInt(0, f.torrent.pieceHashes.length - 1);
    const out = join(f.dir, `piece-${index}`);
    await run(t, ['magnet_download_piece', '-o', out, f.magnet, String(index)]);
    await expectFile(t, out, f.content.subarray(index * PIECE, (index + 1) * PIECE), `Piece ${index}`);
  },
  async dv7(t) {
    const f = await fixture(t, { magnet: true, pieces: randInt(6, 10) });
    const out = join(f.dir, f.name);
    await run(t, ['magnet_download', '-o', out, f.magnet], { timeout: 30000 });
    await expectFile(t, out, f.content, 'File');
  },
};

export const timeouts = { jv8: 45000, dv7: 45000 };

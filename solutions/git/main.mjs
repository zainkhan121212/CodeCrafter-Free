// Reference Git implementation used to verify the Git tester. Spoilers!
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [command, ...args] = process.argv.slice(2);
let gitDir = join(process.cwd(), '.git');

const sha1 = buf => createHash('sha1').update(buf).digest('hex');

function writeObject(type, content) {
  const data = Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content]);
  const sha = sha1(data);
  const dir = join(gitDir, 'objects', sha.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, sha.slice(2));
  if (!existsSync(file)) writeFileSync(file, deflateSync(data));
  return sha;
}

function readObject(sha) {
  const data = inflateSync(readFileSync(join(gitDir, 'objects', sha.slice(0, 2), sha.slice(2))));
  const nul = data.indexOf(0);
  const [type] = data.subarray(0, nul).toString().split(' ');
  return { type, content: data.subarray(nul + 1) };
}

function parseTree(content) {
  const entries = [];
  let i = 0;
  while (i < content.length) {
    const space = content.indexOf(0x20, i);
    const nul = content.indexOf(0, space);
    entries.push({ mode: content.subarray(i, space).toString(), name: content.subarray(space + 1, nul).toString(), sha: content.subarray(nul + 1, nul + 21).toString('hex') });
    i = nul + 21;
  }
  return entries;
}

function writeTree(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      const sha = writeTree(full);
      if (sha) entries.push({ mode: '40000', name, sha });
    } else entries.push({ mode: s.mode & 0o111 ? '100755' : '100644', name, sha: writeObject('blob', readFileSync(full)) });
  }
  if (!entries.length) return null;
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.mode === '40000' ? a.name + '/' : a.name), Buffer.from(b.mode === '40000' ? b.name + '/' : b.name)));
  return writeObject('tree', Buffer.concat(entries.map(e => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]))));
}

function init(dir = process.cwd()) {
  gitDir = join(dir, '.git');
  for (const d of ['objects', 'refs/heads', 'refs/tags']) mkdirSync(join(gitDir, d), { recursive: true });
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
}

// --- clone over smart HTTP ---

function pktLines(buf) {
  const lines = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const len = parseInt(buf.subarray(i, i + 4).toString(), 16);
    if (len === 0) { lines.push(null); i += 4; continue; }
    lines.push(buf.subarray(i + 4, i + len));
    i += len;
  }
  return { lines, rest: buf.subarray(i) };
}

const pkt = s => `${(Buffer.byteLength(s) + 4).toString(16).padStart(4, '0')}${s}`;

function applyDelta(base, delta) {
  let i = 0;
  const varint = () => { let v = 0, shift = 0, b; do { b = delta[i++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80); return v; };
  varint();
  const size = varint();
  const out = Buffer.alloc(size);
  let o = 0;
  while (i < delta.length) {
    const op = delta[i++];
    if (op & 0x80) {
      let offset = 0, len = 0;
      for (let b = 0; b < 4; b++) if (op & (1 << b)) offset |= delta[i++] << (8 * b);
      for (let b = 0; b < 3; b++) if (op & (1 << (4 + b))) len |= delta[i++] << (8 * b);
      if (len === 0) len = 0x10000;
      base.copy(out, o, offset, offset + len);
      o += len;
    } else {
      delta.copy(out, o, i, i + op);
      o += op;
      i += op;
    }
  }
  return out;
}

function unpack(pack) {
  const count = pack.readUInt32BE(8);
  const TYPES = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };
  const byOffset = new Map();
  const bySha = new Map();
  let i = 12;
  const pendingRef = [];
  let deltas = 0;
  for (let n = 0; n < count; n++) {
    const start = i;
    let b = pack[i++];
    const type = (b >> 4) & 7;
    while (b & 0x80) b = pack[i++];
    let baseOffset = null, baseSha = null;
    if (type === 6) {
      b = pack[i++];
      let off = b & 0x7f;
      while (b & 0x80) { b = pack[i++]; off = ((off + 1) << 7) | (b & 0x7f); }
      baseOffset = start - off;
    } else if (type === 7) {
      baseSha = pack.subarray(i, i + 20).toString('hex');
      i += 20;
    }
    const { buffer, engine } = inflateSync(pack.subarray(i), { info: true });
    i += engine.bytesWritten;
    let obj;
    if (!TYPES[type]) deltas++;
    if (TYPES[type]) obj = { type: TYPES[type], content: buffer };
    else if (baseOffset !== null) { const base = byOffset.get(baseOffset); obj = { type: base.type, content: applyDelta(base.content, buffer) }; }
    else { const base = bySha.get(baseSha); if (!base) { pendingRef.push({ baseSha, delta: buffer, start }); continue; } obj = { type: base.type, content: applyDelta(base.content, buffer) }; }
    byOffset.set(start, obj);
    bySha.set(writeObject(obj.type, obj.content), obj);
  }
  while (pendingRef.length) {
    const p = pendingRef.shift();
    const base = bySha.get(p.baseSha) || readObject(p.baseSha);
    const obj = { type: base.type, content: applyDelta(base.content, p.delta) };
    bySha.set(writeObject(obj.type, obj.content), obj);
  }
  console.error(`Unpacked ${count} objects (${deltas} deltas)`);
}

function checkout(treeSha, dir) {
  mkdirSync(dir, { recursive: true });
  for (const e of parseTree(readObject(treeSha).content)) {
    if (e.mode === '40000') checkout(e.sha, join(dir, e.name));
    else if (e.mode !== '160000') writeFileSync(join(dir, e.name), readObject(e.sha).content);
  }
}

async function clone(url, dir) {
  init(dir);
  const refsRes = Buffer.from(await (await fetch(`${url}/info/refs?service=git-upload-pack`)).arrayBuffer());
  const refs = pktLines(refsRes).lines.filter(Boolean).map(l => l.toString()).filter(l => !l.startsWith('#'));
  const [first] = refs;
  const headSha = first.slice(0, 40);
  const caps = first.split('\0')[1] || '';
  const headRef = (caps.match(/symref=HEAD:(\S+)/) || [])[1] || 'refs/heads/main';
  const body = pkt(`want ${headSha} no-progress\n`) + '0000' + pkt('done\n');
  const res = Buffer.from(await (await fetch(`${url}/git-upload-pack`, { method: 'POST', headers: { 'Content-Type': 'application/x-git-upload-pack-request' }, body })).arrayBuffer());
  const packStart = res.indexOf('PACK');
  unpack(res.subarray(packStart));
  mkdirSync(join(gitDir, ...headRef.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(gitDir, ...headRef.split('/')), headSha + '\n');
  writeFileSync(join(gitDir, 'HEAD'), `ref: ${headRef}\n`);
  const commit = readObject(headSha).content.toString();
  checkout(commit.match(/^tree ([0-9a-f]{40})/)[1], dir);
}

switch (command) {
  case 'init':
    init();
    console.log('Initialized git directory');
    break;
  case 'cat-file':
    process.stdout.write(readObject(args[1]).content);
    break;
  case 'hash-object': {
    const file = args[args.length - 1];
    process.stdout.write(writeObject('blob', readFileSync(file)) + '\n');
    break;
  }
  case 'ls-tree':
    for (const e of parseTree(readObject(args[args.length - 1]).content)) {
      console.log(args.includes('--name-only') ? e.name : `${e.mode.padStart(6, '0')} ${e.mode === '40000' ? 'tree' : 'blob'} ${e.sha}\t${e.name}`);
    }
    break;
  case 'write-tree':
    console.log(writeTree(process.cwd()));
    break;
  case 'commit-tree': {
    const tree = args[0];
    const parent = args[args.indexOf('-p') + 1];
    const message = args[args.indexOf('-m') + 1];
    const who = 'Reference <ref@example.com> 1700000000 +0000';
    console.log(writeObject('commit', Buffer.from(`tree ${tree}\nparent ${parent}\nauthor ${who}\ncommitter ${who}\n\n${message}\n`)));
    break;
  }
  case 'clone':
    await clone(args[0], args[1]);
    break;
  default:
    console.error(`Unknown command ${command}`);
    process.exit(1);
}

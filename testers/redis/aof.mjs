import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { R, encodeCommand, parse, show } from '../../lib/protocols/resp.mjs';
import { word, randInt, key } from '../../lib/harness/random.mjs';
import { RedisClient } from './client.mjs';

const DEFAULTS = { appendonly: 'no', appenddirname: 'appendonlydir', appendfilename: 'appendonly.aof', appendfsync: 'everysec' };
const samePath = (a, b) => {
  const norm = p => resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

async function configGet(t, client, name, expected, { path = false } = {}) {
  const reply = await client.command('CONFIG', 'GET', name);
  const ok = reply.type === 'array' && reply.value?.length === 2 && reply.value[0].value === name &&
    (path ? reply.value[1].value && samePath(reply.value[1].value, expected) : reply.value[1].value === expected);
  if (!ok) t.fail(`Expected ${show(R.array([name, expected]))}, got ${show(reply)}`);
  t.log.success(`✔︎ Received ${show(reply)}`);
}

async function exists(path, dir = false) {
  const s = await stat(path).catch(() => null);
  return !!s && (dir ? s.isDirectory() : s.isFile());
}

// Starts with AOF enabled. With `manifestFile`, pre-creates a manifest pointing to that incr file (and optional content).
async function startAof(t, { manifestFile = null, content = Buffer.alloc(0), fsync = null } = {}) {
  const dir = await t.tmpDir('ccfree-aof-');
  const appendDir = `${word()}dir`, appendFile = `${word()}.aof`;
  if (manifestFile) {
    await mkdir(join(dir, appendDir), { recursive: true });
    await writeFile(join(dir, appendDir, manifestFile), content);
    await writeFile(join(dir, appendDir, `${appendFile}.manifest`), `file ${manifestFile} seq 1 type i\n`);
    t.log.info(`Created ${appendDir}/${appendFile}.manifest pointing to ${manifestFile}${content.length ? ` (${content.length} bytes of commands)` : ''}`);
  }
  const args = ['--dir', dir, '--appendonly', 'yes', '--appenddirname', appendDir, '--appendfilename', appendFile];
  if (fsync) args.push('--appendfsync', fsync);
  const proc = t.spawn(args);
  const client = await RedisClient.connect(t, { proc });
  return { dir, appendDir, appendFile, client };
}

async function expectAofCommands(t, file, expected) {
  const data = await readFile(file).catch(() => null);
  if (data === null) t.fail(`Expected ${file} to exist`);
  const commands = [];
  let pos = 0;
  while (pos < data.length) {
    let parsed;
    try { parsed = parse(data, pos); } catch (err) { t.fail(`AOF file is not valid RESP at byte ${pos}: ${err.message}`); }
    if (!parsed) t.fail(`AOF file ends with an incomplete command at byte ${pos}`);
    commands.push(parsed.value.value.map((v, i) => (i === 0 ? String(v.value).toUpperCase() : v.value)));
    pos += parsed.length;
  }
  if (JSON.stringify(commands) !== JSON.stringify(expected)) t.fail(`Expected the AOF file to contain ${JSON.stringify(expected)}, got ${JSON.stringify(commands)}`);
  t.log.success(`✔︎ AOF file contains ${expected.length} command(s) in order`);
}

const manifestName = () => `${word()}${randInt(1, 99)}.1.incr.aof`;

export const stages = {
  async uj3(t) {
    const proc = t.spawn([]);
    const client = await RedisClient.connect(t, { proc });
    await configGet(t, client, 'dir', t.project.dir, { path: true });
    for (const [k, v] of Object.entries(DEFAULTS)) await configGet(t, client, k, v);
  },

  async vd9(t) {
    const dir = await t.tmpDir('ccfree-aof-');
    const values = { appendonly: 'yes', appenddirname: `${word()}dir`, appendfilename: `${word()}.aof`, appendfsync: 'always' };
    const passed = Object.entries(values).filter(() => Math.random() < 0.7);
    const proc = t.spawn(['--dir', dir, ...passed.flatMap(([k, v]) => [`--${k}`, v])]);
    const client = await RedisClient.connect(t, { proc });
    await configGet(t, client, 'dir', dir, { path: true });
    for (const k of Object.keys(DEFAULTS)) await configGet(t, client, k, Object.fromEntries(passed)[k] ?? DEFAULTS[k]);
  },

  async fm0(t) {
    const { dir, appendDir } = await startAof(t);
    if (!(await exists(join(dir, appendDir), true))) t.fail(`Expected directory ${appendDir} to be created at startup`);
    t.log.success(`✔︎ ${appendDir} exists`);
  },

  async dw4(t) {
    const { dir, appendDir, appendFile } = await startAof(t);
    const file = join(dir, appendDir, `${appendFile}.1.incr.aof`);
    if (!(await exists(file))) t.fail(`Expected ${appendDir}/${appendFile}.1.incr.aof to be created at startup`);
    if ((await stat(file)).size !== 0) t.fail('Expected the AOF file to be empty');
    t.log.success(`✔︎ ${appendFile}.1.incr.aof exists and is empty`);
  },

  async pb9(t) {
    const { dir, appendDir, appendFile } = await startAof(t);
    if (!(await exists(join(dir, appendDir, `${appendFile}.1.incr.aof`)))) t.fail(`Expected ${appendFile}.1.incr.aof to exist`);
    const manifest = await readFile(join(dir, appendDir, `${appendFile}.manifest`), 'utf8').catch(() => null);
    if (manifest === null) t.fail(`Expected ${appendDir}/${appendFile}.manifest to exist`);
    const line = `file ${appendFile}.1.incr.aof seq 1 type i\n`;
    if (!manifest.includes(line)) t.fail(`Expected the manifest to contain ${JSON.stringify(line)}, got ${JSON.stringify(manifest)}`);
    t.log.success('✔︎ Manifest file is correct');
  },

  async dc8(t) {
    const name = manifestName();
    const { dir, appendDir, client } = await startAof(t, { manifestFile: name, fsync: 'always' });
    const cmd = ['SET', key(), word()];
    await client.check(cmd, R.simple('OK'));
    await expectAofCommands(t, join(dir, appendDir, name), [cmd]);
  },

  async fi1(t) {
    const name = manifestName();
    const { dir, appendDir, client } = await startAof(t, { manifestFile: name, fsync: 'always' });
    const cmds = [['SET', key(), word()], ['SET', key(), word()]];
    for (const c of cmds) await client.check(c, R.simple('OK'));
    await expectAofCommands(t, join(dir, appendDir, name), cmds);
  },

  async ep6(t) {
    const name = manifestName();
    const { dir, appendDir, client } = await startAof(t, { manifestFile: name, fsync: 'always' });
    const k1 = key(), k2 = key(), v1 = word(), v2 = word();
    await client.check(['PING'], R.simple('PONG'));
    await client.check(['SET', k1, v1], R.simple('OK'));
    await client.check(['GET', k1], R.bulk(v1));
    await client.check(['ECHO', 'hello'], R.bulk('hello'));
    await client.command('CONFIG', 'GET', 'appendonly');
    await client.check(['SET', k2, v2], R.simple('OK'));
    await client.check(['GET', k2], R.bulk(v2));
    await expectAofCommands(t, join(dir, appendDir, name), [['SET', k1, v1], ['SET', k2, v2]]);
  },

  async xz2(t) {
    const k = key(), v = word();
    const { client } = await startAof(t, { manifestFile: manifestName(), content: encodeCommand(['SET', k, v]) });
    await client.check(['GET', k], R.bulk(v));
  },

  async kn2(t) {
    const pairs = Array.from({ length: randInt(3, 5) }, () => [key(), word()]);
    const { client } = await startAof(t, { manifestFile: manifestName(), content: Buffer.concat(pairs.map(([k, v]) => encodeCommand(['SET', k, v]))) });
    for (const [k, v] of pairs) await client.check(['GET', k], R.bulk(v));
  },
};

// Git tester: runs the learner's git implementation in temporary directories and checks the results,
// using the official `git` binary as the reference where needed.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { hashObject, writeObject, treeContent, treeHashOfDir, commitContent } from '../../lib/protocols/git.mjs';
import { word, words, randInt, shuffle } from '../../lib/harness/random.mjs';

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'CodeCrafter Free', GIT_AUTHOR_EMAIL: 'tester@ccfree.dev', GIT_COMMITTER_NAME: 'CodeCrafter Free', GIT_COMMITTER_EMAIL: 'tester@ccfree.dev', GIT_TERMINAL_PROMPT: '0' };

function git(t, args, cwd, { input } = {}) {
  const r = spawnSync('git', ['-c', 'safe.directory=*', '-c', 'core.autocrlf=false', ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, windowsHide: true });
  if (r.error) throw new TestFailure(`This tester needs the official git binary on PATH (${r.error.message})`);
  if (r.status !== 0) throw new TestFailure(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

async function run(t, args, cwd) {
  t.log.info(`$ ./your_program.sh ${args.join(' ')}`);
  const r = await t.exec(args, { cwd });
  if (r.exitCode !== 0) throw new TestFailure(`Expected exit code 0, got ${r.exitCode}`);
  return r;
}

async function initRepo(t) {
  const dir = await t.tmpDir('ccfree-git-');
  await run(t, ['init'], dir);
  for (const p of ['.git', '.git/objects', '.git/refs']) {
    if (!existsSync(join(dir, p)) || !statSync(join(dir, p)).isDirectory()) throw new TestFailure(`Expected ${p} to be a directory`);
  }
  return dir;
}

const randomText = () => `${words(randInt(2, 5)).join(' ')}\n${words(randInt(1, 4)).join(' ')}`;

function expectSha(t, stdout, expected, what) {
  const out = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(out)) throw new TestFailure(`Expected a 40-character SHA-1 hash on stdout, got ${JSON.stringify(stdout)}`);
  if (out !== expected) throw new TestFailure(`Expected ${what} SHA ${expected}, got ${out}`);
  t.log.success(`✓ ${what} SHA is ${expected}`);
}

// Serves a bare repository over Git's smart HTTP protocol, backed by `git upload-pack --stateless-rpc`.
async function serveRepo(t, bareDir) {
  const pkt = s => `${(s.length + 4).toString(16).padStart(4, '0')}${s}`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname.endsWith('/info/refs') && url.searchParams.get('service') === 'git-upload-pack') {
      const out = spawnSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bareDir], { windowsHide: true });
      res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement', 'Cache-Control': 'no-cache' });
      res.end(Buffer.concat([Buffer.from(pkt('# service=git-upload-pack\n') + '0000'), out.stdout]));
    } else if (req.method === 'POST' && url.pathname.endsWith('/git-upload-pack')) {
      const child = spawn('git', ['upload-pack', '--stateless-rpc', bareDir], { windowsHide: true });
      res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result', 'Cache-Control': 'no-cache' });
      child.stdout.pipe(res);
      child.on('error', () => res.end());
      req.pipe(child.stdin);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.onCleanup(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/${word()}-repo.git`;
}

export const stages = {
  async gg4(t) {
    const dir = await t.tmpDir('ccfree-git-');
    await run(t, ['init'], dir);
    for (const p of ['.git', '.git/objects', '.git/refs']) {
      if (!existsSync(join(dir, p)) || !statSync(join(dir, p)).isDirectory()) throw new TestFailure(`Expected ${p} to be a directory`);
      t.log.success(`✓ ${p} directory exists`);
    }
    // Git itself ignores trailing whitespace in HEAD, so a Windows \r\n line ending is fine.
    const head = (await readFile(join(dir, '.git', 'HEAD'), 'utf8').catch(() => null))?.replace(/\s*$/, '\n') ?? null;
    if (head === null) throw new TestFailure('Expected .git/HEAD to be a file');
    if (!['ref: refs/heads/main\n', 'ref: refs/heads/master\n'].includes(head)) throw new TestFailure(`Expected .git/HEAD to contain "ref: refs/heads/main\\n" or "ref: refs/heads/master\\n", got ${JSON.stringify(head)}`);
    t.log.success('✓ .git/HEAD is valid');
  },

  async ic4(t) {
    const dir = await initRepo(t);
    const content = randomText();
    await writeFile(join(dir, 'test.txt'), content);
    const sha = git(t, ['hash-object', '-w', 'test.txt'], dir).trim();
    t.log.info(`Added blob object to .git/objects: ${sha}`);
    const { stdout } = await run(t, ['cat-file', '-p', sha], dir);
    if (stdout !== content) throw new TestFailure(`Expected stdout to be ${JSON.stringify(content)}, got ${JSON.stringify(stdout)}`);
    t.log.success('✓ Output matches the blob contents');
  },

  async jt4(t) {
    const dir = await initRepo(t);
    const content = randomText();
    const name = `${word()}.txt`;
    await writeFile(join(dir, name), content);
    const expected = hashObject('blob', content);
    const { stdout } = await run(t, ['hash-object', '-w', name], dir);
    expectSha(t, stdout, expected, 'blob');
    const file = join(dir, '.git', 'objects', expected.slice(0, 2), expected.slice(2));
    if (!existsSync(file)) throw new TestFailure(`Expected object file .git/objects/${expected.slice(0, 2)}/${expected.slice(2)} to exist`);
    let raw;
    try { raw = inflateSync(await readFile(file)); } catch { throw new TestFailure('Object file is not valid zlib-compressed data'); }
    if (!raw.equals(Buffer.from(`blob ${Buffer.byteLength(content)}\0${content}`))) throw new TestFailure('Object file contents do not match "blob <size>\\0<content>"');
    const viaGit = git(t, ['cat-file', '-p', expected], dir);
    if (viaGit !== content) throw new TestFailure('git cat-file could not read back the object correctly');
    t.log.success('✓ Object file is valid and readable by git');
  },

  async kp1(t) {
    const dir = await initRepo(t);
    const gitDir = join(dir, '.git');
    const names = shuffle(words(randInt(3, 6)));
    const entries = [];
    for (const [i, name] of names.entries()) {
      if (i % 2 === 0) {
        const sub = [];
        for (const f of words(randInt(1, 3))) sub.push({ mode: '100644', name: f, sha: await writeObject(gitDir, 'blob', randomText()) });
        entries.push({ mode: '40000', name, sha: await writeObject(gitDir, 'tree', treeContent(sub)) });
      } else {
        entries.push({ mode: '100644', name, sha: await writeObject(gitDir, 'blob', randomText()) });
      }
    }
    const tree = await writeObject(gitDir, 'tree', treeContent(entries));
    t.log.info(`Wrote tree object ${tree}`);
    const expected = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.mode === '40000' ? `${a.name}/` : a.name), Buffer.from(b.mode === '40000' ? `${b.name}/` : b.name))).map(e => e.name).join('\n') + '\n';
    const { stdout } = await run(t, ['ls-tree', '--name-only', tree], dir);
    if (stdout !== expected) throw new TestFailure(`Expected output:\n${expected}Got:\n${stdout}`);
    t.log.success('✓ Output matches the tree entries');
  },

  async fe4(t) {
    const dir = await initRepo(t);
    const files = words(randInt(2, 3));
    const dirs = words(randInt(2, 3)).map(d => `dir_${d}`);
    for (const f of files) await writeFile(join(dir, `${f}.txt`), randomText());
    for (const d of dirs) {
      await mkdir(join(dir, d, 'nested'), { recursive: true });
      await writeFile(join(dir, d, `${word()}.txt`), randomText());
      await writeFile(join(dir, d, 'nested', `${word()}.md`), randomText());
    }
    t.log.info(`Created ${files.length} files and ${dirs.length} directories`);
    const expected = await treeHashOfDir(dir);
    const { stdout } = await run(t, ['write-tree'], dir);
    expectSha(t, stdout, expected, 'tree');
    const listing = git(t, ['ls-tree', '-r', '--name-only', expected], dir).trim().split('\n');
    const expectedCount = files.length + dirs.length * 2;
    if (listing.length !== expectedCount) throw new TestFailure(`git ls-tree -r found ${listing.length} files in your tree; expected ${expectedCount}`);
    t.log.success('✓ Tree and all nested objects were written correctly');
  },

  async jm9(t) {
    const dir = await initRepo(t);
    const gitDir = join(dir, '.git');
    const blob = await writeObject(gitDir, 'blob', randomText());
    const tree1 = await writeObject(gitDir, 'tree', treeContent([{ mode: '100644', name: `${word()}.txt`, sha: blob }]));
    const parent = await writeObject(gitDir, 'commit', commitContent({ tree: tree1, message: 'Initial commit' }));
    const blob2 = await writeObject(gitDir, 'blob', randomText());
    const tree2 = await writeObject(gitDir, 'tree', treeContent([{ mode: '100644', name: `${word()}.txt`, sha: blob2 }]));
    const message = words(3).join(' ');
    t.log.info(`Created tree ${tree2} and parent commit ${parent}`);
    const { stdout } = await run(t, ['commit-tree', tree2, '-p', parent, '-m', message], dir);
    const sha = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new TestFailure(`Expected a 40-character SHA-1 hash on stdout, got ${JSON.stringify(stdout)}`);
    const type = git(t, ['cat-file', '-t', sha], dir).trim();
    if (type !== 'commit') throw new TestFailure(`Expected object ${sha} to be a commit, got ${type}`);
    const body = git(t, ['cat-file', '-p', sha], dir);
    if (!body.startsWith(`tree ${tree2}\n`)) throw new TestFailure(`Expected commit to start with "tree ${tree2}", got:\n${body}`);
    if (!body.includes(`\nparent ${parent}\n`)) throw new TestFailure(`Expected commit to have "parent ${parent}"`);
    if (!/\nauthor .+ <.*> \d+ [+-]\d{4}\n/.test(body) || !/\ncommitter .+ <.*> \d+ [+-]\d{4}\n/.test(body)) throw new TestFailure('Expected valid author and committer lines');
    if (body.split('\n\n').slice(1).join('\n\n').trim() !== message) throw new TestFailure(`Expected commit message ${JSON.stringify(message)}`);
    git(t, ['log', '--format=%H', sha], dir);
    t.log.success('✓ Commit object is valid (verified with git log)');
  },

  async mg6(t) {
    // Build a small repository with history, then serve it over smart HTTP.
    const source = await t.tmpDir('ccfree-git-src-');
    git(t, ['init', '-q', '-b', 'main'], source);
    const tracked = {};
    // A large file edited in every commit makes git send delta objects in the packfile.
    const bigLines = Array.from({ length: 300 }, (_, i) => `${i}: ${words(6).join(' ')}`);
    for (let c = 0; c < randInt(3, 5); c++) {
      bigLines.splice(randInt(0, bigLines.length - 1), 1, `edited in commit ${c}: ${words(4).join(' ')}`);
      tracked['big.txt'] = bigLines.join('\n') + '\n';
      await writeFile(join(source, 'big.txt'), tracked['big.txt']);
      for (let f = 0; f < randInt(2, 4); f++) {
        const path = Math.random() < 0.4 ? join(`dir_${word()}`, `${word()}.txt`) : `${word()}.txt`;
        await mkdir(join(source, path, '..'), { recursive: true });
        tracked[path.replace(/\\/g, '/')] = randomText().repeat(randInt(1, 20));
        await writeFile(join(source, path), tracked[path.replace(/\\/g, '/')]);
      }
      git(t, ['add', '-A'], source);
      git(t, ['commit', '-q', '-m', `${word()} ${word()}`], source);
    }
    const bare = await t.tmpDir('ccfree-git-bare-');
    git(t, ['clone', '-q', '--bare', source, bare], source);
    const url = await serveRepo(t, bare);
    const head = git(t, ['rev-parse', 'HEAD'], source).trim();
    t.log.info(`Serving a test repository at ${url} (HEAD ${head})`);

    const parent = await t.tmpDir('ccfree-git-clone-');
    const target = join(parent, `cloned_${word()}`);
    await run(t, ['clone', url, target], parent);
    if (!existsSync(join(target, '.git'))) throw new TestFailure(`Expected ${target}/.git to exist`);
    const [path, content] = shuffle(Object.entries(tracked))[0];
    const actual = await readFile(join(target, path), 'utf8').catch(() => null);
    if (actual === null) throw new TestFailure(`Expected file ${path} to exist in the cloned repository`);
    if (actual !== content) throw new TestFailure(`File ${path} has the wrong contents`);
    t.log.success(`✓ ${path} has the correct contents`);
    const clonedHead = git(t, ['rev-parse', 'HEAD'], target).trim();
    if (clonedHead !== head) throw new TestFailure(`Expected HEAD to be ${head}, got ${clonedHead}`);
    const expectedMsg = git(t, ['log', '-1', '--format=%an%n%s', head], source);
    if (git(t, ['log', '-1', '--format=%an%n%s', clonedHead], target) !== expectedMsg) throw new TestFailure('Commit attributes in the cloned repository do not match');
    git(t, ['fsck', '--no-dangling'], target);
    t.log.success('✓ HEAD commit and history were cloned correctly (verified with git fsck)');
  },
};

export const timeouts = { mg6: 60000 };

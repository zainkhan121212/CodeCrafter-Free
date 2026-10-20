// Git object helpers for the Git tester: hashing, writing loose objects and building trees.
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export function objectBytes(type, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
}

export const hashObject = (type, content) => createHash('sha1').update(objectBytes(type, content)).digest('hex');

export async function writeObject(gitDir, type, content) {
  const sha = hashObject(type, content);
  const dir = join(gitDir, 'objects', sha.slice(0, 2));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, sha.slice(2)), deflateSync(objectBytes(type, content)));
  return sha;
}

// Git sorts tree entries by name, comparing directories as if their name ended in "/".
const sortKey = e => (e.mode === '40000' ? `${e.name}/` : e.name);

export function treeContent(entries) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(sortKey(a)), Buffer.from(sortKey(b))));
  return Buffer.concat(sorted.map(e => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')])));
}

// Writes the working directory (excluding .git) as tree objects; returns the root tree sha.
export async function writeTreeFromDir(gitDir, dir) {
  const entries = [];
  for (const name of await readdir(dir)) {
    if (name === '.git') continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      const sha = await writeTreeFromDir(gitDir, full);
      if (sha) entries.push({ mode: '40000', name, sha });
    } else {
      entries.push({ mode: s.mode & 0o111 ? '100755' : '100644', name, sha: await writeObject(gitDir, 'blob', await readFile(full)) });
    }
  }
  if (!entries.length) return null;
  return writeObject(gitDir, 'tree', treeContent(entries));
}

// Same as writeTreeFromDir but only computes hashes, without writing.
export async function treeHashOfDir(dir) {
  const entries = [];
  for (const name of await readdir(dir)) {
    if (name === '.git') continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      const sha = await treeHashOfDir(full);
      if (sha) entries.push({ mode: '40000', name, sha });
    } else {
      entries.push({ mode: s.mode & 0o111 ? '100755' : '100644', name, sha: hashObject('blob', await readFile(full)) });
    }
  }
  return entries.length ? hashObject('tree', treeContent(entries)) : null;
}

export function commitContent({ tree, parents = [], message, author = 'Test Author <author@example.com> 1700000000 +0000' }) {
  return [`tree ${tree}`, ...parents.map(p => `parent ${p}`), `author ${author}`, `committer ${author}`, '', message].join('\n') + '\n';
}

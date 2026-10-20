// Reference grep used to verify the grep tester (uses the JS regex engine; learners write their own). Spoilers!
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
let pattern, only = false, recursive = false, color = 'never';
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-E') pattern = args[++i];
  else if (a === '-o') only = true;
  else if (a === '-r') recursive = true;
  else if (a.startsWith('--color=')) color = a.slice(8);
  else files.push(a);
}
const useColor = color === 'always' || (color === 'auto' && process.stdout.isTTY);
const re = new RegExp(pattern);
const reG = new RegExp(pattern, 'g');
const out = [];
let found = false;

function processText(text, prefix) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (!re.test(line)) continue;
    found = true;
    if (only) for (const m of line.matchAll(reG)) { if (m[0]) out.push(prefix + (useColor ? `\x1b[01;31m\x1b[K${m[0]}\x1b[m\x1b[K` : m[0])); }
    else out.push(prefix + (useColor ? line.replace(reG, m => (m ? `\x1b[01;31m\x1b[K${m}\x1b[m\x1b[K` : m)) : line));
  }
}

function walk(path) {
  if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) walk(path.endsWith('/') ? path + name : `${path}/${name}`);
  else processText(readFileSync(path, 'utf8'), `${path}:`);
}

if (!files.length) processText(readFileSync(0, 'utf8'), '');
else if (recursive) files.forEach(walk);
else for (const f of files) processText(readFileSync(f, 'utf8'), files.length > 1 ? `${f}:` : '');
if (out.length) process.stdout.write(out.join('\n') + '\n');
process.exit(found ? 0 : 1);

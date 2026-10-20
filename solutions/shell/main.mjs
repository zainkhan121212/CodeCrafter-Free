// Reference POSIX-style shell used to verify the Shell tester. Spoilers!
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, statSync, readdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, constants, existsSync } from 'node:fs';
import { join, delimiter, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const BUILTINS = ['echo', 'exit', 'type', 'pwd', 'cd', 'history', 'jobs', 'complete', 'declare'];
const vars = new Map();
const completers = new Map();
const history = [];
let appendedUpTo = 0;
const jobs = []; // { n, pid, cmd, child, done }

if (process.env.HISTFILE && existsSync(process.env.HISTFILE)) history.push(...readFileSync(process.env.HISTFILE, 'utf8').split('\n').filter(Boolean));

// ---------- helpers ----------
function findExecutable(name) {
  if (name.includes('/')) return null;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, name);
    try { if (statSync(full).isFile()) { accessSync(full, constants.X_OK); return full; } } catch { /* keep looking */ }
  }
  return null;
}

function executablesWithPrefix(prefix) {
  const out = new Set();
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.startsWith(prefix)) continue;
      try { const f = join(dir, n); if (statSync(f).isFile()) { accessSync(f, constants.X_OK); out.add(n); } } catch { /* skip */ }
    }
  }
  return [...out];
}

// ---------- parsing ----------
// Returns a list of words; each word is { text, op } where op marks operators (|, >, >>, 2>, 2>>, &).
function tokenize(line) {
  const words = [];
  let cur = '', has = false, expandedOnly = true, i = 0;
  const push = () => { if (has && !(cur === '' && expandedOnly)) words.push({ text: cur }); cur = ''; has = false; expandedOnly = true; };
  const expand = (s, j) => {
    if (s[j + 1] === '{') { const end = s.indexOf('}', j); return { value: vars.get(s.slice(j + 2, end)) ?? '', next: end + 1 }; }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(j + 1));
    if (!m) return { value: '$', next: j + 1 };
    return { value: vars.get(m[0]) ?? '', next: j + 1 + m[0].length };
  };
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { push(); i++; continue; }
    if (c === "'") { const end = line.indexOf("'", i + 1); cur += line.slice(i + 1, end); has = true; expandedOnly = false; i = end + 1; continue; }
    if (c === '"') {
      i++; has = true; expandedOnly = false;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && ['\\', '$', '"', '`', '\n'].includes(line[i + 1])) { cur += line[i + 1]; i += 2; }
        else if (line[i] === '$') { const e = expand(line, i); cur += e.value; i = e.next; }
        else cur += line[i++];
      }
      i++;
      continue;
    }
    if (c === '\\') { cur += line[i + 1] ?? ''; has = true; expandedOnly = false; i += 2; continue; }
    if (c === '$') { const e = expand(line, i); cur += e.value; has = true; i = e.next; continue; }
    const op = /^(2>>|1>>|>>|2>|1>|>|\||&)/.exec(line.slice(i));
    if (op && !(op[0][0] >= '0' && op[0][0] <= '9' && has)) { push(); words.push({ op: op[0] === '1>' ? '>' : op[0] === '1>>' ? '>>' : op[0] }); i += op[0].length; continue; }
    cur += c; has = true; expandedOnly = false; i++;
  }
  push();
  return words;
}

function parse(line) {
  const tokens = tokenize(line);
  let background = false;
  if (tokens.at(-1)?.op === '&') { background = true; tokens.pop(); }
  const commands = [];
  let cur = { argv: [], redirects: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.op === '|') { commands.push(cur); cur = { argv: [], redirects: [] }; }
    else if (t.op) { cur.redirects.push({ op: t.op, file: tokens[++i].text }); }
    else cur.argv.push(t.text);
  }
  commands.push(cur);
  return { commands, background };
}

// ---------- builtins ----------
function typeOf(name) {
  if (BUILTINS.includes(name)) return `${name} is a shell builtin`;
  const p = findExecutable(name);
  return p ? `${name} is ${p}` : null;
}

function jobsReport({ onlyDone = false } = {}) {
  const lines = [];
  const alive = [...jobs];
  alive.forEach((j, idx) => {
    const marker = idx === alive.length - 1 ? '+' : idx === alive.length - 2 ? '-' : ' ';
    if (j.done) lines.push(`[${j.n}]${marker}  ${'Done'.padEnd(24)}${j.cmd.replace(/\s*&$/, '')}`);
    else if (!onlyDone) lines.push(`[${j.n}]${marker}  ${'Running'.padEnd(24)}${j.cmd}`);
  });
  for (const j of alive) if (j.done) jobs.splice(jobs.indexOf(j), 1);
  return lines;
}

// Runs a builtin; `out`/`err` are write functions. Returns true if it was a builtin.
function builtin(argv, out, err) {
  const [name, ...args] = argv;
  switch (name) {
    case 'echo': out(args.join(' ') + '\n'); return true;
    case 'exit': saveHistory(); process.exit(Number(args[0] || 0)); return true;
    case 'type': { for (const a of args) { const r = typeOf(a); r ? out(r + '\n') : err(`${a}: not found\n`); } return true; }
    case 'pwd': out(process.cwd() + '\n'); return true;
    case 'cd': {
      const target = !args[0] || args[0] === '~' ? process.env.HOME : args[0].startsWith('~/') ? join(process.env.HOME, args[0].slice(2)) : args[0];
      try { if (!statSync(resolve(target)).isDirectory()) throw new Error(); process.chdir(resolve(target)); } catch { err(`cd: ${args[0]}: No such file or directory\n`); }
      return true;
    }
    case 'history': {
      if (args[0] === '-r') { history.push(...readFileSync(args[1], 'utf8').split('\n').filter(Boolean)); return true; }
      if (args[0] === '-w') { writeFileSync(args[1], history.map(h => `${h}\n`).join('')); appendedUpTo = history.length; return true; }
      if (args[0] === '-a') { appendFileSync(args[1], history.slice(appendedUpTo).map(h => `${h}\n`).join('')); appendedUpTo = history.length; return true; }
      const n = args[0] ? Number(args[0]) : history.length;
      history.forEach((h, i) => { if (i >= history.length - n) out(`${String(i + 1).padStart(5)}  ${h}\n`); });
      return true;
    }
    case 'jobs': for (const l of jobsReport()) out(l + '\n'); return true;
    case 'complete': {
      if (args[0] === '-p') { const c = completers.get(args[1]); c ? out(`complete -C '${c}' ${args[1]}\n`) : err(`complete: ${args[1]}: no completion specification\n`); }
      else if (args[0] === '-C') completers.set(args[2], args[1]);
      else if (args[0] === '-r') completers.delete(args[1]);
      return true;
    }
    case 'declare': {
      if (args[0] === '-p') { const v = vars.get(args[1]); v !== undefined ? out(`declare -- ${args[1]}="${v}"\n`) : err(`declare: ${args[1]}: not found\n`); return true; }
      for (const a of args) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(a);
        if (!m) err(`declare: \`${a}': not a valid identifier\n`); else vars.set(m[1], m[2]);
      }
      return true;
    }
    default: return false;
  }
}

function saveHistory() {
  if (process.env.HISTFILE) writeFileSync(process.env.HISTFILE, history.map(h => `${h}\n`).join(''));
}

// ---------- execution ----------
function openRedirects(redirects) {
  const fds = { 1: 'inherit', 2: 'inherit' };
  const opened = [];
  for (const r of redirects) {
    const fd = openSync(r.file, r.op.endsWith('>>') ? 'a' : 'w');
    opened.push(fd);
    fds[r.op.startsWith('2') ? 2 : 1] = fd;
  }
  return { fds, close: () => opened.forEach(closeSync) };
}

const writer = target => (target === 'inherit' ? null : target);

async function runPipeline(line) {
  const { commands, background } = parse(line);
  if (!commands[0].argv.length) return;
  if (commands.length === 1 && !background) {
    const c = commands[0];
    const { fds, close } = openRedirects(c.redirects);
    const out = s => (writer(fds[1]) !== null ? appendFileSync(fds[1], s) : process.stdout.write(s));
    const err = s => (writer(fds[2]) !== null ? appendFileSync(fds[2], s) : process.stderr.write(s));
    try {
      if (builtin(c.argv, out, err)) return;
      if (!findExecutable(c.argv[0])) { err(`${c.argv[0]}: command not found\n`); return; }
      await new Promise(res => { const child = spawn(c.argv[0], c.argv.slice(1), { stdio: ['inherit', fds[1], fds[2]], argv0: c.argv[0] }); child.on('exit', res); child.on('error', res); });
    } finally { close(); }
    return;
  }
  if (background) {
    const c = commands[0];
    if (!findExecutable(c.argv[0])) { process.stderr.write(`${c.argv[0]}: command not found\n`); return; }
    const child = spawn(c.argv[0], c.argv.slice(1), { stdio: 'inherit' });
    const n = jobs.length ? Math.max(...jobs.map(j => j.n)) + 1 : 1;
    const job = { n, pid: child.pid, cmd: `${line.replace(/\s*&\s*$/, '')} &`, child, done: false };
    child.on('exit', () => { job.done = true; });
    jobs.push(job);
    process.stdout.write(`[${n}] ${child.pid}\n`);
    return;
  }
  // Pipelines: external commands connected with pipes; builtins run in-process.
  const children = [];
  let prev = null; // readable stream feeding the next command
  for (const [i, c] of commands.entries()) {
    const last = i === commands.length - 1;
    if (BUILTINS.includes(c.argv[0])) {
      let text = '';
      builtin(c.argv, s => { text += s; }, s => process.stderr.write(s));
      if (prev) prev.resume();
      if (last) { process.stdout.write(text); prev = null; }
      else { const { Readable } = await import('node:stream'); prev = Readable.from([text]); }
      continue;
    }
    const child = spawn(c.argv[0], c.argv.slice(1), { stdio: [prev ? 'pipe' : 'inherit', last ? 'inherit' : 'pipe', 'inherit'] });
    if (prev) { child.stdin.on('error', () => {}); prev.pipe(child.stdin); }
    children.push(child);
    prev = last ? null : child.stdout;
  }
  if (children.length) {
    const lastChild = children.at(-1);
    await new Promise(res => { if (lastChild.exitCode !== null) res(); else lastChild.on('exit', res); });
    await new Promise(res => setTimeout(res, 50));
    for (const c of children) if (c.exitCode === null) c.kill();
  }
}

// ---------- completion ----------
function lcp(list) {
  let p = list[0] || '';
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

function candidatesFor(buffer) {
  const words = buffer.split(' ');
  const current = words.at(-1);
  if (words.length === 1) return { current, items: [...new Set([...BUILTINS.filter(b => b.startsWith(current)), ...executablesWithPrefix(current)])].sort().map(n => ({ name: n, suffix: ' ' })) };
  const cmd = words[0];
  if (completers.has(cmd)) {
    const r = spawnSync(completers.get(cmd), [cmd, current, words.at(-2) ?? ''], { encoding: 'utf8', env: { ...process.env, COMP_LINE: buffer, COMP_POINT: String(Buffer.byteLength(buffer)) } });
    return { current, items: (r.stdout || '').split('\n').filter(Boolean).sort().map(n => ({ name: n, suffix: ' ' })) };
  }
  const slash = current.lastIndexOf('/');
  const dirPart = slash >= 0 ? current.slice(0, slash + 1) : '';
  const prefix = current.slice(slash + 1);
  let entries = [];
  try { entries = readdirSync(resolve(dirPart || '.'), { withFileTypes: true }); } catch { /* none */ }
  const items = entries.filter(e => e.name.startsWith(prefix)).map(e => ({ name: e.name, suffix: e.isDirectory() ? '/' : ' ', dirPart })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { current, items, dirPart, prefix };
}

// ---------- line editor (TTY) ----------
function interactive() {
  let buffer = '';
  let histIndex = null;
  let lastWasTab = false;
  const redraw = () => process.stdout.write(`\r\x1b[K$ ${buffer}`);
  const prompt = () => {
    for (const l of jobsReport({ onlyDone: true })) process.stdout.write(l + '\n');
    buffer = ''; histIndex = null; lastWasTab = false;
    process.stdout.write('$ ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async data => {
    for (let i = 0; i < data.length; i++) {
      const rest = data.slice(i);
      if (rest.startsWith('\x1b[A') || rest.startsWith('\x1b[B')) {
        const up = rest[2] === 'A';
        i += 2;
        if (!history.length) continue;
        histIndex = histIndex === null ? (up ? history.length - 1 : null) : Math.min(history.length, Math.max(0, histIndex + (up ? -1 : 1)));
        buffer = histIndex === null || histIndex >= history.length ? '' : history[histIndex];
        redraw();
        continue;
      }
      const ch = data[i];
      if (ch === '\r' || ch === '\n') {
        process.stdout.write('\r\n');
        const line = buffer.trim();
        process.stdin.setRawMode(false);
        process.stdin.pause();
        if (line) { history.push(line); await runPipeline(line); }
        prompt();
        return;
      }
      if (ch === '\x03') { buffer = ''; process.stdout.write('^C\r\n$ '); continue; }
      if (ch === '\x04') { if (!buffer) { saveHistory(); process.stdout.write('\r\n'); process.exit(0); } continue; }
      if (ch === '\x7f' || ch === '\b') { buffer = buffer.slice(0, -1); redraw(); continue; }
      if (ch === '\t') {
        const { current, items } = candidatesFor(buffer);
        const base = buffer.slice(0, buffer.length - current.length);
        const dirPart = items[0]?.dirPart ?? '';
        if (items.length === 1) { buffer = base + dirPart + items[0].name + items[0].suffix; redraw(); lastWasTab = false; continue; }
        const common = lcp(items.map(x => x.name));
        if (items.length > 1 && dirPart + common !== current && common.length > current.length - dirPart.length) { buffer = base + dirPart + common; redraw(); lastWasTab = false; continue; }
        if (items.length > 1 && lastWasTab) {
          process.stdout.write(`\r\n${items.map(x => x.name + (x.suffix === '/' ? '/' : '')).join('  ')}\r\n`);
          redraw();
          lastWasTab = false;
          continue;
        }
        process.stdout.write('\x07');
        lastWasTab = items.length > 1;
        continue;
      }
      lastWasTab = false;
      if (ch >= ' ') { buffer += ch; process.stdout.write(ch); }
    }
  });
  prompt();
}

// ---------- main ----------
if (process.stdin.isTTY) interactive();
else {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = [];
  let waiting = null;
  rl.on('line', l => { lines.push(l); waiting?.(); });
  rl.on('close', () => { lines.push(null); waiting?.(); });
  for (;;) {
    for (const l of jobsReport({ onlyDone: true })) process.stdout.write(l + '\n');
    process.stdout.write('$ ');
    while (!lines.length) await new Promise(r => { waiting = r; });
    const line = lines.shift();
    if (line === null) { saveHistory(); process.exit(0); }
    if (line.trim()) { history.push(line.trim()); await runPipeline(line.trim()); }
  }
}

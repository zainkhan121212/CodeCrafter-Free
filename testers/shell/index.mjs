// Shell tester: types commands into the learner's shell and reads the terminal screen.
// Stages that run external programs need a POSIX system (Linux, macOS or WSL); TAB completion and arrow keys
// also need a pseudo-terminal. Expected output of real tools is computed by running the same command in `sh`.
import { writeFile, mkdir, chmod, readFile, realpath } from 'node:fs/promises';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { word, words, randInt, shuffle } from '../../lib/harness/random.mjs';
import { ShellSession, platformMessage } from './session.mjs';

const isWindows = process.platform === 'win32';
const sig = () => String(randInt(1e9, 9e9));

function requirePosix() {
  if (isWindows) throw new TestFailure(platformMessage('a POSIX environment (sh, cat, ls and executable scripts)'));
}

const normPath = p => (isWindows ? p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : p.replace(/\/+$/, ''));
const shPath = p => (isWindows ? p.replace(/\\/g, '/') : p);

// With `pty: true` (completion and history stages) PATH holds only the tester's directories, so stray system
// programs cannot change what TAB completes.
async function shell(t, { path = [], env = {}, cwd = null, pty = false, home = null } = {}) {
  const dir = cwd || (await t.tmpDir('ccfree-sh-'));
  const PATH = [...path, pty ? '' : process.env.PATH || ''].filter(Boolean).join(delimiter) || dir;
  const s = new ShellSession(t, { cwd: dir, needPty: pty, env: { PATH, HOME: home || dir, ...env } }).start();
  s.dir = dir;
  return s;
}

// A directory of tester-provided executables.
async function exeDir(t) {
  return realpath(await t.tmpDir('ccfree-bin-'));
}

async function writeExe(dir, name, body) {
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

const customExeBody = signature => [
  'echo "Program was passed $(($# + 1)) args (including program name)."',
  'echo "Arg #0 (program name): $(basename "$0")"',
  'i=1; for a in "$@"; do echo "Arg #$i: $a"; i=$((i + 1)); done',
  `echo "Program Signature: ${signature}"`,
].join('\n');

const customExeOutput = (name, args, signature) => [
  `Program was passed ${args.length + 1} args (including program name).`,
  `Arg #0 (program name): ${name}`,
  ...args.map((a, i) => `Arg #${i + 1}: ${a}`),
  `Program Signature: ${signature}`,
];

// Expected terminal output of a command line, computed with the system shell.
function shOut(command, { cwd, env = {} }) {
  const r = spawnSync('sh', ['-c', `${command} 2>&1`], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  return r.stdout.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).map(l => l.trimEnd());
}

async function files(dir, entries) {
  for (const [name, content] of Object.entries(entries)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
}

// ---------- stage groups ----------

const base = {
  async oo8(t) {
    const sh = await shell(t);
    await sh.waitForPrompt();
    t.log.success('✓ Received prompt "$ "');
  },
  async cz2(t) {
    const sh = await shell(t);
    const cmd = `invalid_${word()}_command`;
    await sh.run(cmd, [`${cmd}: command not found`]);
  },
  async ff0(t) {
    const sh = await shell(t);
    for (let i = 0; i < randInt(2, 4); i++) {
      const cmd = `invalid_${word()}_${randInt(1, 99)}`;
      await sh.run(cmd, [`${cmd}: command not found`]);
    }
  },
  async pn5(t) {
    const sh = await shell(t);
    const cmd = `invalid_${word()}`;
    await sh.run(cmd, [`${cmd}: command not found`]);
    await sh.run('exit', null, { prompt: false });
    await sh.expectExit();
  },
  async iz3(t) {
    const sh = await shell(t);
    for (let i = 0; i < 3; i++) {
      const text = words(randInt(1, 3)).join(' ');
      await sh.run(`echo ${text}`, [text]);
    }
  },
  async ez5(t) {
    const sh = await shell(t);
    for (const b of shuffle(['echo', 'exit', 'type'])) await sh.run(`type ${b}`, [`${b} is a shell builtin`]);
    const missing = `invalid_${word()}_command`;
    await sh.run(`type ${missing}`, [`${missing}: not found`]);
  },
  async mg5(t) {
    requirePosix();
    const [d1, d2, d3] = [await exeDir(t), await exeDir(t), await exeDir(t)];
    const name = `my_exe_${word()}`;
    const noexec = join(d1, name);
    await writeFile(noexec, '#!/bin/sh\necho no\n'); // not executable: must be skipped
    await writeExe(d2, name, 'echo hi');
    const sh = await shell(t, { path: [join(d3, 'missing'), d1, d2] });
    const catPath = execFileSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8', env: { ...process.env, PATH: [join(d3, 'missing'), d1, d2, process.env.PATH].join(':') } }).trim();
    await sh.run('type cat', [`cat is ${catPath}`]);
    await sh.run(`type ${name}`, [`${name} is ${join(d2, name)}`]);
    const missing = `invalid_${word()}`;
    await sh.run(`type ${missing}`, [`${missing}: not found`]);
  },
  async ip1(t) {
    requirePosix();
    const bin = await exeDir(t);
    const name = `custom_exe_${randInt(1000, 9999)}`, signature = sig();
    await writeExe(bin, name, customExeBody(signature));
    const sh = await shell(t, { path: [bin] });
    for (let i = 0; i < 2; i++) {
      const args = words(randInt(1, 3));
      await sh.run(`${name} ${args.join(' ')}`, customExeOutput(name, args, signature));
    }
  },
};

const navigation = {
  async ei0(t) {
    const sh = await shell(t);
    await sh.run('pwd', out => {
      if (out.length !== 1 || normPath(out[0]) !== normPath(sh.dir)) throw new TestFailure(`Expected pwd to print ${sh.dir}, got ${JSON.stringify(out)}`);
      t.log.success(`✓ Received ${out[0]}`);
    });
  },
  async ra6(t) {
    const target = shPath(await realpath(await t.tmpDir('ccfree-cd-')));
    const sh = await shell(t);
    await sh.run(`cd ${target}`, []);
    await sh.run('pwd', out => { if (normPath(out[0] || '') !== normPath(target)) throw new TestFailure(`Expected pwd to print ${target}, got ${JSON.stringify(out)}`); t.log.success(`✓ Received ${out[0]}`); });
    const missing = `${shPath(target)}/non-existing_${word()}`;
    await sh.run(`cd ${missing}`, [`cd: ${missing}: No such file or directory`]);
    await sh.run('pwd', out => { if (normPath(out[0] || '') !== normPath(target)) throw new TestFailure('Expected a failed cd to leave the directory unchanged'); });
  },
  async gq9(t) {
    const root = shPath(await realpath(await t.tmpDir('ccfree-cd-')));
    const [a, b, c] = words(3);
    await mkdir(join(root, a, b, c), { recursive: true });
    const sh = await shell(t);
    const pwdIs = expected => out => { if (normPath(out[0] || '') !== normPath(expected)) throw new TestFailure(`Expected pwd to print ${expected}, got ${JSON.stringify(out)}`); t.log.success(`✓ Received ${out[0]}`); };
    await sh.run(`cd ${root}/${a}`, []);
    await sh.run('pwd', pwdIs(`${root}/${a}`));
    await sh.run(`cd ./${b}/${c}`, []);
    await sh.run('pwd', pwdIs(`${root}/${a}/${b}/${c}`));
    await sh.run('cd ../../', []);
    await sh.run('pwd', pwdIs(`${root}/${a}`));
    await sh.run(`cd ./missing_${word()}`, out => { if (!/^cd: \.\/missing_\w+: No such file or directory$/.test(out[0] || '')) throw new TestFailure(`Expected "cd: <dir>: No such file or directory", got ${JSON.stringify(out)}`); });
  },
  async gp4(t) {
    const home = shPath(await realpath(await t.tmpDir('ccfree-home-')));
    const other = shPath(await realpath(await t.tmpDir('ccfree-cd-')));
    const sh = await shell(t, { home });
    await sh.run(`cd ${other}`, []);
    await sh.run('cd ~', []);
    await sh.run('pwd', out => { if (normPath(out[0] || '') !== normPath(home)) throw new TestFailure(`Expected pwd to print $HOME (${home}), got ${JSON.stringify(out)}`); t.log.success(`✓ Received ${out[0]}`); });
  },
};

// Quoting: echo lines are checked literally; cat lines read files whose names need the quoting.
async function quotingStage(t, echoCases, fileNames) {
  requirePosix();
  const dir = await realpath(await t.tmpDir('ccfree-q-'));
  const sh = await shell(t, { cwd: dir });
  for (const [input, output] of echoCases) await sh.run(`echo ${input}`, [output]);
  if (fileNames) {
    // Files are concatenated on one line by cat; only the last one ends with a newline.
    const contents = fileNames.map(() => `${word()} ${word()}.`);
    for (const [i, [real]] of fileNames.entries()) await writeFile(join(dir, real), contents[i] + (i === fileNames.length - 1 ? '\n' : ''));
    await sh.run(`cat ${fileNames.map(([, typed]) => typed).join(' ')}`, [contents.join('')]);
  }
}

const quoting = {
  async ni6(t) {
    const [a, b, c] = words(3);
    await quotingStage(t, [[`'${a} ${b}'`, `${a} ${b}`], [`'${a}     ${b}' '${c}'`, `${a}     ${b} ${c}`], [`${a}''${b}`, `${a}${b}`]],
      [[`f ${randInt(1, 99)}`, null], [`f with spaces ${randInt(1, 99)}`, null]].map(([n]) => [n, `'${n}'`]));
  },
  async tg6(t) {
    const [a, b, c] = words(3);
    await quotingStage(t, [[`"${a}  ${b}"  "${c}"`, `${a}  ${b} ${c}`], [`"${a}"  "${b}'s"  "${c}"`, `${a} ${b}'s ${c}`], [`"${a}""${b}"`, `${a}${b}`]],
      [`f ${randInt(1, 99)}`, `f 'quoted' ${randInt(1, 99)}`].map(n => [n, `"${n}"`]));
  },
  async yt5(t) {
    const [a, b] = words(2);
    const n = randInt(1, 99);
    await quotingStage(t, [[`${a}\\ \\ \\ \\ ${b}`, `${a}    ${b}`], [`\\'\\"${a} ${b}\\"\\'`, `'"${a} ${b}"'`], [`${a}\\n${b}`, `${a}n${b}`]],
      [[`f_${n}_a`, `f_\\${n}_a`], [`f ${n} b`, `f\\ ${n}\\ b`], [`f\\${n}c`, `f\\\\${n}c`]]);
  },
  async le5(t) {
    const [a, b] = words(2);
    const n = randInt(1, 99);
    await quotingStage(t, [[`'${a}\\\\${b}'`, `${a}\\\\${b}`], [`'${a}\\"${b}\\"'`, `${a}\\"${b}\\"`], [`'${a}\\n${b}'`, `${a}\\n${b}`]],
      [[`no slash ${n}`, `'no slash ${n}'`], [`one slash \\${n}`, `'one slash \\${n}'`], [`two slashes \\${n}\\`, `'two slashes \\${n}\\'`]]);
  },
  async gu3(t) {
    const [a, b] = words(2);
    const n = randInt(1, 99);
    await quotingStage(t, [[`"${a}'one'\\\\n'${b}"`, `${a}'one'\\n'${b}`], [`"${a}\\"literal_quote."${b}\\"`, `${a}"literal_quote.${b}"`], [`"${a}\\$${b}"`, `${a}$${b}`]],
      [[`number ${n}`, `"number ${n}"`], [`doublequote " ${n}`, `"doublequote \\" ${n}"`], [`backslash \\ ${n}`, `"backslash \\\\ ${n}"`]]);
  },
  async qj0(t) {
    requirePosix();
    const bin = await exeDir(t);
    const dir = await realpath(await t.tmpDir('ccfree-q-'));
    const cat = execFileSync('sh', ['-c', 'command -v cat'], { encoding: 'utf8' }).trim();
    const n1 = `exe with "quotes" ${randInt(1, 99)}`, n2 = `exe with 'single quotes' ${randInt(1, 99)}`;
    await writeExe(bin, n1, `exec ${cat} "$@"`);
    await writeExe(bin, n2, `exec ${cat} "$@"`);
    const [c1, c2] = [`${word()}.`, `${word()}.`];
    await files(dir, { f1: `${c1}
`, f2: `${c2}
` });
    const sh = await shell(t, { path: [bin], cwd: dir });
    await sh.run(`'${n1}' f1`, [c1]);
    await sh.run(`"${n2}" f2`, [c2]);
  },
};

async function redirectFixture(t) {
  requirePosix();
  const dir = await realpath(await t.tmpDir('ccfree-r-'));
  const list = words(3).sort();
  await files(dir, Object.fromEntries(list.map(f => [`src/${f}`, `${f}\n`])));
  await mkdir(join(dir, 'out'), { recursive: true });
  return { dir, list, sh: await shell(t, { cwd: dir }) };
}

const redirection = {
  async jv1(t) {
    const { dir, list, sh } = await redirectFixture(t);
    await sh.run('ls src > out/a.md', []);
    await sh.run('cat out/a.md', list);
    const msg = words(2).join(' ');
    await sh.run(`echo ${msg} 1> out/b.md`, []);
    await sh.run('cat out/b.md', [msg]);
    await sh.run(`cat src/${list[0]} nonexistent 1> out/c.md`, shOut('cat nonexistent', { cwd: dir }));
    await sh.run('cat out/c.md', [list[0]]);
  },
  async vz4(t) {
    const { dir, list, sh } = await redirectFixture(t);
    await sh.run('ls nonexistent 2> out/a.md', []);
    await sh.run('cat out/a.md', shOut('ls nonexistent', { cwd: dir }));
    const msg = words(2).join(' ');
    await sh.run(`echo ${msg} 2> out/b.md`, [msg]);
    await sh.run(`cat src/${list[1]} nonexistent 2> out/c.md`, [list[1]]);
    await sh.run('cat out/c.md', shOut('cat nonexistent', { cwd: dir }));
  },
  async el9(t) {
    const { list, sh } = await redirectFixture(t);
    await sh.run('ls src >> out/a.md', []);
    await sh.run('cat out/a.md', list);
    const [m1, m2] = [words(2).join(' '), words(2).join(' ')];
    await sh.run(`echo ${m1} 1>> out/b.md`, []);
    await sh.run(`echo ${m2} 1>> out/b.md`, []);
    await sh.run('cat out/b.md', [m1, m2]);
    await sh.run('echo List of files: > out/c.md', []);
    await sh.run('ls src >> out/c.md', []);
    await sh.run('cat out/c.md', ['List of files:', ...list]);
  },
  async un3(t) {
    const { dir, sh } = await redirectFixture(t);
    await sh.run('ls nonexistent >> out/a.md', shOut('ls nonexistent', { cwd: dir }));
    await sh.run('ls nonexistent 2>> out/b.md', []);
    await sh.run('cat out/b.md', shOut('ls nonexistent', { cwd: dir }));
    const msg = words(2).join(' ');
    await sh.run(`echo ${msg} 2>> out/c.md`, [msg]);
    await sh.run('cat nonexistent 2>> out/c.md', []);
    await sh.run('ls nonexistent 2>> out/c.md', []);
    await sh.run('cat out/c.md', [...shOut('cat nonexistent', { cwd: dir }), ...shOut('ls nonexistent', { cwd: dir })]);
  },
};

// ---------- completion helpers ----------

async function completes(sh, typed, expectedLine) {
  await sh.waitForPrompt();
  sh.type(typed);
  sh.press('tab');
  await sh.expectInput(expectedLine);
}

async function bellThenList(sh, typed, list) {
  await sh.waitForPrompt();
  const before = sh.screen.bells;
  const row = sh.screen.row;
  sh.type(typed);
  sh.press('tab');
  await sh.expectBell(before);
  sh.press('tab');
  await sh.waitFor(() => sh.screen.row >= row + 2 && sh.screen.beforeCursor === `$ ${typed}`, `the matches to be listed and the line "$ ${typed}" to reappear`);
  const shown = sh.screen.text()[sh.screen.row - 1];
  const got = shown.trim().split(/\s+/);
  if (JSON.stringify(got) !== JSON.stringify(list)) throw new TestFailure(`Expected the matches ${JSON.stringify(list.join('  '))} on one line, got ${JSON.stringify(shown)}`);
  sh.t.log.success(`✓ Matches listed: ${shown.trim()}`);
}

const completions = {
  async qp2(t) {
    const sh = await shell(t, { pty: true });
    await completes(sh, 'ech', '$ echo ');
    sh.press('enter');
    const sh2 = await shell(t, { pty: true });
    await completes(sh2, 'exi', '$ exit ');
  },
  async gm9(t) {
    const sh = await shell(t, { pty: true });
    for (let i = 0; i < 2; i++) {
      await completes(sh, 'ech', '$ echo ');
      const text = words(randInt(1, 2)).join(' ');
      const row = sh.screen.row;
      sh.type(text);
      sh.press('enter');
      await sh.waitFor(() => sh.screen.row > row && sh.atPrompt(), 'the echo output and a new prompt');
      sh.check(`echo ${text}`, sh.screen.text().slice(row + 1, sh.screen.row), [text]);
    }
  },
  async qm8(t) {
    const sh = await shell(t, { pty: true });
    await sh.waitForPrompt();
    const before = sh.screen.bells;
    const typed = `xyz_${word()}`;
    sh.type(typed);
    sh.press('tab');
    await sh.expectBell(before);
    await sh.expectInput(`$ ${typed}`);
  },
  async gy5(t) {
    requirePosix();
    const bin = await exeDir(t);
    const name = `custom_${word()}_exe`;
    await writeExe(bin, name, 'echo ok');
    const sh = await shell(t, { path: [join(bin, 'missing'), bin], pty: true });
    await completes(sh, name.slice(0, 9), `$ ${name} `);
  },
  async wh6(t) {
    requirePosix();
    const names = words(3).map(w => `xyz_${w}`).sort();
    const dirs = [];
    for (const n of names) { const d = await exeDir(t); await writeExe(d, n, 'echo ok'); dirs.push(d); }
    const sh = await shell(t, { path: dirs, pty: true });
    await bellThenList(sh, 'xyz_', names);
  },
  async wt6(t) {
    requirePosix();
    const [a, b, c] = words(3);
    const names = [`xyz_${a}`, `xyz_${a}_${b}`, `xyz_${a}_${b}_${c}`];
    const dirs = [];
    for (const n of names) { const d = await exeDir(t); await writeExe(d, n, 'echo ok'); dirs.push(d); }
    const sh = await shell(t, { path: dirs, pty: true });
    await completes(sh, 'xyz_', `$ xyz_${a}`);
    sh.type('_'); sh.press('tab');
    await sh.expectInput(`$ xyz_${a}_${b}`);
    sh.type('_'); sh.press('tab');
    await sh.expectInput(`$ xyz_${a}_${b}_${c} `);
  },
};

const filenameCompletion = {
  async zv2(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    const [f1, f2] = [`${word()}_notes.txt`, `${word()}_world.py`];
    await files(dir, { [f1]: 'a', [f2]: 'b' });
    const sh = await shell(t, { cwd: dir, pty: true });
    await completes(sh, `cat ${f1.slice(0, 3)}`, `$ cat ${f1} `);
    const sh2 = await shell(t, { cwd: dir, pty: true });
    await completes(sh2, `xyz ${f2.slice(0, 4)}`, `$ xyz ${f2} `);
  },
  async ue6(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    const [a, b, f] = words(3);
    await files(dir, { [`${a}/${b}/${f}.txt`]: 'x' });
    const sh = await shell(t, { cwd: dir, pty: true });
    await completes(sh, `cat ${a}/${b}/${f.slice(0, 2)}`, `$ cat ${a}/${b}/${f}.txt `);
  },
  async lc6(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    const [a, b] = words(2);
    await mkdir(join(dir, a, b), { recursive: true });
    const sh = await shell(t, { cwd: dir, pty: true });
    await completes(sh, 'ls ', `$ ls ${a}/`);
    sh.press('tab');
    await sh.expectInput(`$ ls ${a}/${b}/`);
  },
  async vs5(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    await files(dir, { [`${word()}.txt`]: 'x' });
    const sh = await shell(t, { cwd: dir, pty: true });
    await sh.waitForPrompt();
    const before = sh.screen.bells;
    sh.type('cat absent_filenam');
    sh.press('tab');
    await sh.expectBell(before);
    await sh.expectInput('$ cat absent_filenam');
  },
  async no5(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    const [f, d] = words(2);
    await files(dir, { [`${f}.txt`]: 'x' });
    await mkdir(join(dir, d));
    const sh = await shell(t, { cwd: dir, pty: true });
    await bellThenList(sh, 'stat ', [`${f}.txt`, `${d}/`].sort());
  },
  async jp8(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    const [a, b, c] = words(3);
    await files(dir, { [`xyz_${a}`]: 'x', [`xyz_${a}_${b}`]: 'y' });
    await mkdir(join(dir, `xyz_${a}_${b}_${c}`));
    const sh = await shell(t, { cwd: dir, pty: true });
    await completes(sh, 'ls xyz_', `$ ls xyz_${a}`);
    sh.type('_'); sh.press('tab');
    await sh.expectInput(`$ ls xyz_${a}_${b}`);
    sh.type('_'); sh.press('tab');
    await sh.expectInput(`$ ls xyz_${a}_${b}_${c}/`);
  },
  async bf8(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-fc-'));
    const f = `foo_${word()}`, d = `bar_${word()}`;
    await files(dir, { [f]: 'x' });
    await mkdir(join(dir, d));
    const sh = await shell(t, { cwd: dir, pty: true });
    await bellThenList(sh, 'ls ', [`${d}/`, f]);
    sh.type('b'); sh.press('tab');
    await sh.expectInput(`$ ls ${d}/`);
    sh.type(' f'); sh.press('tab');
    await sh.expectInput(`$ ls ${d}/ ${f} `);
    const before = sh.screen.bells;
    sh.type('qqq'); sh.press('tab');
    await sh.expectBell(before);
    await sh.expectInput(`$ ls ${d}/ ${f} qqq`);
  },

};

// Programmable completion: completer scripts written by the tester.
async function completer(t, body) {
  requirePosix();
  const bin = await exeDir(t);
  return writeExe(bin, `completer_${word()}`, body);
}

const programmable = {
  async ne7(t) { const sh = await shell(t); await sh.run('type complete', ['complete is a shell builtin']); },
  async oi7(t) { const sh = await shell(t); const c = word(); await sh.run(`complete -p ${c}`, [`complete: ${c}: no completion specification`]); },
  async wl6(t) {
    const sh = await shell(t);
    const [c1, c2] = words(2);
    const [p1, p2] = [`/path/to/${word()}/completer`, `/opt/${word()}/complete.sh`];
    await sh.run(`complete  -C  ${p1}  ${c1}`, []);
    await sh.run(`complete -p ${c1}`, [`complete -C '${p1}' ${c1}`]);
    await sh.run(`complete   -C ${p2}    ${c2}`, []);
    await sh.run(`complete -p ${c2}`, [`complete -C '${p2}' ${c2}`]);
  },
  async pm5(t) {
    const cand = word();
    const script = await completer(t, `echo ${cand}`);
    const sh = await shell(t, { pty: true });
    const cmd = word();
    await sh.run(`complete -C ${script} ${cmd}`, []);
    await completes(sh, `${cmd} `, `$ ${cmd} ${cand} `);
  },
  async qf1(t) {
    const script = await completer(t, 'exit 0');
    const sh = await shell(t, { pty: true });
    await sh.run(`complete -C ${script} docker`, []);
    await sh.waitForPrompt();
    const before = sh.screen.bells;
    sh.type('docker xyz');
    sh.press('tab');
    await sh.expectBell(before);
    await sh.expectInput('$ docker xyz');
  },
  async zi0(t) {
    const script = await completer(t, '[ "$1" = git ] && [ "$2" = set ] && [ "$3" = remote ] && echo set-url');
    const sh = await shell(t, { pty: true });
    await sh.run(`complete -C ${script} git`, []);
    await completes(sh, 'git remote set', '$ git remote set-url ');
  },
  async nr7(t) {
    const script = await completer(t, '[ "$COMP_LINE" = "git ad" ] && [ "$COMP_POINT" = 6 ] && [ "$2" = ad ] && echo add');
    const sh = await shell(t, { pty: true });
    await sh.run(`complete -C ${script} git`, []);
    await completes(sh, 'git ad', '$ git add ');
  },
  async ep2(t) {
    const script = await completer(t, 'echo push; echo add; echo commit');
    const sh = await shell(t, { pty: true });
    await sh.run(`complete -C ${script} git`, []);
    await bellThenList(sh, 'git ', ['add', 'commit', 'push']);
  },
  async xz3(t) {
    const script = await completer(t, 'for w in checkout cherry-pick; do case "$w" in "$2"*) echo "$w";; esac; done');
    const sh = await shell(t, { pty: true });
    await sh.run(`complete -C ${script} git`, []);
    await completes(sh, 'git c', '$ git che');
    sh.type('c'); sh.press('tab');
    await sh.expectInput('$ git checkout ');
  },
  async tz2(t) {
    const script = await completer(t, 'echo status');
    const sh = await shell(t, { pty: true });
    await sh.run(`complete -C ${script} git`, []);
    await sh.run('complete -r git', []);
    await sh.run('complete -p git', ['complete: git: no completion specification']);
    await sh.waitForPrompt();
    const before = sh.screen.bells;
    sh.type('git ');
    sh.press('tab');
    await sh.expectBell(before);
  },
};

// ---------- background jobs ----------

const jobLine = (n, marker, status, cmd) => `[${n}]${marker}  ${status.padEnd(24)}${cmd}`;
const runningRe = (n, marker, cmd) => new RegExp(`^\\[${n}\\]\\${marker === ' ' ? ' ' : marker}  Running {17}${cmd.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}( &)?$`);

async function fifo(t) {
  const dir = await t.tmpDir('ccfree-fifo-');
  const path = join(dir, `fifo_${word()}`);
  execFileSync('mkfifo', [path]);
  return path;
}
const writeFifo = (path, text) => spawnSync('sh', ['-c', `printf '%s' "$1" > "$2"`, 'sh', text, path]);

async function bg(sh, cmd, n) {
  await sh.run(`${cmd} &`, out => {
    if (out.length !== 1 || !new RegExp(`^\\[${n}\\] \\d+$`).test(out[0])) throw new TestFailure(`Expected "[${n}] <pid>", got ${JSON.stringify(out)}`);
    sh.t.log.success(`✓ Received ${out[0]}`);
  });
}

const jobs = {
  async af3(t) { const sh = await shell(t); await sh.run('type jobs', ['jobs is a shell builtin']); await sh.run('jobs', []); },
  async at7(t) {
    requirePosix();
    const sh = await shell(t);
    const secs = randInt(300, 900);
    await bg(sh, `sleep ${secs}`, 1);
    const running = spawnSync('sh', ['-c', `ps -eo args | grep -c "^sleep ${secs}$"`], { encoding: 'utf8' }).stdout.trim();
    if (running === '0') throw new TestFailure(`Expected "sleep ${secs}" to be running in the background`);
    t.log.success('✓ The background process is running');
  },
  async si2(t) {
    requirePosix();
    const [f1, f2] = [await fifo(t), await fifo(t)];
    const sh = await shell(t);
    await bg(sh, `cat ${f1}`, 1);
    await sh.waitForPrompt();
    const row = sh.screen.row;
    sh.send(`cat ${f2}\r`);
    await new Promise(r => setTimeout(r, 300));
    const [m1, m2] = [`Hello from ${word()}`, `Hello from ${word()}`];
    writeFifo(f1, `${m1}\n`);
    await sh.waitFor(() => sh.screen.text().slice(row).includes(m1), `"${m1}" (background job output)`);
    writeFifo(f2, `${m2}\n`);
    await sh.waitFor(() => sh.screen.text().slice(row).includes(m2), `"${m2}" (foreground job output)`);
    t.log.success('✓ Output from both jobs appeared');
  },
  async jd6(t) {
    requirePosix();
    const sh = await shell(t);
    const cmd = `sleep ${randInt(100, 500)}`;
    await bg(sh, cmd, 1);
    await sh.run('jobs', [runningRe(1, '+', cmd)]);
  },
  async dk5(t) {
    requirePosix();
    const sh = await shell(t);
    const cmds = [10, 20, 30].map(s => `sleep ${s + randInt(100, 900)}`);
    await bg(sh, cmds[0], 1);
    await sh.run('jobs', [runningRe(1, '+', cmds[0])]);
    await bg(sh, cmds[1], 2);
    await sh.run('jobs', [runningRe(1, '-', cmds[0]), runningRe(2, '+', cmds[1])]);
    await bg(sh, cmds[2], 3);
    await sh.run('jobs', [runningRe(1, ' ', cmds[0]), runningRe(2, '-', cmds[1]), runningRe(3, '+', cmds[2])]);
  },
  async ma9(t) {
    requirePosix();
    const f = await fifo(t);
    const sh = await shell(t);
    await bg(sh, `cat ${f}`, 1);
    await sh.run('jobs', [runningRe(1, '+', `cat ${f}`)]);
    writeFifo(f, '');
    await new Promise(r => setTimeout(r, 300));
    await sh.run('jobs', [jobLine(1, '+', 'Done', `cat ${f}`)]);
    await sh.run('jobs', []);
  },
  async rq2(t) {
    requirePosix();
    const [f1, f2] = [await fifo(t), await fifo(t)];
    const sh = await shell(t);
    const sleep = `sleep ${randInt(300, 900)}`;
    await bg(sh, sleep, 1);
    await bg(sh, `cat ${f1}`, 2);
    await bg(sh, `cat ${f2}`, 3);
    writeFifo(f1, '');
    await new Promise(r => setTimeout(r, 300));
    await sh.run('jobs', [runningRe(1, ' ', sleep), jobLine(2, '-', 'Done', `cat ${f1}`), runningRe(3, '+', `cat ${f2}`)]);
    writeFifo(f2, '');
    await new Promise(r => setTimeout(r, 300));
    await sh.run('jobs', [runningRe(1, '-', sleep), jobLine(3, '+', 'Done', `cat ${f2}`)]);
    await sh.run('jobs', [runningRe(1, '+', sleep)]);
  },
  async bv8(t) {
    requirePosix();
    const f = await fifo(t);
    const sh = await shell(t);
    const sleep = `sleep ${randInt(300, 900)}`;
    await bg(sh, sleep, 1);
    await bg(sh, `cat ${f}`, 2);
    await sh.run('jobs', [runningRe(1, '-', sleep), runningRe(2, '+', `cat ${f}`)]);
    writeFifo(f, '');
    await new Promise(r => setTimeout(r, 300));
    const w = word();
    await sh.run(`echo ${w}`, [w, jobLine(2, '+', 'Done', `cat ${f}`)]);
    await sh.run('jobs', [runningRe(1, '+', sleep)]);
  },
  async fy4(t) {
    requirePosix();
    const f = await fifo(t);
    let sh = await shell(t);
    await bg(sh, `cat ${f}`, 1);
    writeFifo(f, '');
    await new Promise(r => setTimeout(r, 300));
    const w = word();
    await sh.run(`echo ${w}`, [w, jobLine(1, '+', 'Done', `cat ${f}`)]);
    const s1 = `sleep ${randInt(100, 500)}`;
    await bg(sh, s1, 1);
    await sh.run('jobs', [runningRe(1, '+', s1)]);

    const f2 = await fifo(t);
    sh = await shell(t);
    const s2 = `sleep ${randInt(100, 500)}`, s3 = `sleep ${randInt(50, 99)}`;
    await bg(sh, s2, 1);
    await bg(sh, `cat ${f2}`, 2);
    writeFifo(f2, '');
    await new Promise(r => setTimeout(r, 300));
    const w2 = word();
    await sh.run(`echo ${w2}`, [w2, jobLine(2, '+', 'Done', `cat ${f2}`)]);
    await bg(sh, s3, 2);
    await sh.run('jobs', [runningRe(1, '-', s2), runningRe(2, '+', s3)]);
  },
};

// ---------- pipelines ----------

const pipelines = {
  async br6(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-p-'));
    const lines = Array.from({ length: randInt(4, 7) }, () => words(2).join(' '));
    await files(dir, { 'data.txt': lines.join('\n') + '\n', 'live.txt': lines.slice(0, 3).join('\n') + '\n' });
    const sh = await shell(t, { cwd: dir });
    await sh.run('cat data.txt | wc', shOut('cat data.txt | wc', { cwd: dir }));
    await sh.waitForPrompt();
    const row = sh.screen.row;
    t.log.info('$ tail -f live.txt | head -n 5');
    sh.send('tail -f live.txt | head -n 5\r');
    // Some tail implementations only flush their first lines into a pipe once the file changes,
    // so the tester appends after a short pause instead of waiting for those lines first.
    await new Promise(r => setTimeout(r, 700));
    const more = ['This is line 4.', 'This is line 5.'];
    await writeFile(join(dir, 'live.txt'), more.join('\n') + '\n', { flag: 'a' });
    await sh.waitFor(() => sh.screen.row > row + 5 && sh.atPrompt(), 'the appended lines and a new prompt (head should exit after 5 lines)', 8000);
    sh.check('tail -f live.txt | head -n 5', sh.screen.text().slice(row + 1, sh.screen.row), [...lines.slice(0, 3), ...more]);
  },
  async ny9(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-p-'));
    const sh = await shell(t, { cwd: dir });
    const w = `${word()}-${word()}`;
    await sh.run(`echo ${w} | wc`, shOut(`echo ${w} | wc`, { cwd: dir }));
    await sh.run('ls | type exit', ['exit is a shell builtin']);
  },
  async xk3(t) {
    requirePosix();
    const dir = await realpath(await t.tmpDir('ccfree-p-'));
    const lines = Array.from({ length: randInt(6, 9) }, () => word());
    await files(dir, { 'data.txt': lines.join('\n') + '\n' });
    const sh = await shell(t, { cwd: dir });
    for (const cmd of ['cat data.txt | head -n 3 | wc', `cat data.txt | sort | head -n 4 | tail -n 2`]) await sh.run(cmd, shOut(cmd, { cwd: dir }));
  },
};

// ---------- history ----------

const historyLines = cmds => cmds.map((c, i) => `${String(i + 1).padStart(5)}  ${c}`);

const history = {
  async bq4(t) { const sh = await shell(t); await sh.run('type history', ['history is a shell builtin']); },
  async yf5(t) {
    const sh = await shell(t);
    const cmds = [`echo ${word()}`, `echo ${word()}`, `invalid_${word()}`];
    await sh.run(cmds[0], [cmds[0].slice(5)]);
    await sh.run(cmds[1], [cmds[1].slice(5)]);
    await sh.run(cmds[2], [`${cmds[2]}: command not found`]);
    await sh.run('history', historyLines([...cmds, 'history']));
  },
  async ag6(t) {
    const sh = await shell(t);
    const cmds = [`echo ${word()}`, `echo ${word()}`, `invalid_${word()}`];
    await sh.run(cmds[0], [cmds[0].slice(5)]);
    await sh.run(cmds[1], [cmds[1].slice(5)]);
    await sh.run(cmds[2], [`${cmds[2]}: command not found`]);
    const n = randInt(2, 3);
    await sh.run(`history ${n}`, historyLines([...cmds, `history ${n}`]).slice(-n));
  },
  async rh7(t) {
    const sh = await shell(t, { pty: true });
    const [a, b] = words(2);
    await sh.run(`echo ${a}`, [a]);
    await sh.run(`echo ${b}`, [b]);
    await sh.waitForPrompt();
    sh.press('up');
    await sh.expectInput(`$ echo ${b}`);
    sh.press('up');
    await sh.expectInput(`$ echo ${a}`);
  },
  async vq0(t) {
    const sh = await shell(t, { pty: true });
    const [a, b] = words(2);
    await sh.run(`echo ${a}`, [a]);
    await sh.run(`echo ${b}`, [b]);
    await sh.waitForPrompt();
    sh.press('up'); await sh.expectInput(`$ echo ${b}`);
    sh.press('up'); await sh.expectInput(`$ echo ${a}`);
    sh.press('down'); await sh.expectInput(`$ echo ${b}`);
  },
  async dm2(t) {
    const sh = await shell(t, { pty: true });
    const [a, b] = words(2);
    await sh.run(`echo ${a}`, [a]);
    await sh.run(`echo ${b}`, [b]);
    await sh.waitForPrompt();
    sh.press('up'); await sh.expectInput(`$ echo ${b}`);
    sh.press('up'); await sh.expectInput(`$ echo ${a}`);
    sh.press('down'); await sh.expectInput(`$ echo ${b}`);
    const row = sh.screen.row;
    sh.press('enter');
    await sh.waitFor(() => sh.screen.row > row && sh.atPrompt(), 'the command to run and a new prompt');
    sh.check(`echo ${b}`, sh.screen.text().slice(row + 1, sh.screen.row), [b]);
  },
};

async function histFile(t, lines) {
  const path = shPath(join(await t.tmpDir('ccfree-hist-'), '.history'));
  if (lines) await writeFile(path, lines.map(l => `${l}\n`).join(''));
  return path;
}
async function expectFile(t, path, lines) {
  const actual = (await readFile(path, 'utf8').catch(() => null))?.replace(/\r\n/g, '\n');
  const expected = lines.map(l => `${l}\n`).join('');
  if (actual !== expected) throw new TestFailure(`Expected ${path} to contain:\n${expected}Got:\n${actual ?? '(file missing)'}`);
  t.log.success('✓ History file has the expected contents');
}

const historyPersistence = {
  async za2(t) {
    const pre = [`echo ${word()}`, `echo ${word()}`];
    const file = await histFile(t, pre);
    const sh = await shell(t);
    await sh.run(`history -r ${file}`, []);
    await sh.run('history', historyLines([`history -r ${file}`, ...pre, 'history']));
  },
  async in3(t) {
    const file = await histFile(t, null);
    const sh = await shell(t);
    const [a, b] = words(2);
    await sh.run(`echo ${a}`, [a]);
    await sh.run(`echo ${b}`, [b]);
    await sh.run(`history -w ${file}`, []);
    await expectFile(t, file, [`echo ${a}`, `echo ${b}`, `history -w ${file}`]);
  },
  async sx3(t) {
    const pre = [`echo ${word()}`, `echo ${word()}`];
    const file = await histFile(t, pre);
    const sh = await shell(t);
    const a = word();
    await sh.run(`echo ${a}`, [a]);
    await sh.run(`history -a ${file}`, []);
    await expectFile(t, file, [...pre, `echo ${a}`, `history -a ${file}`]);
    const b = word();
    await sh.run(`echo ${b}`, [b]);
    await sh.run(`history -a ${file}`, []);
    await expectFile(t, file, [...pre, `echo ${a}`, `history -a ${file}`, `echo ${b}`, `history -a ${file}`]);
  },
  async zp4(t) {
    const pre = [`echo ${word()}`, `echo ${word()}`];
    const file = await histFile(t, pre);
    const sh = await shell(t, { env: { HISTFILE: file } });
    await sh.run('history', historyLines([...pre, 'history']));
  },
  async kz7(t) {
    const file = await histFile(t, null);
    const sh = await shell(t, { env: { HISTFILE: file } });
    const [a, b] = words(2);
    await sh.run(`echo ${a}`, [a]);
    await sh.run(`echo ${b}`, [b]);
    await sh.run('exit', null, { prompt: false });
    await sh.expectExit();
    await expectFile(t, file, [`echo ${a}`, `echo ${b}`, 'exit']);
  },
  async jv2(t) {
    const pre = [`echo ${word()}`, `echo ${word()}`];
    const file = await histFile(t, pre);
    const sh = await shell(t, { env: { HISTFILE: file } });
    const a = word();
    await sh.run(`echo ${a}`, [a]);
    await sh.run('exit', null, { prompt: false });
    await sh.expectExit();
    await expectFile(t, file, [...pre, `echo ${a}`, 'exit']);
  },
};

// ---------- parameter expansion ----------

async function exeShell(t) {
  requirePosix();
  const bin = await exeDir(t);
  const name = `custom_exe_${randInt(1000, 9999)}`, signature = sig();
  await writeExe(bin, name, customExeBody(signature));
  const sh = await shell(t, { path: [bin] });
  return { sh, name, signature };
}

const parameters = {
  async ji0(t) { const sh = await shell(t); await sh.run('type declare', ['declare is a shell builtin']); },
  async oa2(t) { const sh = await shell(t); const v = `missing_${word()}`; await sh.run(`declare -p ${v}`, [`declare: ${v}: not found`]); },
  async kv5(t) {
    const sh = await shell(t);
    const [n, v1, v2] = words(3);
    await sh.run(`declare ${n}=${v1}`, []);
    await sh.run(`declare -p ${n}`, [`declare -- ${n}="${v1}"`]);
    await sh.run(`declare -p missing_${n}`, [`declare: missing_${n}: not found`]);
    await sh.run(`declare ${n}=${v2}`, []);
    await sh.run(`declare -p ${n}`, [`declare -- ${n}="${v2}"`]);
  },
  async db8(t) {
    const sh = await shell(t);
    const bad = `${randInt(1, 99)}${word()}=x`;
    await sh.run(`declare ${bad}`, [`declare: \`${bad}': not a valid identifier`]);
    const good = `_${word().toUpperCase()}`, v = word();
    await sh.run(`declare ${good}=${v}`, []);
    await sh.run(`declare -p ${good}`, [`declare -- ${good}="${v}"`]);
  },
  async ge9(t) {
    const { sh, name, signature } = await exeShell(t);
    const vars = { [`Var_${word()}`]: `Value_${word()}`, [`Var_${word()}2`]: word() };
    for (const [k, v] of Object.entries(vars)) await sh.run(`declare ${k}=${v}`, []);
    await sh.run(`${name} ${Object.keys(vars).map(k => `$${k}`).join(' ')}`, customExeOutput(name, Object.values(vars), signature));
  },
  async br2(t) {
    const { sh, name, signature } = await exeShell(t);
    const [k1, v1, k2, v2] = [`Item${randInt(1, 9)}`, word(), `Foo${randInt(1, 9)}`, word()];
    await sh.run(`declare ${k1}=${v1}`, []);
    await sh.run(`declare ${k2}=${v2}`, []);
    await sh.run(`${name} stock_\${${k1}}_id \${${k2}}`, customExeOutput(name, [`stock_${v1}_id`, v2], signature));
  },
  async my0(t) {
    const { sh, name, signature } = await exeShell(t);
    const v = word();
    await sh.run(`declare existing=${v}`, []);
    await sh.run(`${name} \${missing1}end \${existing} \${missing2}`, customExeOutput(name, ['end', v], signature));
  },
};

export const stages = { ...base, ...navigation, ...quoting, ...redirection, ...completions, ...filenameCompletion, ...programmable, ...jobs, ...pipelines, ...history, ...historyPersistence, ...parameters };
export const timeouts = { br6: 30000, fy4: 30000, rq2: 30000 };

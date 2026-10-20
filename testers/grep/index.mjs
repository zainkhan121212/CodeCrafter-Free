// grep tester: runs the learner's grep with -E patterns and checks exit codes and output.
// Expected results are computed with a reference regex engine on patterns whose POSIX (leftmost-longest)
// and backtracking (leftmost-first) semantics agree.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { Proc } from '../../lib/harness/process.mjs';
import { ptyCommand } from '../../lib/harness/pty.mjs';
import { word, words, randInt, pick, shuffle } from '../../lib/harness/random.mjs';

const toRegExp = (pattern, flags = '') => new RegExp(pattern, flags);
const matches = (pattern, line) => toRegExp(pattern).test(line);
const shellQuote = s => `'${s.replace(/'/g, `'\\''`)}'`;

async function grep(t, { input = null, args }) {
  const display = `${input !== null ? `echo -n ${shellQuote(input)} | ` : ''}./your_program.sh ${args.map(a => (/^[\w./:=-]+$/.test(a) ? a : shellQuote(a))).join(' ')}`;
  t.log.info(`$ ${display.replace(/\n/g, '\\n')}`);
  return t.exec(args, { stdin: input ?? '', cwd: t.cwd });
}

function expectExit(t, r, code) {
  if (r.exitCode !== code) throw new TestFailure(`Expected exit code ${code}, got ${r.exitCode}`);
  t.log.success(`✓ Received exit code ${code}.`);
}

function expectStdout(t, r, expected) {
  if (r.stdout.replace(/\r\n/g, '\n') !== expected) throw new TestFailure(`Expected stdout:\n${JSON.stringify(expected)}\nGot:\n${JSON.stringify(r.stdout)}`);
  if (expected) t.log.success(`✓ Stdout is correct`);
}

// Exit-code-only cases. Each case is [input, pattern]; the expectation is computed.
async function exitCases(t, cases) {
  for (const [input, pattern] of shuffle(cases)) {
    expectExit(t, await grep(t, { input, args: ['-E', pattern] }), matches(pattern, input) ? 0 : 1);
  }
}

// Printing cases: matching lines are printed.
async function printCases(t, cases) {
  for (const [input, pattern] of cases) {
    const lines = input.split('\n');
    const hits = lines.filter(l => matches(pattern, l));
    const r = await grep(t, { input, args: ['-E', pattern] });
    expectExit(t, r, hits.length ? 0 : 1);
    expectStdout(t, r, hits.map(l => `${l}\n`).join(''));
  }
}

async function onlyCases(t, cases) {
  for (const [input, pattern] of cases) {
    const out = [];
    for (const line of input.split('\n')) for (const m of line.matchAll(toRegExp(pattern, 'g'))) if (m[0]) out.push(m[0]);
    const r = await grep(t, { input, args: ['-o', '-E', pattern] });
    expectExit(t, r, out.length ? 0 : 1);
    expectStdout(t, r, out.map(m => `${m}\n`).join(''));
  }
}

// Color output: normalize any bold+red SGR start and reset sequence to markers.
const normalizeColor = s => s.replace(/\r\n/g, '\n')
  .replace(/\x1b\[(?:0?1;31|31;0?1)m(?:\x1b\[K)?/g, '«').replace(/\x1b\[0?m(?:\x1b\[K)?/g, '»');
function highlighted(input, pattern) {
  return input.split('\n').filter(l => matches(pattern, l)).map(l => `${l.replace(toRegExp(pattern, 'g'), m => (m ? `«${m}»` : m))}\n`).join('');
}

async function colorCases(t, cases, flag = '--color=always') {
  for (const [input, pattern] of cases) {
    const expected = highlighted(input, pattern);
    const r = await grep(t, { input, args: [flag, '-E', pattern] });
    expectExit(t, r, expected ? 0 : 1);
    const actual = normalizeColor(r.stdout);
    if (actual !== expected) throw new TestFailure(`Expected output (« » mark bold red highlighting, e.g. \\x1b[01;31m ... \\x1b[m):\n${JSON.stringify(expected)}\nGot:\n${JSON.stringify(actual)}`);
    if (/\x1b/.test(actual)) throw new TestFailure(`Output contains unexpected escape sequences: ${JSON.stringify(r.stdout)}`);
    if (expected) t.log.success('✓ Output is correctly highlighted');
  }
}

const num = () => String(randInt(1, 9));
const fruitLine = () => `${word()} ${word()}`;

export const stages = {
  async cq2(t) {
    const w = word();
    const other = words(20).find(x => !x.includes(w[0]) && !x.includes(w[1])) || 'qqq';
    await exitCases(t, [[w, w[0]], [w, w[1]], [other, w[0]]]);
  },
  async oq2(t) {
    await exitCases(t, [[`${word()}${num()}${num()}`, '\\d'], [word(), '\\d'], [`${num()}${word()}`, '\\d']]);
  },
  async mr9(t) {
    await exitCases(t, [[`${word()}_${num()}`, '\\w'], [pick(['$!?', '=#%', '*-+']), '\\w'], [`%${word().toUpperCase()}`, '\\w']]);
  },
  async tl6(t) {
    const w = word();
    await exitCases(t, [[w, `[${w[1]}xyz]`], ['qqq', '[abc]'], [`${word()}`, `[${shuffle(['x', 'y', 'z', w[0]]).join('')}]`]]);
  },
  async rk3(t) {
    await exitCases(t, [['apple', '[^xyz]'], ['banana', '[^anb]'], ['orange', '[^opq]'], ['cab', '[^abc]']]);
  },
  async sh9(t) {
    const n = num(), w = word();
    await exitCases(t, [[`sally has ${n} ${w}`, `\\d ${w}`], [`sally has ${n} ${w}`, `\\d \\d ${w}`], [`sally has 12 ${w}s`, '\\d\\d \\w\\w\\w'], [`sally has 1 dog`, '\\d \\w\\w\\ws']]);
  },
  async rr8(t) {
    const w = word();
    await exitCases(t, [[`${w}_suffix`, `^${w}`], [`prefix_${w}`, `^${w}`], [`${w}`, `^${w.slice(0, 3)}`]]);
  },
  async ao7(t) {
    const w = word();
    await exitCases(t, [[`prefix_${w}`, `${w}$`], [`${w}_suffix`, `${w}$`], [w, `^${w}$`], [`${w}${w}`, `^${w}$`]]);
  },
  async fz7(t) {
    await exitCases(t, [['cat', 'ca+t'], ['caaats', 'ca+at'], ['act', 'ca+t'], ['ca', 'ca+t'], [`${num()}${num()}${num()} apples`, '^\\d+ apples$']]);
  },
  async ny8(t) {
    await exitCases(t, [['cat', 'ca?t'], ['act', 'ca?t'], ['dog', 'dogs?'], ['dogs', 'dogs?'], ['cag', 'ca?t'], ['dos', 'dogs?']]);
  },
  async zb3(t) {
    await exitCases(t, [['dog', 'd.g'], ['cog', 'd.g'], ['ding', 'd.g'], ['goøö0Ogol', 'g.+gol'], ['gol', 'g.+gol']]);
  },
  async zm7(t) {
    const [a, b] = words(2);
    const c = words(10).find(x => x !== a && x !== b);
    await exitCases(t, [[a, `(${a}|${b})`], [b, `(${a}|${b})`], [c, `(${a}|${b})`], [`a ${b} and ${c}`, `^a (${a}|${b}) and ${c}$`]]);
  },

  async ku5(t) {
    const w = word();
    await printCases(t, [[w, `${w.slice(1)}$`], [w, `^x${w}`]]);
  },
  async pz6(t) {
    const lines = [`${word()}_line`, `${num()}nd_${word()}`, `${num()}rd_${word()}`, `last_${word()}`];
    await printCases(t, [[lines.join('\n'), '\\d'], [lines.join('\n'), 'zzz\\d'], [lines.join('\n'), '^last']]);
  },

  async cj0(t) {
    const n = num();
    await onlyCases(t, [[`The king had ${n} ${word()}s`, '\\d'], [`no digits in ${word()}`, '\\d']]);
  },
  async ss2(t) {
    const [a, b] = words(2);
    await onlyCases(t, [[`${a} and ${b}`, `(${a}|${b})`], [`${num()}${num()} and ${num()}`, '\\d'], [`${word()} only`, '(zzz|qqq)']]);
  },
  async bo4(t) {
    const [a, b, c] = words(3);
    await onlyCases(t, [[`${a} and ${b}\n${word()} ${c}`, `(${a}|${b}|${c})`], [`line ${num()}\nline ${num()}${num()}`, '\\d+'], [`${word()}\n${word()}`, '\\d']]);
  },

  async bm2(t) {
    await colorCases(t, [[`I have ${num()} ${word()}s`, '\\d'], [`I have no ${word()}s`, '\\d']]);
  },
  async eq0(t) {
    const [a, b] = words(2);
    await colorCases(t, [[`${a} and ${b}`, `(${a}|${b})`], [`${num()}${num()}${num()}${num()}`, '\\d'], [`${word()} ${word()}`, '\\d']]);
  },
  async wg2(t) {
    const [a, b] = words(2);
    await colorCases(t, [[`${a} in the wild\n${b} in the sky\nnothing here`, `(${a}|${b})`], [`Now: 2025\nNext: 2026\nnever`, '\\d\\d\\d\\d']]);
  },
  async jk4(t) {
    for (const [input, pattern] of [[`I have ${num()} ${word()}s`, '\\d'], [`no digits`, '\\d']]) {
      const hit = matches(pattern, input);
      const r = await grep(t, { input, args: ['--color=never', '-E', pattern] });
      expectExit(t, r, hit ? 0 : 1);
      expectStdout(t, r, hit ? `${input}\n` : '');
      if (/\x1b/.test(r.stdout)) throw new TestFailure('Output must not contain ANSI escape sequences');
    }
  },
  async na5(t) {
    // Piped: --color=auto must not color.
    for (const [input, pattern] of [[`He has ${num()} rabbits`, '\\d'], ['no match here', '\\d']]) {
      const hit = matches(pattern, input);
      const r = await grep(t, { input, args: ['--color=auto', '-E', pattern] });
      expectExit(t, r, hit ? 0 : 1);
      expectStdout(t, r, hit ? `${input}\n` : '');
    }
    // TTY: --color=auto must color.
    const input = `I have ${num()} cats`;
    const inputFile = join(await t.tmpDir(), 'input.txt');
    await writeFile(inputFile, input);
    const command = ptyCommand([...t.programCommand, '--color=auto', '-E', 'cats'], { stdinFile: inputFile });
    if (!command) {
      t.log.info('Skipping the TTY part of this test: pseudo-terminals are not available on this platform (use WSL to run it).');
      return;
    }
    t.log.info(`$ echo -n ${shellQuote(input)} | ./your_program.sh --color=auto -E 'cats'   # stdout is a terminal`);
    const proc = new Proc(command, [], { cwd: t.project.dir, env: t.programEnv, logger: t.log });
    proc.closeStdin();
    const code = await proc.waitForExit(10000);
    if (code === null) { await proc.kill(); throw new TestFailure('Program did not exit'); }
    expectExit(t, { exitCode: code }, 0);
    const actual = normalizeColor(proc.stdout).replace(/\n$/, '');
    if (actual !== highlighted(input, 'cats').replace(/\n$/, '')) throw new TestFailure(`Expected highlighted output when stdout is a terminal, got ${JSON.stringify(proc.stdout)}`);
    t.log.success('✓ Output is highlighted when stdout is a terminal');
  },

  async dr5(t) {
    t.cwd = await t.tmpDir();
    const w = word();
    await writeFile(join(t.cwd, 'fruits.txt'), `${w}\n`);
    let r = await grep(t, { args: ['-E', `${w.slice(0, 3)}.*`, 'fruits.txt'] });
    expectExit(t, r, 0); expectStdout(t, r, `${w}\n`);
    r = await grep(t, { args: ['-E', 'carrot', 'fruits.txt'] });
    expectExit(t, r, 1); expectStdout(t, r, '');
  },
  async ol9(t) {
    t.cwd = await t.tmpDir();
    const lines = [...words(3), 'blackberry', 'blueberry'];
    await writeFile(join(t.cwd, 'fruits.txt'), shuffle(lines).join('\n') + '\n');
    const all = (await import('node:fs')).readFileSync(join(t.cwd, 'fruits.txt'), 'utf8').trimEnd().split('\n');
    let r = await grep(t, { args: ['-E', '.*berry', 'fruits.txt'] });
    expectExit(t, r, 0); expectStdout(t, r, all.filter(l => /berry/.test(l)).map(l => `${l}\n`).join(''));
    r = await grep(t, { args: ['-E', 'carrot', 'fruits.txt'] });
    expectExit(t, r, 1); expectStdout(t, r, '');
  },
  async is6(t) {
    t.cwd = await t.tmpDir();
    const files = { 'fruits.txt': ['banana', 'blueberry', 'apple'], 'vegetables.txt': ['broccoli', 'carrot', 'beet'] };
    for (const [f, l] of Object.entries(files)) await writeFile(join(t.cwd, f), l.join('\n') + '\n');
    const expected = Object.entries(files).flatMap(([f, l]) => l.filter(x => /^b/.test(x)).map(x => `${f}:${x}\n`)).join('');
    let r = await grep(t, { args: ['-E', '^b', 'fruits.txt', 'vegetables.txt'] });
    expectExit(t, r, 0); expectStdout(t, r, expected);
    r = await grep(t, { args: ['-E', 'missing_fruit', 'fruits.txt', 'vegetables.txt'] });
    expectExit(t, r, 1); expectStdout(t, r, '');
  },
  async yx6(t) {
    t.cwd = await t.tmpDir();
    await mkdir(join(t.cwd, 'dir', 'subdir'), { recursive: true });
    const files = { 'dir/fruits.txt': ['pear', 'strawberry'], 'dir/subdir/vegetables.txt': ['celery', 'carrot'], 'dir/vegetables.txt': ['cucumber', 'corn'] };
    for (const [f, l] of Object.entries(files)) await writeFile(join(t.cwd, f), l.join('\n') + '\n');
    for (const pattern of ['.*er', '.*ar']) {
      const expected = Object.entries(files).flatMap(([f, l]) => l.filter(x => matches(pattern, x)).map(x => `${f}:${x}`)).sort();
      const r = await grep(t, { args: ['-r', '-E', pattern, 'dir/'] });
      expectExit(t, r, 0);
      const actual = r.stdout.replace(/\r\n/g, '\n').trimEnd().split('\n').map(l => l.replace(/\\/g, '/').replace(/^dir\/\//, 'dir/')).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TestFailure(`Expected lines (any order):\n${expected.join('\n')}\nGot:\n${actual.join('\n')}`);
      t.log.success('✓ Stdout is correct');
    }
    const r = await grep(t, { args: ['-r', '-E', 'missing_fruit', 'dir/'] });
    expectExit(t, r, 1); expectStdout(t, r, '');
  },

  async ai9(t) {
    await exitCases(t, [['ct', 'ca*t'], ['caaat', 'ca*t'], ['dog', 'ca*t'], ['kt', 'ca*t'], ['apple', 'apple*'], ['appl', 'apple*$']]);
  },
  async wy9(t) {
    await exitCases(t, [['caat', 'ca{2}t'], ['cat', 'ca{2}t'], ['caaat', 'ca{2}t'], [`${num()}${num()}${num()}`, '^\\d{3}$'], [`${num()}${num()}`, '^\\d{3}$']]);
  },
  async hk3(t) {
    await exitCases(t, [['caat', 'ca{2,}t'], ['caaaaat', 'ca{2,}t'], ['cat', 'ca{2,}t'], ['x', '^x{1,}$']]);
  },
  async ug0(t) {
    await exitCases(t, [['caat', 'ca{2,4}t'], ['caaaat', 'ca{2,4}t'], ['cat', 'ca{2,4}t'], ['caaaaat', 'ca{2,4}t'], [`${num()}${num()}`, '^\\d{1,3}$']]);
  },

  async sb5(t) {
    const [a, b] = words(2);
    await exitCases(t, [[`${a} and ${a}`, `(${a}) and \\1`], [`${a} and ${b}`, `(${a}) and \\1`], [`${a}-${a}`, '^(\\w+)-\\1$'], [`${a}-${b}`, '^(\\w+)-\\1$']]);
  },
  async tg1(t) {
    const [a, b] = words(2);
    const n = randInt(2, 99);
    await exitCases(t, [
      [`${n} red ${a}s and ${n} red ${b}s`, `(\\d+) (\\w+) ${a}s and \\1 \\2 ${b}s`],
      [`${n} red ${a}s and ${n + 1} red ${b}s`, `(\\d+) (\\w+) ${a}s and \\1 \\2 ${b}s`],
      [`${a}-${b}_${b}-${a}`, '^(\\w+)-(\\w+)_\\2-\\1$'],
      [`${a}-${b}_${a}-${b}`, '^(\\w+)-(\\w+)_\\2-\\1$'],
    ]);
  },
  async xe5(t) {
    const [a, b] = words(2);
    await exitCases(t, [
      [`'${a} and ${a}' is the same as '${a} and ${a}'`, `('(${a}) and \\2') is the same as \\1`],
      [`'${a} and ${b}' is the same as '${a} and ${b}'`, `('(${a}) and \\2') is the same as \\1`],
      [`grep 101 is doing grep 101 times`, '((\\w\\w\\w\\w) (\\d\\d\\d)) is doing \\2 \\3 times'],
      [`abc-def is abc-def, not efg`, '(([abc]+)-([def]+)) is \\1, not ([^xyz]+)'],
    ]);
  },
};

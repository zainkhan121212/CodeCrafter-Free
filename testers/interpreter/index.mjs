// Interpreter (Lox) tester: writes test.lox, runs `your_program.sh <tokenize|parse|evaluate|run> test.lox` and compares
// stdout, stderr and the exit code with a reference Lox implementation (lib/protocols/lox.mjs, jlox-compatible).
// Each stage runs randomized programs plus the example programs from the stage description.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { getCourse } from '../../lib/content.mjs';
import { runLox } from '../../lib/protocols/lox.mjs';
import { word, words, randInt, shuffle, pick } from '../../lib/harness/random.mjs';

// Stages whose descriptions say only the exit code (not the message) is checked.
const EXIT_CODE_ONLY = new Set(['wz8', 'gj9', 'yu6', 'cq1', 'ib5']);

const show = s => s.replace(/\t/g, '<|TAB|>').replace(/ (?=\n|$)/g, '<|SPACE|>');

async function check(t, mode, source) {
  const dir = await t.tmpDir('ccfree-lox-');
  await writeFile(join(dir, 'test.lox'), source);
  t.log.info(`Writing contents to ./test.lox:`);
  for (const line of show(source).split('\n')) t.log.info(`  ${line}`);
  t.log.info(`$ ./your_program.sh ${mode} test.lox`);
  const expected = runLox(mode, source);
  const r = await t.exec([mode, 'test.lox'], { cwd: dir, timeout: 10000 });
  if (r.exitCode !== expected.code) throw new TestFailure(`Expected exit code ${expected.code}, got ${r.exitCode}${expected.stderr ? `\nExpected stderr:\n${expected.stderr}` : ''}`);
  const out = r.stdout.replace(/\r\n/g, '\n');
  if (out !== expected.stdout) {
    const e = expected.stdout.split('\n'), a = out.split('\n');
    const i = e.findIndex((l, k) => l !== a[k]);
    throw new TestFailure(`Output differs at line ${i + 1}: expected ${JSON.stringify(e[i] ?? '(end of output)')}, got ${JSON.stringify(a[i] ?? '(end of output)')}\nExpected stdout:\n${expected.stdout || '(empty)\n'}Got:\n${out || '(empty)\n'}`);
  }
  if (expected.stderr && !EXIT_CODE_ONLY.has(t.stage.slug)) {
    const actual = r.stderr.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
    for (const line of expected.stderr.trim().split('\n')) {
      if (!actual.includes(line.trim())) throw new TestFailure(`Expected stderr to contain ${JSON.stringify(line)}\nGot stderr:\n${r.stderr || '(empty)'}`);
    }
  }
  t.log.success(`✓ ${expected.code ? `Exit code ${expected.code} and errors` : 'Output'} as expected`);
}

// Example programs from the stage description, as additional fixed cases.
function examples(slug) {
  const stage = getCourse('interpreter').stages.find(s => s.slug === slug);
  const blocks = [...stage.description.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(m => m[1]);
  const out = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const m = /^\$ \.\/your_program\.sh (tokenize|parse|evaluate|run) test\.lox\n/.exec(blocks[i + 1]);
    if (!m || blocks[i].startsWith('$') || blocks[i].includes('<token_type>')) continue;
    out.push([m[1], blocks[i].replace(/\{\{=<~ ~>=\}\}/g, '').replace(/<\|SPACE\|>/g, ' ').replace(/<\|TAB\|>/g, '\t').replace(/\n$/, '')]);
  }
  return out;
}

const stage = (mode, gen, count = 3) => async t => {
  const cases = [...examples(t.stage.slug).filter(([m]) => m === mode).map(([, src]) => src)];
  for (let i = 0; i < count; i++) cases.push(gen());
  for (const src of cases) await check(t, mode, src);
};

// ---------- random program pieces ----------
const id = () => `${word()}${pick(['', '_', ''])}${pick(['', String(randInt(1, 9))])}`;
const ids = n => { const s = new Set(); while (s.size < n) s.add(id()); return [...s]; };
const int = (lo = 1, hi = 99) => randInt(lo, hi);
const dec = () => `${randInt(1, 99)}.${randInt(1, 99)}`;
const str = () => `"${words(randInt(1, 2)).join(' ')}"`;
const lit = () => pick([String(int()), dec(), str(), 'true', 'false', 'nil']);
const joinTokens = list => shuffle(list).join(pick(['', ' ']));
const lines = (...l) => l.join('\n');

// ---------- scanning ----------
const scanning = {
  ry8: stage('tokenize', () => '', 1),
  ol4: stage('tokenize', () => Array.from({ length: randInt(2, 6) }, () => pick(['(', ')'])).join('')),
  oe8: stage('tokenize', () => Array.from({ length: randInt(3, 8) }, () => pick(['(', ')', '{', '}'])).join('')),
  xc5: stage('tokenize', () => joinTokens(['(', '{', '*', '.', ',', '+', '-', ';', '}', ')'].slice(0, randInt(5, 10)))),
  ea6: stage('tokenize', () => joinTokens(['(', ',', '.', pick(['$', '#', '@', '%']), pick(['$', '#', '@', '%']), ')', '+'])),
  mp7: stage('tokenize', () => joinTokens(['=', '==', '{', '}', '(', ')', '=', '=='].slice(0, randInt(4, 8))).replace(/===/g, '= ==')),
  bu3: stage('tokenize', () => joinTokens(['!', '!=', '=', '==', '!', '(', ')']).replace(/!==/g, '!= =')),
  et2: stage('tokenize', () => joinTokens(['<', '>', '<=', '>=', '(', ')', '=']).replace(/[<>]==/g, m => `${m[0]}= =`)),
  ml2: stage('tokenize', () => lines(`${joinTokens(['(', ')', '/', '+'])}// ${word()} ${word()}`, `/${pick(['(', '{', '+'])}`)),
  er2: stage('tokenize', () => `(${pick([' ', '\t', '\n'])}${pick([' ', '\t'])}\n${pick(['{', '+', '.'])}\t)`),
  tz7: stage('tokenize', () => lines(`${pick(['#', '@', '$'])} (`, `)\t${pick(['#', '@', '%'])}`, `${pick(['{', '}'])} ${pick(['$', '@'])}`)),
  ue7: stage('tokenize', () => (Math.random() < 0.3 ? `${str()} ${pick(['(', ','])} "unterminated` : `${str()} ${pick(['(', ','])} ${str()}`)),
  kj0: stage('tokenize', () => `${int()} ${dec()} ${int()}.${'0'.repeat(randInt(1, 4))} ${pick(['+', '*'])} ${int()}`),
  ey7: stage('tokenize', () => `${id()} ${id()} _${word()} ${word().toUpperCase()} ${pick(['=', '(', '+'])} ${int()}`),
  pq5: stage('tokenize', () => shuffle(['and', 'class', 'else', 'false', 'for', 'fun', 'if', 'nil', 'or', 'print', 'return', 'super', 'this', 'true', 'var', 'while', 'AND', 'Class', 'printer']).slice(0, 7).join(' ')),
};

// ---------- parsing ----------
const parsing = {
  sc2: stage('parse', () => pick(['true', 'false', 'nil'])),
  ra8: stage('parse', () => pick([String(int()), dec(), `${int()}.${'0'.repeat(randInt(1, 3))}`])),
  th5: stage('parse', () => str()),
  xe6: stage('parse', () => pick([`(${lit()})`, `((${lit()}))`, `(${pick(['true', 'false'])})`])),
  mq1: stage('parse', () => pick([`!${pick(['true', 'false'])}`, `-${int()}`, `!!${pick(['true', 'false'])}`, `(!!(${pick(['true', 'false'])}))`, `-(-${int()})`])),
  wa9: stage('parse', () => `${int()} * ${int()} / ${int()}${pick(['', ` * ${int()}`])}`),
  yf2: stage('parse', () => pick([`${int()} + ${int()} - ${int()}`, `"${word()}" + "${word()}"`, `(-${int()} + ${int()}) * (${int()} * ${int()}) / (${int()} + ${int()})`])),
  uh4: stage('parse', () => pick([`${int()} < ${int()} < ${int()}`, `${int()} <= ${int()}`, `${int()} > ${int()}`, `(${int()} - ${int()}) >= -(${int()} / ${int()} + ${int()})`])),
  ht8: stage('parse', () => pick([`"${word()}" == "${word()}"`, `${int()} != ${int()}`, `(${int()} != ${int()}) == ((-${int()} + ${int()}) >= (${int()} * ${int()}))`])),
  wz8: stage('parse', () => pick([`(${int()} +)`, `"${word()}`, `(${int()} + ${int()}`, `${int()} + + ${int()}`, `(${pick(['true', 'false'])}`])),
};

// ---------- evaluating ----------
const arith = () => pick([`${int()} * ${int()} / ${int()}`, `(${int()} * ${int()} / (${int()} * ${int()}))`, `(${dec()} * 2) / 2`, `${int()} / ${int()}`]);
const evaluating = {
  iz6: stage('evaluate', () => pick(['true', 'false', 'nil'])),
  lv1: stage('evaluate', () => pick([str(), String(int()), dec(), `${int()}.${'0'.repeat(randInt(1, 3))}`])),
  oq9: stage('evaluate', () => pick([`(${str()})`, `((${pick(['true', 'false'])}))`, `(${dec()})`, `(nil)`])),
  dc1: stage('evaluate', () => pick([`-${int()}`, `!${pick(['true', 'false', 'nil'])}`, `!${dec()}`, `!((${pick(['false', 'true'])}))`, `-(-${int()})`, `!"${word()}"`])),
  bp3: stage('evaluate', arith),
  jy2: stage('evaluate', () => pick([`${int()} - ${int()}`, `${dec()} - ${int()}`, `${int()} + ${int()} - (-(${int()} - ${int()}))`, `-(${int()} + ${int()})`])),
  jx8: stage('evaluate', () => pick([`"${word()}" + "${word()}"`, `"${int()}" + "${int()}"`, `("${word()}" + " ") + "${word()}"`])),
  et4: stage('evaluate', () => pick([`${int()} > -${int()}`, `${int()} >= ${int()}`, `${int()} < ${int()}`, `(${int()} - ${int()}) >= -(${int()} / ${int()} + ${int()})`])),
  hw7: stage('evaluate', () => pick([`"${word()}" == "${word()}"`, `"${word()}" != "${word()}"`, `${int()} == ${int()}`, `${int()} == "${int()}"`, `nil == nil`, `(${int()} != ${int()}) == true`])),
  gj9: stage('evaluate', () => pick([`-"${word()}"`, '-true', `-("${word()}" + "${word()}")`, '-false', '-nil'])),
  yu6: stage('evaluate', () => pick([`"${word()}" * ${int()}`, `true / ${int()}`, `("${word()}" * "${word()}")`, 'false / true', `${int()} * nil`])),
  cq1: stage('evaluate', () => pick([`"${word()}" + true`, `${int()} - true`, 'true + false', `"${word()}" - "${word()}"`, `${int()} + "${word()}"`])),
  ib5: stage('evaluate', () => pick([`"${word()}" < false`, `true < ${int()}`, `("${word()}" + "${word()}") < ${int()}`, 'false > true', `${int()} >= "${word()}"`])),
};

// ---------- statements & state ----------
const statements = {
  xy1: stage('run', () => pick([`print ${str()};`, `print ${int()};`, `print ${pick(['true', 'false', 'nil'])};`, `print ${int()} + ${int()};`, `print (${int()} * ${int()}) - ${int()};`])),
  oe4: stage('run', () => lines(`print ${str()};`, `print ${int()} + ${int()};`, `print "${word()}" + "${word()}";`, `print ${pick(['true', 'false'])} != ${pick(['true', 'false'])};`)),
  fi3: stage('run', () => lines(`${int()} - ${int()};`, `"${word()}" + "${word()}";`, `print ${pick(['true', 'false'])};`, `(${int()} + ${int()}) * ${int()};`, `print "${word()}" == "${word()}";`)),
  yg2: stage('run', () => { const [a, b] = ids(2); return lines(`var ${a} = ${int()};`, `var ${b} = ${int()};`, `print ${a} + ${b};`, `var c = ${a} * ${b} - ${int()};`, 'print c;'); }),
  sv7: stage('run', () => { const [a, b, c] = ids(3); return pick([lines(`print ${a};`), lines(`var ${a} = ${int()};`, `print ${a};`, `var ${b} = ${c} + ${int()};`, `print ${b};`)]); }),
  bc1: stage('run', () => { const [a, b] = ids(2); return lines(`var ${a};`, `print ${a};`, `var ${b} = ${str()};`, `print ${b};`, `var c = ${a};`, 'print c;'); }),
  dw9: stage('run', () => { const [a] = ids(1); return lines(`var ${a} = "before";`, `print ${a};`, `var ${a} = "after";`, `print ${a};`, `var ${a};`, `print ${a};`); }),
  pl3: stage('run', () => { const [a, b, c] = ids(3); return lines(`var ${a};`, `var ${b};`, `${a} = ${b} = ${int()};`, `print ${a};`, `print ${b};`, `var ${c} = ${a} = ${int()};`, `print ${c} = ${a} + ${int()};`, `print ${a};`); }),
  vr5: stage('run', () => pick([
    lines('{', `  var ${id()} = ${str()};`, `  print ${str()};`, '}'),
    lines('{', `  var x = ${int()};`, '  {', '    print x;', '  }', '}'),
    lines('{', `  var x = ${int()};`, '  print x;'),
  ])),
  fb4: stage('run', () => { const [a, b] = ids(2); return lines(`var ${a} = "global ${a}";`, `var ${b} = "global ${b}";`, '{', `  var ${a} = "outer ${a}";`, '  {', `    var ${a} = "inner ${a}";`, `    print ${a};`, `    print ${b};`, '  }', `  print ${a};`, '}', `print ${a};`); }),
};

// ---------- control flow ----------
const controlFlow = {
  ne3: stage('run', () => { const a = id(); return lines(`var ${a} = ${int()};`, `if (${a} > ${int()}) print "big";`, `if (${pick(['true', 'false', 'nil'])}) { print "block"; }`, `if (${a} = ${int()}) print ${a};`); }),
  st5: stage('run', () => { const a = int(); return lines(`if (${a} > ${int()}) print "yes"; else print "no";`, `if (${pick(['false', 'nil', '"x"'])}) { print "a"; } else { print "b"; }`); }),
  fh8: stage('run', () => { const a = int(1, 30); return lines(`var n = ${a};`, 'if (n > 20) print "large";', 'else if (n > 10) print "medium";', 'else print "small";'); }),
  xj4: stage('run', () => lines(`var a = ${int()};`, `var b = ${int()};`, 'if (a > 50) {', '  if (b > 50) print "both"; else print "only a";', '} else {', '  if (b > 50) print "only b"; else print "neither";', '}', 'if (true) if (false) print "x"; else print "dangling else binds to the nearest if";')),
  wk8: stage('run', () => lines(`print ${pick(['nil', 'false'])} or "${word()}";`, `print ${int()} or false;`, `print false or false;`, `var a = "${word()}";`, 'var b = nil;', 'print b or a;', `if (b or ${pick(['true', 'false'])}) print "taken";`)),
  jx4: stage('run', () => lines(`print ${pick(['nil', 'false'])} and "${word()}";`, `print ${int()} and "${word()}";`, 'print true and true and false;', `var a = ${int()};`, `if (a > 10 and a < ${int(40, 90)}) print "in range"; else print "out of range";`)),
  qy3: stage('run', () => { const n = int(3, 6); return lines('var i = 0;', `while (i < ${n}) {`, '  print i;', '  i = i + 1;', '}', `var total = 0; var k = 1; while (k <= ${n}) { total = total + k; k = k + 1; } print total;`); }),
  bw6: stage('run', () => { const n = int(3, 6); return lines(`for (var i = 0; i < ${n}; i = i + 1) print i;`, 'var a = 0;', 'for (; a < 2; a = a + 1) { print "a" + "!"; }', `for (var b = ${n}; b > 0;) { print b; b = b - 2; }`); }),
  vt1: stage('run', () => pick([`if (true) { print "x"; } else`, `for (var i = 0; i < 3) print i;`, `while (true print "x";`, `var ${id()} = ;`, `print "${word()}"`, `if true) print "x";`, `for (var a = 1; {}) {}`])),
};

// ---------- functions ----------
const functions = {
  av4: stage('run', () => lines('var start = clock();', 'print start > 0;', `print clock() >= start;`, 'print clock;'), 2),
  pg8: stage('run', () => { const f = id(); return lines(`fun ${f}() { print "${word()}"; }`, `${f}();`, `${f}();`, `print ${f};`); }),
  lb6: stage('run', () => { const f = id(); return lines(`fun ${f}(a, b, c) { print a + b + c; }`, `${f}(${int()}, ${int()}, ${int()});`, `fun greet(name) { print "Hello, " + name + "!"; }`, `greet("${word()}");`); }),
  px4: stage('run', () => pick([`fun ${id()}( { print 1; }`, `fun (a) { print a; }`, `fun f(a, ) {}`, `fun f() print 1;`, `clock(;`, `fun f(a b) {}`])),
  rd2: stage('run', () => { const f = id(); return lines(`fun ${f}(n) {`, '  if (n < 2) return n;', `  return ${f}(n - 1) + ${f}(n - 2);`, '}', `print ${f}(${int(5, 12)});`, 'fun early() { return; print "unreachable"; }', 'print early();', 'fun none() {}', 'print none();'); }),
  ey3: stage('run', () => lines(`fun add(a, b) { return a + b; }`, 'fun twice(f, x) { return f(f(x, x), x); }', `print twice(add, ${int()});`, 'fun pick(n) { if (n > 0) return add; return twice; }', `print pick(${pick([1, -1])});`, 'var alias = add;', `print alias(${int()}, ${int()});`)),
  fj7: stage('run', () => pick([
    lines(`fun f(a, b) { return a + b; }`, `print f(${int()});`),
    lines(`var x = "${word()}";`, 'x();'),
    lines(`fun f() { return ${int()}; }`, `print f() + "${word()}";`),
    lines('fun f(a) {}', `f(1, 2, 3);`),
  ])),
  bz4: stage('run', () => lines(`var a = "global";`, 'fun show() { print a; }', 'show();', '{', `  var a = "block";`, '  show();', '}', `fun shadow(a) { print a; { var a = "inner"; print a; } print a; }`, `shadow("param");`)),
  gg6: stage('run', () => { const n = int(2, 5); return lines('fun makeCounter() {', '  var i = 0;', '  fun count() {', '    i = i + 1;', '    return i;', '  }', '  return count;', '}', 'var c1 = makeCounter();', 'var c2 = makeCounter();', ...Array.from({ length: n }, () => 'print c1();'), 'print c2();', 'fun adder(x) { fun add(y) { return x + y; } return add; }', `print adder(${int()})(${int()});`); }),
};

// ---------- resolving & binding ----------
const resolving = {
  de8: stage('run', () => lines(`var a = "global";`, '{', '  fun showA() { print a; }', '  showA();', `  var a = "block";`, '  showA();', '  print a;', '}')),
  pt7: stage('run', () => pick([lines('{', `  var a = "outer";`, '  {', '    var a = a;', '  }', '}'), lines('fun f() {', '  var b = b + 1;', '}'), lines(`var a = "global ok";`, 'var a = a;', 'print a;')])),
  pz7: stage('run', () => pick([lines('{', `  var a = ${int()};`, `  var a = ${int()};`, '}'), lines('fun f(a) {', '  var a = "x";', '}'), lines(`var a = 1;`, `var a = 2;`, 'print a;'), lines('fun f(a, a) {}')])),
  eh3: stage('run', () => pick([lines(`return "${word()}";`), lines('fun f() { return "ok"; }', 'print f();', 'return;'), lines('{', '  return 1;', '}')])),
};

// ---------- classes ----------
const classes = {
  vf4: stage('run', () => { const C = id(); return lines(`class ${C} {}`, `print ${C};`, `class Spaceship { fly() { print "flying"; } }`, 'print Spaceship;'); }),
  yk8: stage('run', () => { const C = id(); return lines(`class ${C} {}`, `var obj = ${C}();`, 'print obj;', `print ${C}();`); }),
  yf3: stage('run', () => { const [C, f, g] = ids(3); return lines(`class ${C} {}`, `var o = ${C}();`, `o.${f} = ${int()};`, `o.${g} = "${word()}";`, `print o.${f};`, `print o.${g};`, `o.${f} = o.${f} + ${int()};`, `print o.${f};`, pick([`print o.missing;`, `print ${int()}.${f};`, `"str".${f} = 1;`, `print "done";`])); }),
  qr2: stage('run', () => { const C = id(); return lines(`class ${C} {`, `  speak() { print "${word()}"; }`, '  add(a, b) { return a + b; }', '}', `var o = ${C}();`, 'o.speak();', `print o.add(${int()}, ${int()});`, 'var m = o.speak;', 'm();', 'print m;'); }),
  yd7: stage('run', () => { const C = id(); return lines(`class ${C} {`, '  setName(n) { this.name = n; return this; }', '  greet() { print "Hi " + this.name; }', '  getGreeter() { fun g() { print this.name; } return g; }', '}', `var o = ${C}();`, `o.setName("${word()}").greet();`, 'o.getGreeter()();'); }),
  dg2: stage('run', () => pick([lines('print this;'), lines('fun notMethod() { print this; }'), lines(`class C { m() { return this; } }`, 'fun f() { return this; }')])),
  ou5: stage('run', () => { const C = id(); return lines(`class ${C} {`, '  init(a, b) { this.a = a; this.b = b; }', '  sum() { return this.a + this.b; }', '}', `var o = ${C}(${int()}, ${int()});`, 'print o.sum();', 'print o.init(1, 2);', `class Empty { init() { print "made"; } }`, 'Empty();', pick(['print "ok";', `${C}(1);`])); }),
  eb9: stage('run', () => pick([
    lines('class C {', '  init(x) {', '    if (x < 0) return;', '    this.x = x;', '  }', '}', `var c = C(${int()});`, 'print c.x;', 'print C(-1);'),
    lines('class C {', '  init() {', `    return "${word()}";`, '  }', '}'),
  ])),
};

// ---------- inheritance ----------
const inheritance = {
  mf6: stage('run', () => { const [A, B] = ids(2); return lines(`class ${A} {}`, `class ${B} < ${A} {}`, `print ${A};`, `print ${B};`, `print ${B}();`); }),
  ky1: stage('run', () => { const [A, B] = ids(2); return lines(`class ${A} {`, `  hello() { print "hello from ${A}"; }`, '}', `class ${B} < ${A} {}`, `${B}().hello();`, `class Third < ${B} {}`, 'Third().hello();'); }),
  ka5: stage('run', () => { const [A, B] = ids(2); return lines(`class ${A} {`, `  speak() { print "${A} speaks"; }`, '  name() { return "base"; }', '}', `class ${B} < ${A} {`, `  speak() { print "${B} speaks"; }`, '}', `${A}().speak();`, `${B}().speak();`, `print ${B}().name();`); }),
  ab0: stage('run', () => pick([lines('class A < A {}'), lines(`var notClass = "${word()}";`, 'class B < notClass {}'), lines('fun f() {}', 'class C < f {}'), lines('var n = nil;', 'class D < n {}')])),
  qi0: stage('run', () => { const [A, B] = ids(2); return lines(`class ${A} {`, '  method() { print "A method"; }', '  init(x) { this.x = x; }', '}', `class ${B} < ${A} {`, '  method() {', '    print "B method";', '    super.method();', '  }', '  init(x) { super.init(x * 2); }', '  test() { var m = super.method; m(); }', '}', `var b = ${B}(${int()});`, 'b.method();', 'print b.x;', 'b.test();'); }),
  ib9: stage('run', () => pick([lines('print super.method;'), lines('class A { m() { super.m(); } }'), lines('fun f() { super.x(); }'), lines('class A {}', 'class B < A { m() { super.missing(); } }', 'B().m();')])),
};

export const stages = { ...scanning, ...parsing, ...evaluating, ...statements, ...controlFlow, ...functions, ...resolving, ...classes, ...inheritance };

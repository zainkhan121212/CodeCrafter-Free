// SQLite tester: generates random database files with the real SQLite engine (node:sqlite), runs the learner's
// program against them and compares the output with what SQLite itself returns.
import { join } from 'node:path';
import { existsSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { home } from '../../lib/store.mjs';
import { word, words, randInt, pick, shuffle } from '../../lib/harness/random.mjs';

function sqlite() {
  const mod = process.getBuiltinModule?.('node:sqlite');
  if (!mod) throw new TestFailure(`The SQLite tester needs Node.js 22.13 or newer (you have ${process.version}).`);
  return mod;
}

const cap = s => s[0].toUpperCase() + s.slice(1);
const COLORS = ['Red', 'Yellow', 'Light Green', 'Dark Red', 'Blush Red', 'Orange', 'Purple', 'Pink', 'Brown', 'Green'];
const EXTRA_COLUMNS = ['description', 'origin', 'flavor', 'season', 'texture', 'shape'];

// Creates a database with `tableCount` small tables (each fits in its root page). Returns the schema description.
function makeSmallDb(path, { pageSize = pick([1024, 2048, 4096, 8192]), tableCount = randInt(2, 5) } = {}) {
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA page_size=${pageSize}`);
  const tables = [];
  for (const name of words(tableCount)) {
    const extra = shuffle(EXTRA_COLUMNS).slice(0, randInt(1, 3));
    const columns = ['name', 'color', ...extra];
    db.exec(`CREATE TABLE ${name} (id integer primary key autoincrement, ${columns.map(c => `${c} text`).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${name} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
    const n = randInt(3, 8);
    for (let i = 0; i < n; i++) insert.run(...columns.map(c => (c === 'name' ? `${cap(word())} ${cap(word())}` : c === 'color' ? pick(COLORS) : word())));
    tables.push({ name, columns: ['id', ...columns], rows: n });
  }
  db.close();
  return { pageSize, tables };
}

function query(path, sql) {
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all().map(row => Object.values(row).map(v => (v === null ? '' : String(v))).join('|'));
  } finally {
    db.close();
  }
}

async function runSql(t, args, cwd, { timeout = 10000 } = {}) {
  t.log.info(`$ ./your_program.sh ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const started = Date.now();
  const r = await t.exec(args, { cwd, timeout });
  if (r.exitCode !== 0) throw new TestFailure(`Expected exit code 0, got ${r.exitCode}`);
  return { ...r, elapsed: Date.now() - started };
}

const lines = s => s.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l !== '');

function expectRows(t, stdout, expected) {
  const actual = lines(stdout);
  const a = [...actual].sort(), e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new TestFailure(`Expected ${e.length} row(s) (any order):\n${e.join('\n')}\nGot ${a.length} row(s):\n${a.join('\n')}`);
  }
  t.log.success(`✓ Got the expected ${e.length} row(s)`);
}

async function setup(t, opts) {
  const dir = await t.tmpDir('ccfree-sqlite-');
  const db = 'test.db';
  const schema = makeSmallDb(join(dir, db), opts);
  t.log.info(`Created test.db: page size ${schema.pageSize}, tables ${schema.tables.map(x => x.name).join(', ')}`);
  return { dir, db, path: join(dir, db), schema };
}

// --- large databases ---

const SUPERHERO_EYES = ['Blue Eyes', 'Brown Eyes', 'Green Eyes', 'Red Eyes', 'Black Eyes', 'Hazel Eyes', 'Pink Eyes', 'Violet Eyes', 'Grey Eyes', 'Gold Eyes'];

function makeSuperheroesDb(path) {
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA page_size=4096');
  db.exec('CREATE TABLE superheroes (id integer primary key autoincrement, name text not null, eye_color text, hair_color text, appearance_count integer, first_appearance text, first_appearance_year text)');
  const insert = db.prepare('INSERT INTO superheroes (name, eye_color, hair_color, appearance_count, first_appearance, first_appearance_year) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  const n = randInt(3000, 5000);
  for (let i = 0; i < n; i++) {
    // Rare eye colors get only a few rows, so queries have small, checkable results.
    const eye = Math.random() < 0.01 ? pick(SUPERHERO_EYES.slice(6)) : pick(SUPERHERO_EYES.slice(0, 6));
    insert.run(`${cap(word())} ${cap(word())} (${pick(['New Earth', 'Earth-616', 'Earth-Two'])})`, eye, `${pick(['Black', 'Blond', 'Red', 'White', 'No'])} Hair`, randInt(1, 3000), `${pick(['January', 'May', 'October'])}, ${randInt(1940, 2020)}`, String(randInt(1940, 2020)));
  }
  db.exec('COMMIT');
  db.close();
}

const COUNTRIES = ['united states', 'india', 'united kingdom', 'brazil', 'canada', 'france', 'germany', 'australia', 'netherlands', 'spain', 'italy', 'china', 'mexico'];
const RARE_COUNTRIES = ['eritrea', 'tuvalu', 'nauru', 'bhutan', 'micronesia', 'palau', 'san marino', 'liechtenstein', 'monaco', 'vanuatu', 'comoros', 'djibouti', 'kiribati', 'tonga', 'andorra', 'dominica'];

// A ~1 GB database (by default) with an index on country, generated once and cached in ~/.ccfree/cache.
function companiesDb(t) {
  const rows = Number(process.env.CCFREE_SQLITE_COMPANIES_ROWS || 6_000_000);
  const dir = join(home(), 'cache');
  const path = join(dir, `companies-v1-${rows}.db`);
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  t.log.info(`Generating the index test database (${rows.toLocaleString()} rows). This happens once and is cached in ${dir} ...`);
  const tmp = `${path}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(tmp);
  db.exec('PRAGMA page_size=4096; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
  db.exec('CREATE TABLE companies (id integer primary key autoincrement, name text, domain text, year_founded text, industry text, "size range" text, locality text, country text, current_employees text, total_employees text)');
  const insert = db.prepare('INSERT INTO companies (name, domain, year_founded, industry, "size range", locality, country, current_employees, total_employees) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  // Deterministic pseudo-random sequence so every machine builds the same database.
  let seed = 42;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const syll = ['ka', 'lo', 'mi', 'ne', 'ra', 'to', 'vi', 'zu', 'sa', 'po', 'del', 'tech', 'corp', 'soft', 'net', 'ica'];
  const name = () => `${syll[rnd(16)]}${syll[rnd(16)]}${syll[rnd(16)]} ${['solutions', 'group', 'ltd', 'inc', 'systems', 'labs'][rnd(6)]}`;
  db.exec('BEGIN');
  for (let i = 0; i < rows; i++) {
    const country = rnd(20000) === 0 ? RARE_COUNTRIES[rnd(RARE_COUNTRIES.length)] : COUNTRIES[rnd(COUNTRIES.length)];
    const n = name();
    insert.run(n, `${n.replace(/\s/g, '')}.com`, String(1950 + rnd(70)), ['information technology and services', 'marketing and advertising', 'construction', 'retail'][rnd(4)],
      ['1 - 10', '11 - 50', '51 - 200', '201 - 500'][rnd(4)], `city ${rnd(9000)}, region ${rnd(90)}, ${country}`, country, String(rnd(500)), String(rnd(1000)));
    if (i % 1_000_000 === 999_999) { db.exec('COMMIT'); db.exec('BEGIN'); }
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_companies_country on companies (country)');
  db.close();
  renameSync(tmp, path);
  return path;
}

export const stages = {
  async dr6(t) {
    const { dir, db, schema } = await setup(t);
    const { stdout } = await runSql(t, [db, '.dbinfo'], dir);
    const m = stdout.match(/database page size:\s*(\d+)/);
    if (!m) throw new TestFailure(`Expected output to contain "database page size: ${schema.pageSize}", got ${JSON.stringify(stdout)}`);
    t.assertEqual(Number(m[1]), schema.pageSize, 'database page size');
    t.log.success(`✓ database page size: ${schema.pageSize}`);
  },

  async ce0(t) {
    const { dir, db, path, schema } = await setup(t);
    const tableCount = query(path, "SELECT count(*) FROM sqlite_schema WHERE type = 'table'")[0];
    const { stdout } = await runSql(t, [db, '.dbinfo'], dir);
    const ps = stdout.match(/database page size:\s*(\d+)/);
    const nt = stdout.match(/number of tables:\s*(\d+)/);
    if (!ps || Number(ps[1]) !== schema.pageSize) throw new TestFailure(`Expected "database page size: ${schema.pageSize}" in output, got ${JSON.stringify(stdout)}`);
    if (!nt) throw new TestFailure(`Expected output to contain "number of tables: ${tableCount}", got ${JSON.stringify(stdout)}`);
    t.assertEqual(nt[1], tableCount, 'number of tables');
    t.log.success(`✓ number of tables: ${tableCount}`);
  },

  async sz4(t) {
    const { dir, db, path } = await setup(t);
    const expected = query(path, "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").sort();
    const { stdout } = await runSql(t, [db, '.tables'], dir);
    const actual = stdout.split(/\s+/).filter(Boolean).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TestFailure(`Expected table names ${JSON.stringify(expected.join(' '))} (any order), got ${JSON.stringify(stdout.trim())}`);
    t.log.success(`✓ Tables: ${expected.join(' ')}`);
  },

  async nd9(t) {
    const { dir, db, path, schema } = await setup(t);
    for (const table of shuffle(schema.tables).slice(0, 2)) {
      const sql = `SELECT COUNT(*) FROM ${table.name}`;
      const { stdout } = await runSql(t, [db, sql], dir);
      expectRows(t, stdout, query(path, sql));
    }
  },

  async az9(t) {
    const { dir, db, path, schema } = await setup(t);
    for (const table of shuffle(schema.tables).slice(0, 2)) {
      const sql = `SELECT ${pick(table.columns.slice(1))} FROM ${table.name}`;
      expectRows(t, (await runSql(t, [db, sql], dir)).stdout, query(path, sql));
    }
  },

  async vc9(t) {
    const { dir, db, path, schema } = await setup(t);
    for (const table of shuffle(schema.tables).slice(0, 2)) {
      const cols = shuffle(table.columns.slice(1)).slice(0, randInt(2, Math.min(3, table.columns.length - 1)));
      const sql = `SELECT ${cols.join(', ')} FROM ${table.name}`;
      expectRows(t, (await runSql(t, [db, sql], dir)).stdout, query(path, sql));
    }
  },

  async rf3(t) {
    const { dir, db, path, schema } = await setup(t);
    for (const table of shuffle(schema.tables).slice(0, 2)) {
      const colors = query(path, `SELECT color FROM ${table.name}`);
      const sql = `SELECT name, color FROM ${table.name} WHERE color = '${pick(colors)}'`;
      expectRows(t, (await runSql(t, [db, sql], dir)).stdout, query(path, sql));
    }
  },

  async ws9(t) {
    const dir = await t.tmpDir('ccfree-sqlite-');
    makeSuperheroesDb(join(dir, 'superheroes.db'));
    const pages = query(join(dir, 'superheroes.db'), 'PRAGMA page_count')[0];
    t.log.info(`Created superheroes.db (${pages} pages)`);
    for (const eye of shuffle(SUPERHERO_EYES.slice(6)).slice(0, 2)) {
      const sql = `SELECT id, name FROM superheroes WHERE eye_color = '${eye}'`;
      expectRows(t, (await runSql(t, ['superheroes.db', sql], dir)).stdout, query(join(dir, 'superheroes.db'), sql));
    }
  },

  async nz8(t) {
    const path = companiesDb(t);
    const dir = join(path, '..');
    const file = path.slice(dir.length + 1);
    for (const country of shuffle(RARE_COUNTRIES).slice(0, 3)) {
      const sql = `SELECT id, name FROM companies WHERE country = '${country}'`;
      const { stdout, elapsed } = await runSql(t, [file, sql], dir, { timeout: 15000 });
      expectRows(t, stdout, query(path, sql));
      if (elapsed > 3000) throw new TestFailure(`Query took ${(elapsed / 1000).toFixed(1)}s; expected under 3s. Use the idx_companies_country index instead of scanning the whole table.`);
      t.log.success(`✓ Finished in ${elapsed}ms`);
    }
  },
};

export const timeouts = { nz8: 10 * 60 * 1000, ws9: 60000 };

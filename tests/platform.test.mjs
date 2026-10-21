import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, listCourses, getCourse } from '../lib/content.mjs';
import { renderTemplate, orderedStages, currentStage } from '../lib/render.mjs';
import { parse, encodeCommand, diff, R } from '../lib/protocols/resp.mjs';
import { startServer } from '../server.mjs';

const cli = (args, opts = {}) => execFileSync(process.execPath, [join(root, 'bin', 'ccfree.mjs'), ...args], { encoding: 'utf8', ...opts });

test('catalog: 11 courses with stages, descriptions and starters', () => {
  const courses = listCourses();
  assert.equal(courses.length, 11);
  for (const c of courses) {
    assert.ok(c.stages.length > 0, c.slug);
    for (const s of c.stages) assert.ok(s.description.length > 20, `${c.slug}/${s.slug} description`);
    assert.ok(c.languages.includes('python') || c.languages.includes('javascript'), `${c.slug} has a common starter`);
  }
});

test('stage order: base first, then extensions; current stage skips completed ones', () => {
  const redis = getCourse('redis');
  const order = orderedStages(redis);
  assert.equal(order[0].slug, 'jm1');
  assert.ok(order.findIndex(s => s.extension) > order.findLastIndex(s => !s.extension));
  assert.equal(currentStage(redis, { jm1: 'x', rg2: 'x' }).slug, order[2].slug);
  assert.deepEqual(orderedStages(redis, ['streams']).filter(s => s.extension).map(s => s.extension), Array(redis.stages.filter(s => s.extension === 'streams').length).fill('streams'));
});

test('templates: language sections render only for the chosen language', () => {
  const text = 'A{{#lang_is_go}}GO{{/lang_is_go}}{{^lang_is_go}}OTHER{{/lang_is_go}}{{#reader_is_bot}}BOT{{/reader_is_bot}} {{language_name}}';
  assert.equal(renderTemplate(text, { language: 'go' }), 'AGO Go');
  assert.equal(renderTemplate(text, { language: 'python' }), 'AOTHER Python');
});

test('RESP: encode, parse incrementally, compare', () => {
  const buf = encodeCommand(['SET', 'k', 'héllo']);
  assert.equal(buf.toString(), '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$6\r\nhéllo\r\n');
  assert.equal(parse(buf.subarray(0, buf.length - 1)), null);
  assert.deepEqual(parse(buf).value.value.map(v => v.value), ['SET', 'k', 'héllo']);
  assert.equal(diff(parse(Buffer.from('+PONG\r\n')).value, R.simple('PONG')), null);
  assert.match(diff(parse(Buffer.from('$4\r\nPONG\r\n')).value, R.simple('PONG')), /simple string/);
  assert.throws(() => parse(Buffer.from('?x\r\n')));
});

test('cli: init creates a runnable project with config, VS Code tasks and README', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ccfree-home-'));
  const parent = await mkdtemp(join(tmpdir(), 'ccfree-init-'));
  try {
    const env = { ...process.env, CCFREE_HOME: home };
    cli(['init', 'redis', 'proj'], { cwd: parent, env });
    const dir = join(parent, 'proj');
    const config = JSON.parse(await readFile(join(dir, 'ccfree.json'), 'utf8'));
    assert.equal(config.course, 'redis');
    assert.equal(config.language, 'python');
    assert.ok(config.run.includes('app.main'));
    assert.ok(existsSync(join(dir, 'app', 'main.py')));
    assert.throws(() => cli(['init', 'redis', 'other', '--language', 'javascript'], { cwd: parent, env, stdio: 'pipe' }), /New projects use Python/);
    assert.ok(JSON.parse(await readFile(join(dir, '.vscode', 'tasks.json'), 'utf8')).tasks.length >= 2);
    assert.match(cli(['status'], { cwd: dir, env }), /0\/124 stages complete/);
    assert.match(cli(['show'], { cwd: dir, env }), /Bind to a port/);
    // The untouched starter must fail stage 1.
    assert.throws(() => cli(['test'], { cwd: dir, env, stdio: 'pipe' }));
    assert.throws(() => cli(['init', 'redis', 'proj'], { cwd: parent, env, stdio: 'pipe' }), 'refuses to overwrite');
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('dashboard: serves app and API, read-only, loopback hosts only', async () => {
  const { server, url } = await startServer({ port: 0 });
  try {
    assert.match(await (await fetch(url)).text(), /CodeCrafter Free/);
    const courses = await (await fetch(`${url}/api/courses`)).json();
    assert.equal(courses.length, 11);
    const redis = await (await fetch(`${url}/api/courses/redis`)).json();
    assert.ok(redis.tested.includes('jm1'));
    assert.equal((await fetch(`${url}/api/courses/..%2F..%2Fetc`)).status, 404);
    assert.equal((await fetch(`${url}/api/progress`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${url}/../package.json`)).status, 404);
    const foreign = await new Promise(resolve => {
      import('node:http').then(({ request }) => {
        const req = request(`${url}/api/courses`, { headers: { Host: 'evil.example:80' } }, res => resolve(res.statusCode));
        req.end();
      });
    });
    assert.equal(foreign, 403);
  } finally {
    server.close();
  }
});

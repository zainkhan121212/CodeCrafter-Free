import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listCourses } from '../lib/content.mjs';
import { pythonAnswers } from '../lib/python-answers.mjs';
import { getAnswer } from '../lib/answers.mjs';
import { run } from './helpers.mjs';
import { startServer } from '../server.mjs';

// Apply the displayed diff independently, so the test checks what learners see.
function applyDiff(source, diff) {
  const original = source.trimEnd().split('\n'), output = [];
  let cursor = 0;
  for (const line of diff.trimEnd().split('\n').slice(2)) {
    const hunk = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]) - (Number(hunk[2]) ? 1 : 0);
      output.push(...original.slice(cursor, start)); cursor = start;
    } else if (line[0] === ' ' || line[0] === '-') {
      assert.equal(original[cursor++], line.slice(1), 'diff context matches');
      if (line[0] === ' ') output.push(line.slice(1));
    } else if (line[0] === '+') output.push(line.slice(1));
    else assert.fail(`Invalid diff line: ${line}`);
  }
  return [...output, ...original.slice(cursor)].join('\n') + '\n';
}

test('answers expose only authored Python stage diffs and report missing coverage', async () => {
  let available = 0, missing = 0;
  for (const course of listCourses()) {
    assert.deepEqual(course.languages, ['python']);
    for (const stage of course.stages) {
      const answer = await getAnswer(course.slug, stage.slug);
      assert.equal(answer.language, 'python');
      assert.equal(answer.scope, 'stage');
      assert.equal(answer.files, undefined);
      assert.equal(answer.source, undefined);
      if (answer.available) { available++; assert.match(answer.diff, /^--- a\/app\/main.py/); }
      else { missing++; assert.equal(answer.diff, undefined); }
    }
  }
  assert.equal(available, 7); assert.ok(missing > 0);
  assert.equal(await getAnswer('../redis', 'jm1'), null);
  assert.equal(await getAnswer('redis', 'unknown'), null);
});

test('Python Redis diffs apply cleanly and each passes its own and preceding stages', { timeout: 180000 }, async () => {
  const python = process.env.CCFREE_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  assert.equal(spawnSync(python, ['--version']).status, 0, 'Install Python or set CCFREE_TEST_PYTHON');
  const dir = await mkdtemp(join(tmpdir(), 'ccfree-python-answers-'));
  try {
    const stages = [];
    for (const answer of pythonAnswers('redis')) {
      const applied = applyDiff(answer.before, answer.diff);
      assert.equal(applied, answer.source);
      await writeFile(join(dir, 'main.py'), applied);
      stages.push(answer.stage);
      const result = await run('redis', stages, { course: 'redis', language: 'python', dir, build: null, run: [python, '-u', join(dir, 'main.py')] });
      assert.ok(result.passed, `${answer.stage}\n${result.logs.join('\n')}`);
    }
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test('answer API returns Python diffs and an honest unavailable state', async () => {
  const { server, url } = await startServer({ port: 0 });
  try {
    const answer = await (await fetch(`${url}/api/courses/redis/stages/rg2/answer`)).json();
    assert.equal(answer.available, true);
    assert.equal(answer.previousStage, 'jm1');
    assert.match(answer.diff, /sendall/);
    const missing = await (await fetch(`${url}/api/courses/git/stages/gg4/answer`)).json();
    assert.equal(missing.available, false);
    assert.equal((await fetch(`${url}/api/courses/redis/stages/nope/answer`)).status, 404);
  } finally { server.close(); }
});

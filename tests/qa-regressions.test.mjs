import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { root } from '../lib/content.mjs';
import { latestStageRun } from '../lib/render.mjs';
import { createRun, runsDir } from '../lib/store.mjs';

test('stage results stay within the active project', () => {
  const other = { course: 'redis', stages: ['rg2'], project: 'G:/other' };
  const own = { course: 'redis', stages: ['rg2'], project: 'G:/My-Redis' };
  assert.equal(latestStageRun([other, own], 'redis', 'rg2', 'g:\\my-redis'), own);
  assert.equal(latestStageRun([other], 'redis', 'rg2', 'G:/My-Redis'), null);
  assert.equal(latestStageRun([own], 'redis', 'rg2', null), null);
});

test('completion event is emitted after the run summary exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccfree-qa-store-'));
  const previous = process.env.CCFREE_HOME;
  process.env.CCFREE_HOME = dir;
  try {
    const run = await createRun({ course: 'redis', stages: ['jm1'] });
    const emit = run.event;
    let observed = false;
    run.event = event => {
      if (event.type === 'finish') {
        assert.equal(JSON.parse(readFileSync(join(runsDir(), `${run.id}.json`), 'utf8')).status, 'passed');
        observed = true;
      }
      emit(event);
    };
    await run.finish({ status: 'passed', results: [] });
    assert.ok(observed);
  } finally {
    if (previous === undefined) delete process.env.CCFREE_HOME; else process.env.CCFREE_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('disabled extension with --previous cannot pass without running tests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ccfree-qa-cli-'));
  try {
    await writeFile(join(dir, 'ccfree.json'), JSON.stringify({ course: 'redis', language: 'python', extensions: [], run: ['python', '-m', 'app.main'] }));
    assert.throws(() => execFileSync(process.execPath, [join(root, 'bin/ccfree.mjs'), 'test', '--stage', 'mh6', '--previous'],
      { cwd: dir, env: { ...process.env, CCFREE_HOME: join(dir, 'data') }, stdio: 'pipe' }), /disabled extension/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { killTree } from '../lib/harness/process.mjs';

test('Windows cleanup falls back when taskkill cannot launch', { skip: process.platform !== 'win32', timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  const closed = once(child, 'close');
  await once(child, 'spawn');
  const oldPath = process.env.PATH;
  let timer;
  try {
    process.env.PATH = '';
    killTree(child);
    const result = await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Child was left running')), 2000); })]);
    assert.ok(result);
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
});

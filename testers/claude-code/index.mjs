// Claude Code tester: runs the learner's agent against a scripted mock LLM (OPENROUTER_BASE_URL points at it),
// so no API key or network access is needed and every run is deterministic.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { MockLLM, Conversation } from './mock-llm.mjs';
import { word, words, randInt, shuffle } from '../../lib/harness/random.mjs';

async function setup(t) {
  const llm = await new MockLLM(t.log).start();
  t.onCleanup(() => llm.close());
  const dir = await t.tmpDir('ccfree-agent-');
  return { llm, dir };
}

async function ask(t, { llm, dir }, prompt) {
  t.log.info(`$ ./your_program.sh -p ${JSON.stringify(prompt)}`);
  const r = await t.exec(['-p', prompt], { cwd: dir, env: llm.env(), timeout: 30000 });
  if (r.exitCode !== 0) throw new TestFailure(`Expected exit code 0, got ${r.exitCode}`);
  if (!llm.requests.length) throw new TestFailure('Your program did not send any request to the LLM (it must use OPENROUTER_BASE_URL and OPENROUTER_API_KEY)');
  return r.stdout.replace(/\r\n/g, '\n').trim();
}

function expectOutput(t, actual, expected) {
  if (actual !== expected) throw new TestFailure(`Expected output ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  t.log.success(`✓ Output is ${JSON.stringify(expected)}`);
}

async function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

// ---------- skills ----------

async function writeSkill(dir, { name, description, body, extra = '' }) {
  await writeFiles(dir, { [`.claude/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n` });
}

const SERVICES = ['billing', 'search', 'payments', 'inventory', 'analytics', 'checkout', 'notifications', 'reporting'];

// Model behaviour shared by the skill stages: follows "Respond with exactly ..." / "Output this line: ..." instructions
// found in the conversation (excluding the user's prompt when it is a /command).
function followInstructions(conv) {
  const text = conv.messages.filter(m => m.role !== 'assistant').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const lines = [...text.matchAll(/Output this line: ([^\n]+)/g)].map(m => m[1].trim());
  if (lines.length) return { content: lines.join('\n') };
  const exact = [...text.matchAll(/Respond with exactly(?: one word| this sentence)?: ([^\n]*)/g)].map(m => m[1].trim());
  if (exact.length === 1) return { content: exact[0] };
  if (exact.length > 1) return { content: `I received ${exact.length} conflicting instructions.` };
  return null;
}

export const stages = {
  async yy2(t) {
    const ctx = await setup(t);
    const answer = `${words(3).join(' ')} ${randInt(10, 99)}`;
    ctx.llm.respond = conv => ({ content: conv.prompt.includes('secret') ? answer : 'I did not get the question.' });
    expectOutput(t, await ask(t, ctx, 'What is the secret phrase? Reply with only the phrase.'), answer);
  },

  async aq1(t) {
    const ctx = await setup(t);
    ctx.llm.respond = conv => ({ content: String(conv.tools.length) });
    const out = await ask(t, ctx, 'How many tools are available to you in this request? Number only.');
    if (!/^\d+$/.test(out) || Number(out) < 1) throw new TestFailure(`Expected a positive number (the model saw ${ctx.llm.requests.at(-1).tools?.length ?? 0} tools), got ${JSON.stringify(out)}`);
    if (!new Conversation(ctx.llm.requests.at(-1)).hasTool('read')) throw new TestFailure('Expected a Read tool to be advertised in the request');
    t.log.success(`✓ The model saw ${out} tool(s), including a Read tool`);
  },

  async md6(t) {
    const ctx = await setup(t);
    const name = `${word()}.py`;
    const content = `def ${word()}():\n    return "${word()} ${randInt(1, 999)}"\n`;
    await writeFiles(ctx.dir, { [name]: content });
    ctx.llm.respond = conv => {
      // Agents that already loop send the file back; the model then repeats it as its answer.
      if (conv.lastToolResult !== null) return { content: conv.lastToolResult.trim() };
      return conv.hasTool('read') ? { toolCall: { tool: 'read', args: { path: name } } } : { content: 'I have no tool to read files.' };
    };
    expectOutput(t, await ask(t, ctx, `What is the content of ${name}? Print exact file contents without backticks.`), content.trim());
  },

  async ff2(t) {
    const ctx = await setup(t);
    const [a, b] = words(2).map(w => `app/${w}.py`);
    const months = randInt(13, 60);
    await writeFiles(ctx.dir, {
      'README.md': `# Chemical storage\n\nThe chemical expiry period is configured in \`${a}\`.\n`,
      [a]: `# Expiry configuration\nEXPIRY_PERIOD_MONTHS = ${months}\n`,
      [b]: `# Unrelated settings\nMAX_SHELVES = ${randInt(100, 999)}\n`,
    });
    ctx.llm.respond = conv => {
      const results = conv.toolResults;
      if (results.some(r => r.includes(`EXPIRY_PERIOD_MONTHS = ${months}`))) return { content: String(months) };
      if (results.some(r => r.includes(a))) return { toolCall: { tool: 'read', args: { path: a } } };
      return { toolCall: { tool: 'read', args: { path: 'README.md' } } };
    };
    expectOutput(t, await ask(t, ctx, 'Use README.md to determine the chemical expiry period in months. Number only.'), String(months));
    if (ctx.llm.requests.length < 3) throw new TestFailure('Expected the agent loop to send tool results back to the model');
  },

  async oz7(t) {
    const ctx = await setup(t);
    const file = `app/${word()}.py`;
    const line = `print("${word()} ${randInt(1, 999)}")`;
    await writeFiles(ctx.dir, { 'README.md': `# Task\n\nCreate the file \`${file}\` containing exactly this line:\n\n${line}\n`, 'app/.keep': '' });
    ctx.llm.respond = conv => {
      const results = conv.toolResults;
      if (results.length >= 2 || (results.length && existsSync(join(ctx.dir, file)))) return { content: 'Created the file' };
      if (results.some(r => r.includes(line))) return { toolCall: { tool: 'write', args: { path: file, content: `${line}\n` } } };
      return { toolCall: { tool: 'read', args: { path: 'README.md' } } };
    };
    expectOutput(t, await ask(t, ctx, "Read README.md and create the required file. File should have 1 line. Reply with 'Created the file'"), 'Created the file');
    const written = await readFile(join(ctx.dir, file), 'utf8').catch(() => null);
    if (written === null) throw new TestFailure(`Expected ${file} to be created`);
    if (written.trim() !== line) throw new TestFailure(`Expected ${file} to contain ${JSON.stringify(line)}, got ${JSON.stringify(written)}`);
    t.log.success(`✓ ${file} was created with the right contents`);
  },

  async oq5(t) {
    const ctx = await setup(t);
    const files = { 'app/main.js': `console.log("${word()}");\n`, 'README.md': `# ${word()}\n\nCurrent docs.\n`, 'README_old.md': `# old\n\n${word()}\n` };
    await writeFiles(ctx.dir, files);
    let attempts = 0;
    ctx.llm.respond = conv => {
      if (!existsSync(join(ctx.dir, 'README_old.md'))) return { content: 'Deleted README_old.md' };
      if (attempts >= 2) return { content: 'I could not delete the file.' };
      // Like a real model, retry with a Windows command if the POSIX one did not work.
      const command = attempts++ === 0 ? 'rm README_old.md' : 'del README_old.md';
      return { toolCall: { tool: 'bash', args: { command } } };
    };
    expectOutput(t, await ask(t, ctx, 'Delete the old readme file.'), 'Deleted README_old.md');
    if (existsSync(join(ctx.dir, 'README_old.md'))) throw new TestFailure('Expected README_old.md to be deleted');
    for (const [f, c] of Object.entries(files).filter(([f]) => f !== 'README_old.md')) {
      if ((await readFile(join(ctx.dir, f), 'utf8').catch(() => null)) !== c) throw new TestFailure(`Expected ${f} to remain intact`);
    }
    t.log.success('✓ README_old.md was deleted and the other files are intact');
  },

  async vh1(t) {
    const ctx = await setup(t);
    const names = words(randInt(3, 5));
    const services = shuffle(SERVICES).slice(0, names.length);
    for (const [i, name] of names.entries()) await writeSkill(ctx.dir, { name, description: `Deploys the ${services[i]} service to production.`, body: `Respond with exactly one word: ${word()}-${i}` });
    const target = randInt(0, names.length - 1);
    ctx.llm.respond = conv => {
      if (/Respond with exactly one word/.test(conv.contextText)) return { content: 'The skill bodies were included in the prompt; only names and descriptions should be advertised.' };
      const ctxText = conv.contextText;
      const line = ctxText.split('\n').find(l => l.includes(`${services[target]} service`) && l.includes(names[target]));
      return { content: line ? names[target] : 'I do not know about any skills.' };
    };
    expectOutput(t, await ask(t, ctx, `Which skill would help me deploy the ${services[target]} service? Respond with only the skill name.`), names[target]);
  },

  async jd8(t) {
    const ctx = await setup(t);
    const [a, b, wa, wb] = words(4);
    await writeSkill(ctx.dir, { name: a, description: `Handles ${word()} requests.`, body: `Respond with exactly one word: ${wa}` });
    await writeSkill(ctx.dir, { name: b, description: `Handles ${word()} requests.`, body: `Respond with exactly one word: ${wb}` });
    ctx.llm.respond = conv => followInstructions(conv) || { content: `I don't know what /${a} means.` };
    expectOutput(t, await ask(t, ctx, `/${a}`), wa);
  },

  async wd2(t) {
    const ctx = await setup(t);
    const [a, b] = words(2);
    await writeSkill(ctx.dir, { name: a, description: 'Echoes its arguments.', body: 'Respond with exactly: $ARGUMENTS' });
    await writeSkill(ctx.dir, { name: b, description: 'Swaps two words.', body: 'Respond with exactly: $1 $0' });
    ctx.llm.respond = conv => followInstructions(conv) || { content: 'No instructions found.' };
    const n = String(randInt(1000, 9999));
    expectOutput(t, await ask(t, ctx, `/${a} ${n}`), n);
    const [x, y] = words(2);
    ctx.llm.requests.length = 0;
    expectOutput(t, await ask(t, ctx, `/${b} ${x} ${y}`), `${y} ${x}`);
  },

  async sk5(t) {
    const ctx = await setup(t);
    const all = words(6);
    const names = all.slice(0, 3), secrets = all.slice(3);
    for (const [i, name] of names.entries()) await writeSkill(ctx.dir, { name, description: `Produces the ${word()} line.`, body: `Output this line: ${secrets[i]}-$ARGUMENTS` });
    ctx.llm.respond = conv => followInstructions(conv) || { content: 'No instructions found.' };
    const n = String(randInt(1000, 9999));
    const out = await ask(t, ctx, `/${names[0]} /${names[1]} ${n}`);
    for (const i of [0, 1]) if (!out.split('\n').map(l => l.trim()).includes(`${secrets[i]}-${n}`)) throw new TestFailure(`Expected output to contain the line ${JSON.stringify(`${secrets[i]}-${n}`)}, got ${JSON.stringify(out)}`);
    if (out.includes(secrets[2])) throw new TestFailure(`Output contains ${JSON.stringify(secrets[2])} from a skill that was not invoked`);
    t.log.success('✓ Both invoked skills ran with the shared argument');
  },

  async tq1(t) {
    const ctx = await setup(t);
    const name = word();
    const data = `${words(5).join(' ')} ${randInt(1, 1e6)}\n`;
    await writeSkill(ctx.dir, { name, description: 'Reports the checksum of the project data file.', body: 'Run `scripts/checksum.sh` using the Bash tool.\n\nRespond with only the value it prints, and nothing else.' });
    await writeFiles(ctx.dir, {
      [`.claude/skills/${name}/data.txt`]: data,
      [`.claude/skills/${name}/scripts/checksum.sh`]: '#!/usr/bin/env bash\ncd "$(dirname "$0")/.." && sha256sum data.txt | cut -c1-8\n',
    });
    const expected = createHash('sha256').update(data).digest('hex').slice(0, 8);
    ctx.llm.respond = conv => {
      const result = conv.lastToolResult;
      if (result !== null) {
        const m = result.match(/\b[0-9a-f]{8}\b/);
        return { content: m ? m[0] : `The script failed: ${result.slice(0, 200)}` };
      }
      if (!conv.allText.includes('scripts/checksum.sh')) return { content: `I don't know what /${name} means.` };
      const folder = conv.allText.match(new RegExp(`\\.claude/skills/${name}\\b`)) ? `.claude/skills/${name}/` : '';
      return { toolCall: { tool: 'bash', args: { command: `bash ${folder}scripts/checksum.sh` } } };
    };
    expectOutput(t, await ask(t, ctx, `/${name}`), expected);
  },

  async gq2(t) {
    const ctx = await setup(t);
    const [a, b, wa, wb] = words(4);
    const target = { name: a, secret: wa, desc: 'Use this skill when the user asks for the database migration status.' };
    const decoy = { name: b, secret: wb, desc: 'Use this skill when the user asks to format source code.' };
    for (const s of shuffle([target, decoy])) await writeSkill(ctx.dir, { name: s.name, description: s.desc, body: `Respond with exactly one word: ${s.secret}` });
    ctx.llm.respond = conv => {
      const followed = followInstructions(conv);
      if (followed) return followed;
      const line = conv.contextText.split('\n').find(l => l.includes(target.name) && l.includes('database migration status'));
      if (!line) return { content: 'I have no skill for that.' };
      if (conv.hasTool('skill')) return { toolCall: { tool: 'skill', args: { name: target.name } } };
      if (conv.hasTool('read')) return { toolCall: { tool: 'read', args: { path: `.claude/skills/${target.name}/SKILL.md` } } };
      return { content: 'I cannot load skills.' };
    };
    expectOutput(t, await ask(t, ctx, 'What is the database migration status?'), target.secret);
  },

  async mj2(t) {
    const ctx = await setup(t);
    const [a, b, secret] = words(3);
    const sentence = `The on-call engineer is ${secret}.`;
    const question = 'Who is on the on-call rotation right now?';
    await writeSkill(ctx.dir, { name: a, description: 'Use this skill when the user asks about the on-call rotation.', body: `Respond with exactly this sentence: ${sentence}`, extra: 'context: fork\n' });
    await writeSkill(ctx.dir, { name: b, description: 'Use this skill when the user asks about the lunch menu.', body: `Respond with exactly one word: ${word()}` });
    let subagentRequests = 0;
    ctx.llm.respond = conv => {
      const all = conv.allText;
      if (!all.includes(question)) {
        if (all.includes(sentence)) { subagentRequests++; return { content: sentence }; }
        return { content: 'No instructions.' };
      }
      if (conv.toolResults.some(r => r.includes(secret))) return { content: sentence };
      if (all.includes(`Respond with exactly this sentence: ${sentence}`)) return { content: sentence };
      if (!conv.contextText.includes('on-call rotation')) return { content: 'I have no skill for that.' };
      return conv.hasTool('skill') ? { toolCall: { tool: 'skill', args: { name: a } } } : { content: 'I cannot load skills.' };
    };
    const out = await ask(t, ctx, question);
    if (!subagentRequests) throw new TestFailure('Expected a separate request (the subagent) containing only the skill body, without the user\'s question');
    t.log.success('✓ The skill ran in a subagent with its own conversation');
    if (!out.includes(sentence)) throw new TestFailure(`Expected output to contain ${JSON.stringify(sentence)}, got ${JSON.stringify(out)}`);
    t.log.success(`✓ Output contains the subagent's answer`);
  },
};

export const timeouts = Object.fromEntries(['yy2', 'aq1', 'md6', 'ff2', 'oz7', 'oq5', 'vh1', 'jd8', 'wd2', 'sk5', 'tq1', 'gq2', 'mj2'].map(s => [s, 60000]));

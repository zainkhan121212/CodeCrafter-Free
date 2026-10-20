// Reference coding agent used to verify the Claude Code tester. Spoilers!
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const prompt = process.argv[process.argv.indexOf('-p') + 1];
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY;

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TOOLS = [
  fn('Read', 'Read and return the contents of a file', { file_path: { type: 'string', description: 'The path to the file to read' } }, ['file_path']),
  fn('Write', 'Write content to a file', { file_path: { type: 'string', description: 'The path of the file to write to' }, content: { type: 'string', description: 'The content to write to the file' } }, ['file_path', 'content']),
  fn('Bash', 'Execute a shell command', { command: { type: 'string', description: 'The command to execute' } }, ['command']),
  fn('Skill', "Load a skill's instructions into the conversation", { name: { type: 'string', description: 'The name of the skill to use' }, args: { type: 'string', description: 'Optional arguments for the skill' } }, ['name']),
];

// ---- skills ----
function loadSkills() {
  const root = '.claude/skills';
  if (!existsSync(root)) return new Map();
  const skills = new Map();
  for (const folder of readdirSync(root)) {
    const file = join(root, folder, 'SKILL.md');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const meta = {};
    for (const line of (m?.[1] || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    skills.set(folder, { name: folder, description: meta.description || '', fork: meta.context === 'fork', body: (m?.[2] || text).trim(), dir: `${root}/${folder}` });
  }
  return skills;
}
const skills = loadSkills();

function expand(skill, args) {
  const parts = args.trim() ? args.trim().split(/\s+/) : [];
  const body = skill.body.replace(/\$ARGUMENTS/g, args.trim()).replace(/\$(\d+)/g, (_, i) => parts[Number(i)] ?? '');
  return `Skill: ${skill.name} (located at ${skill.dir})\nPaths in the instructions below are relative to that folder.\n\n${body}`;
}

function bash(command) {
  const bashExe = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;
  const r = bashExe ? spawnSync('bash', ['-c', command], { encoding: 'utf8' }) : spawnSync(command, { shell: true, encoding: 'utf8' });
  return `${r.stdout || ''}${r.stderr || ''}` || `(exit code ${r.status})`;
}

async function chat(messages) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: 'anthropic/claude-haiku-4.5', messages, tools: TOOLS }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).choices[0];
}

async function runTool(name, args) {
  switch (name) {
    case 'Read': return readFileSync(args.file_path, 'utf8');
    case 'Write': mkdirSync(dirname(args.file_path), { recursive: true }); writeFileSync(args.file_path, args.content); return `Wrote ${args.file_path}`;
    case 'Bash': return bash(args.command);
    case 'Skill': {
      const skill = skills.get(args.name);
      if (!skill) return `Unknown skill: ${args.name}`;
      if (skill.fork) return `Skill ${skill.name} ran in a separate context and returned: ${await agent([{ role: 'user', content: expand(skill, args.args || '') }])}`;
      return expand(skill, args.args || '');
    }
    default: return `Unknown tool ${name}`;
  }
}

async function agent(messages) {
  for (let i = 0; i < 20; i++) {
    const choice = await chat(messages);
    const msg = choice.message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return msg.content ?? '';
    for (const call of msg.tool_calls) {
      let result;
      try { result = await runTool(call.function.name, JSON.parse(call.function.arguments || '{}')); } catch (err) { result = `Error: ${err.message}`; }
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
    }
  }
  return '';
}

const messages = [];
if (skills.size) {
  messages.push({ role: 'system', content: `You have access to the following skills:\n\n${[...skills.values()].map(s => `- ${s.name}: ${s.description}`).join('\n')}\n\nIf a skill matches the user's request, call the Skill tool with its name\nand follow the instructions it returns.` });
}

// /skill invocations: leading "/name" tokens, then the shared argument string.
const tokens = prompt.split(/\s+/);
const invoked = [];
while (tokens[0]?.startsWith('/') && skills.has(tokens[0].slice(1))) invoked.push(skills.get(tokens.shift().slice(1)));
if (invoked.length) {
  const args = tokens.join(' ');
  if (invoked[0].fork) console.log(await agent([{ role: 'user', content: expand(invoked[0], args) }]));
  else {
    messages.push({ role: 'user', content: invoked.map(s => expand(s, args)).join('\n\n') });
    console.log(await agent(messages));
  }
} else {
  messages.push({ role: 'user', content: prompt });
  console.log(await agent(messages));
}

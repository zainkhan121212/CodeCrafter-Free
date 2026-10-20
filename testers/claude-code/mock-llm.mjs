// A scripted, OpenAI-compatible chat completions server that stands in for the LLM during tests.
// Each test installs a `respond(request)` function that returns { content } or { toolCall: { tool, args } }.
// The mock inspects the request like a model would (advertised tools, system prompt, tool results), so it can
// tell whether the learner's agent sent the right context — without an API key or network access.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

export class MockLLM {
  constructor(log) {
    this.log = log;
    this.requests = [];
    this.respond = () => ({ content: 'Hello from the mock model!' });
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise(r => this.server.listen(0, '127.0.0.1', r));
    this.baseUrl = `http://127.0.0.1:${this.server.address().port}/api/v1`;
    return this;
  }

  close() { this.server?.close(); this.server?.closeAllConnections?.(); }

  env() { return { OPENROUTER_API_KEY: 'ccfree-mock-key', OPENROUTER_BASE_URL: this.baseUrl, OPENAI_API_KEY: 'ccfree-mock-key', OPENAI_BASE_URL: this.baseUrl }; }

  handle(req, res) {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url.endsWith('/models')) return reply(200, { data: [{ id: 'anthropic/claude-haiku-4.5' }] });
    if (req.method !== 'POST' || !req.url.split('?')[0].endsWith('/chat/completions')) return reply(404, { error: { message: `Unknown endpoint ${req.method} ${req.url}` } });
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let request;
      try { request = JSON.parse(body); } catch { return reply(400, { error: { message: 'Request body is not valid JSON' } }); }
      if (!Array.isArray(request.messages) || !request.messages.length) return reply(400, { error: { message: '"messages" must be a non-empty array' } });
      if (request.stream) return reply(400, { error: { message: 'The CodeCrafter Free mock model does not support streaming; send stream: false' } });
      this.requests.push(request);
      let out;
      try { out = this.respond(new Conversation(request), this.requests.length); } catch (err) { out = { content: `mock error: ${err.message}` }; }
      const message = { role: 'assistant', content: out.content ?? null };
      let finish = 'stop';
      if (out.toolCall) {
        const conv = new Conversation(request);
        const tool = conv.tool(out.toolCall.tool);
        const args = conv.argsFor(tool, out.toolCall.args);
        message.tool_calls = [{ id: `call_${randomBytes(6).toString('hex')}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }];
        finish = 'tool_calls';
        this.log.info(`[mock LLM] → tool call ${tool.function.name}(${JSON.stringify(args)})`);
      } else {
        this.log.info(`[mock LLM] → ${JSON.stringify(message.content).slice(0, 120)}`);
      }
      reply(200, {
        id: `gen-${randomBytes(8).toString('hex')}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: request.model || 'mock',
        choices: [{ index: 0, message, finish_reason: finish, logprobs: null }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    });
  }
}

const textOf = content => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p.text ?? '').join('\n') : content == null ? '' : JSON.stringify(content));

const TOOL_PATTERNS = {
  read: /read|view|cat|open/i,
  write: /write|create|save/i,
  bash: /bash|shell|exec|command|run|terminal/i,
  skill: /skill/i,
};
const ARG_PATTERNS = {
  path: /path|file|name/i,
  content: /content|text|data|body/i,
  command: /command|cmd|script/i,
  name: /name|skill|command/i,
};

// Helpers for reading a chat completion request.
export class Conversation {
  constructor(request) {
    this.request = request;
    this.messages = request.messages;
    this.tools = (request.tools || []).filter(t => t?.function?.name);
  }

  get prompt() { return textOf(this.messages.find(m => m.role === 'user')?.content); }
  get lastUser() { return textOf([...this.messages].reverse().find(m => m.role === 'user')?.content); }
  get system() { return this.messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join('\n'); }
  get allText() { return this.messages.map(m => textOf(m.content)).join('\n'); }
  // Everything except the user's own prompt (to check what the agent added).
  get contextText() { const first = this.messages.find(m => m.role === 'user'); return this.messages.filter(m => m !== first).map(m => textOf(m.content)).join('\n'); }
  get toolResults() { return this.messages.filter(m => m.role === 'tool').map(m => textOf(m.content)); }
  get lastToolResult() { return this.toolResults.at(-1) ?? null; }

  tool(kind) {
    const pattern = TOOL_PATTERNS[kind];
    const exact = this.tools.find(t => t.function.name.toLowerCase() === kind);
    return exact || this.tools.find(t => pattern.test(t.function.name)) || null;
  }

  hasTool(kind) { return !!this.tool(kind); }

  // Maps semantic args ({ path, content, command, name }) onto the tool's declared parameter names.
  argsFor(tool, semantic) {
    const props = Object.keys(tool.function.parameters?.properties || {});
    const required = tool.function.parameters?.required || [];
    const out = {};
    const used = new Set();
    for (const [key, value] of Object.entries(semantic)) {
      const exact = props.find(p => p === key && !used.has(p));
      const match = exact || props.find(p => ARG_PATTERNS[key]?.test(p) && !used.has(p)) || required.find(p => !used.has(p)) || props.find(p => !used.has(p)) || key;
      used.add(match);
      out[match] = value;
    }
    return out;
  }
}

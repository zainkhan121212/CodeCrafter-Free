// HTTP server tester: talks raw HTTP/1.1 over TCP to the learner's server on port 4221.
import { gunzipSync } from 'node:zlib';
import { writeFile, readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { TcpConn } from '../../lib/harness/net.mjs';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { parseResponse, buildRequest } from '../../lib/protocols/http.mjs';
import { word, words, randInt, pick } from '../../lib/harness/random.mjs';

const PORT = 4221;

class HttpClient {
  constructor(t, conn, name) { this.t = t; this.conn = conn; this.name = name; }

  static async connect(t, proc, name = null) {
    const conn = await TcpConn.connect(PORT, { isAlive: () => proc.running });
    t.onCleanup(() => conn.close());
    return new HttpClient(t, conn, name);
  }

  label() { return this.name ? `${this.name}: ` : ''; }

  send(method, path, headers = {}, body = null) {
    const flags = Object.entries(headers).map(([k, v]) => ` -H "${k}: ${v}"`).join('');
    const data = body !== null ? ` --data "${body}"` : '';
    this.t.log.info(`${this.label()}$ curl -v${method !== 'GET' && body === null ? ` -X ${method}` : ''}${data}${flags} http://localhost:${PORT}${path}`);
    this.conn.write(buildRequest(method, path, headers, body));
  }

  async read() {
    const res = await this.conn.readWith(parseResponse, 3000, 'HTTP response');
    this.t.log.info(`${this.label()}Received response with ${res.status} status code`);
    return res;
  }

  async request(method, path, headers, body) {
    this.send(method, path, headers, body);
    return this.read();
  }
}

function expectResponse(t, res, { status, headers = {}, absentHeaders = [], body = null }) {
  if (res.version !== 'HTTP/1.1') throw new TestFailure(`Expected HTTP version HTTP/1.1, got ${res.version}`);
  if (res.status !== status) throw new TestFailure(`Expected status code ${status}, got ${res.status} (status line: ${JSON.stringify(res.statusLine)})`);
  t.log.success(`✓ Received status code ${status}`);
  for (const [name, value] of Object.entries(headers)) {
    const actual = res.headers[name.toLowerCase()];
    if (actual === undefined) throw new TestFailure(`Expected header "${name}" to be present`);
    if (actual !== value) throw new TestFailure(`Expected header "${name}" to be "${value}", got "${actual}"`);
    t.log.success(`✓ ${name} header is ${JSON.stringify(value)}`);
  }
  for (const name of absentHeaders) {
    if (res.headers[name.toLowerCase()] !== undefined) throw new TestFailure(`Expected no "${name}" header, but got "${res.headers[name.toLowerCase()]}"`);
    t.log.success(`✓ ${name} header is not present`);
  }
  if (body !== null) {
    const actual = res.body.toString('utf8');
    if (actual !== body) throw new TestFailure(`Expected body ${JSON.stringify(body)}, got ${JSON.stringify(actual)}`);
    t.log.success(`✓ Body is ${JSON.stringify(body)}`);
  }
}

async function start(t, args = []) {
  const proc = t.spawn(args);
  const client = await HttpClient.connect(t, proc);
  return { proc, client };
}

const echoCheck = (t, res, text) => expectResponse(t, res, { status: 200, headers: { 'Content-Type': 'text/plain', 'Content-Length': String(Buffer.byteLength(text)) }, body: text });

async function filesDir(t) {
  return (await t.tmpDir('ccfree-http-')) + sep;
}

export const stages = {
  async at4(t) {
    const proc = t.spawn();
    t.log.info(`Connecting to localhost:${PORT} using TCP`);
    await TcpConn.connect(PORT, { isAlive: () => proc.running }).then(c => { t.onCleanup(() => c.close()); });
    t.log.success('Connection successful');
  },

  async ia4(t) {
    const { client } = await start(t);
    expectResponse(t, await client.request('GET', '/'), { status: 200 });
  },

  async ih0(t) {
    const { proc, client } = await start(t);
    const path = `/${word()}`;
    expectResponse(t, await client.request('GET', path), { status: 404 });
    const second = await HttpClient.connect(t, proc);
    expectResponse(t, await second.request('GET', '/'), { status: 200 });
  },

  async cn2(t) {
    const { client } = await start(t);
    const text = word();
    echoCheck(t, await client.request('GET', `/echo/${text}`), text);
  },

  async fs3(t) {
    const { client } = await start(t);
    const agent = `${word()}/${word()}-${randInt(1, 9)}.${randInt(0, 9)}`;
    echoCheck(t, await client.request('GET', '/user-agent', { 'User-Agent': agent }), agent);
  },

  async ej5(t) {
    const proc = t.spawn();
    const n = randInt(3, 5);
    const clients = [];
    for (let i = 0; i < n; i++) clients.push(await HttpClient.connect(t, proc, `client-${i + 1}`));
    t.log.info(`Opened ${n} connections; sending one request on each, last connection first`);
    for (const c of [...clients].reverse()) {
      expectResponse(t, await c.request('GET', '/'), { status: 200 });
    }
  },

  async ap6(t) {
    const dir = await filesDir(t);
    const name = `${word()}_${randInt(1, 999)}`;
    const content = words(4).join(' ');
    await writeFile(join(dir, name), content);
    t.log.info(`Created file ${name} with content ${JSON.stringify(content)}`);
    const { proc, client } = await start(t, ['--directory', dir]);
    expectResponse(t, await client.request('GET', `/files/${name}`), {
      status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(Buffer.byteLength(content)) }, body: content,
    });
    const second = await HttpClient.connect(t, proc);
    expectResponse(t, await second.request('GET', `/files/non-existent_${word()}`), { status: 404 });
  },

  async qv8(t) {
    const dir = await filesDir(t);
    const name = `${word()}_${randInt(1, 999)}`;
    const content = words(4).join(' ');
    const { client } = await start(t, ['--directory', dir]);
    expectResponse(t, await client.request('POST', `/files/${name}`, { 'Content-Type': 'application/octet-stream' }, content), { status: 201 });
    const written = await readFile(join(dir, name), 'utf8').catch(() => null);
    if (written === null) throw new TestFailure(`Expected file ${join(dir, name)} to be created`);
    if (written !== content) throw new TestFailure(`Expected file content ${JSON.stringify(content)}, got ${JSON.stringify(written)}`);
    t.log.success('✓ File was created with the request body');
  },

  async df4(t) {
    const { proc, client } = await start(t);
    const text = word();
    expectResponse(t, await client.request('GET', `/echo/${text}`, { 'Accept-Encoding': 'gzip' }), { status: 200, headers: { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' } });
    const second = await HttpClient.connect(t, proc);
    expectResponse(t, await second.request('GET', `/echo/${text}`, { 'Accept-Encoding': 'invalid-encoding' }), { status: 200, headers: { 'Content-Type': 'text/plain' }, absentHeaders: ['Content-Encoding'] });
  },

  async ij8(t) {
    const { proc, client } = await start(t);
    const text = word();
    const bad = () => `encoding-${word()}`;
    expectResponse(t, await client.request('GET', `/echo/${text}`, { 'Accept-Encoding': `${bad()}, gzip, ${bad()}` }), { status: 200, headers: { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' } });
    const second = await HttpClient.connect(t, proc);
    expectResponse(t, await second.request('GET', `/echo/${text}`, { 'Accept-Encoding': `${bad()}, ${bad()}` }), { status: 200, headers: { 'Content-Type': 'text/plain' }, absentHeaders: ['Content-Encoding'] });
  },

  async cr8(t) {
    const { client } = await start(t);
    const text = word();
    const res = await client.request('GET', `/echo/${text}`, { 'Accept-Encoding': 'gzip' });
    expectResponse(t, res, { status: 200, headers: { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': String(res.body.length) } });
    let decoded;
    try { decoded = gunzipSync(res.body).toString('utf8'); } catch (err) { throw new TestFailure(`Body is not valid gzip data: ${err.message}`); }
    if (decoded !== text) throw new TestFailure(`Expected gzip body to decompress to ${JSON.stringify(text)}, got ${JSON.stringify(decoded)}`);
    t.log.success(`✓ Body decompresses to ${JSON.stringify(text)}`);
  },

  async ag9(t) {
    const { client } = await start(t);
    const text = word();
    echoCheck(t, await client.request('GET', `/echo/${text}`), text);
    const agent = `${word()}/${word()}-${word()}`;
    echoCheck(t, await client.request('GET', '/user-agent', { 'User-Agent': agent }), agent);
  },

  async ul1(t) {
    const proc = t.spawn();
    const a = await HttpClient.connect(t, proc, 'client-1');
    const b = await HttpClient.connect(t, proc, 'client-2');
    for (const c of [b, a, b, a]) {
      if (Math.random() < 0.5) {
        const agent = `${word()}/${word()}-${word()}`;
        echoCheck(t, await c.request('GET', '/user-agent', { 'User-Agent': agent }), agent);
      } else {
        const text = word();
        echoCheck(t, await c.request('GET', `/echo/${text}`), text);
      }
    }
  },

  async kh7(t) {
    const { client } = await start(t);
    const text = word();
    echoCheck(t, await client.request('GET', `/echo/${text}`), text);
    const res = await client.request('GET', pick(['/', `/echo/${word()}`]), { Connection: 'close' });
    expectResponse(t, res, { status: 200, headers: { Connection: 'close' } });
    if (!(await client.conn.waitForClose(2000))) throw new TestFailure('Expected the server to close the connection after responding to "Connection: close"');
    t.log.success('✓ Connection was closed by the server');
  },
};

// A logging Redis client used by the Redis testers.
import { TcpConn } from '../../lib/harness/net.mjs';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { encodeCommand, parse, diff, show } from '../../lib/protocols/resp.mjs';

const quoteArg = a => (/^[\w:.\-+*$#@/]+$/.test(String(a)) && String(a) !== '' ? String(a) : JSON.stringify(String(a)));

export class RedisClient {
  constructor(conn, log, name) {
    this.conn = conn;
    this.log = log;
    this.name = name;
  }

  static async connect(t, { port = 6379, name = null, proc = null, timeout = 5000 } = {}) {
    if (name) t.log.info(`${name}: connecting to localhost:${port}`);
    const conn = await TcpConn.connect(port, { timeout, isAlive: () => !proc || proc.running });
    t.onCleanup(() => conn.close());
    return new RedisClient(conn, t.log, name);
  }

  label() { return this.name ? `${this.name}: ` : ''; }

  send(...args) {
    this.log.info(`${this.label()}$ redis-cli ${args.map(quoteArg).join(' ')}`);
    this.conn.write(encodeCommand(args));
  }

  sendRaw(buf) { this.conn.write(buf); }

  read(timeout = 2000, what = 'RESP response') {
    return this.conn.readWith(parse, timeout, what);
  }

  async command(...args) {
    this.send(...args);
    return this.read();
  }

  // Sends a command and asserts the response equals `expected` (built with R.*).
  async check(args, expected, { timeout = 2000 } = {}) {
    this.send(...args);
    return this.expect(expected, { timeout });
  }

  async expect(expected, { timeout = 2000 } = {}) {
    const actual = await this.read(timeout);
    const problem = diff(actual, expected);
    if (problem) throw new TestFailure(`${this.label()}${problem}`);
    this.log.success(`${this.label()}✔︎ Received ${show(actual)}`);
    return actual;
  }

  // Asserts that nothing arrives within `ms` (e.g. a blocked client stays blocked).
  async expectNothing(ms = 300, why = 'no response') {
    if (!(await this.conn.expectNoData(ms))) {
      const value = await this.read(100).catch(() => null);
      throw new TestFailure(`${this.label()}Expected ${why}, but received ${value ? show(value) : 'data'}`);
    }
  }

  close() { this.conn.close(); }
}

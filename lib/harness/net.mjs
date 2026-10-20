// TCP and UDP clients with buffered, timeout-bounded reads for protocol testers.
import net from 'node:net';
import dgram from 'node:dgram';
import { TestFailure } from './runner.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));

export class TcpConn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.waiters = [];
    socket.on('data', d => { this.buffer = Buffer.concat([this.buffer, d]); this.notify(); });
    socket.on('close', () => { this.closed = true; this.notify(); });
    socket.on('error', err => { this.error = err; this.closed = true; this.notify(); });
  }

  notify() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }

  // Connects, retrying until the learner's server is listening (it may still be starting up).
  static async connect(port, { host = null, timeout = 5000, isAlive = () => true } = {}) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
      for (const h of host ? [host] : ['127.0.0.1', '::1']) {
        try {
          const socket = await new Promise((resolve, reject) => {
            const s = net.connect({ port, host: h });
            s.once('connect', () => { s.removeAllListeners('error'); resolve(s); });
            s.once('error', reject);
          });
          socket.setNoDelay(true);
          return new TcpConn(socket);
        } catch (err) { lastError = err; }
      }
      if (!isAlive()) break;
      await wait(100);
    }
    throw new TestFailure(`Failed to connect to port ${port}: ${lastError?.code || lastError?.message || 'timed out'}. Is your server listening on port ${port}?`);
  }

  write(data) { this.socket.write(data); }

  // Waits until parse(buffer) returns a non-null {value, length}; consumes those bytes.
  async readWith(parse, timeout = 3000, what = 'response') {
    const deadline = Date.now() + timeout;
    for (;;) {
      let parsed;
      try { parsed = this.buffer.length ? parse(this.buffer) : null; } catch (err) { throw new TestFailure(`Invalid ${what}: ${err.message}`); }
      if (parsed) {
        this.buffer = this.buffer.subarray(parsed.length);
        return parsed.value;
      }
      if (this.closed) {
        throw new TestFailure(this.buffer.length
          ? `Connection closed before a complete ${what} was received. Received: ${JSON.stringify(this.buffer.toString('latin1'))}`
          : `Connection closed before a ${what} was received`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new TestFailure(this.buffer.length
          ? `Timed out waiting for a complete ${what}. Received so far: ${JSON.stringify(this.buffer.toString('latin1'))}`
          : `Timed out waiting for a ${what} (${timeout / 1000}s)`);
      }
      await new Promise(resolve => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  readExact(n, timeout = 3000, what = `${n} bytes`) {
    return this.readWith(b => (b.length >= n ? { value: Buffer.from(b.subarray(0, n)), length: n } : null), timeout, what);
  }

  // Resolves true if no data arrives within `ms` (used to assert that nothing was sent).
  async expectNoData(ms = 300) {
    await wait(ms);
    return this.buffer.length === 0;
  }

  async waitForClose(timeout = 2000) {
    const deadline = Date.now() + timeout;
    while (!this.closed && Date.now() < deadline) await wait(20);
    return this.closed;
  }

  close() { this.socket.destroy(); this.closed = true; }
}

export class UdpClient {
  constructor() {
    this.socket = dgram.createSocket('udp4');
    this.queue = [];
    this.waiters = [];
    this.socket.on('message', (msg, rinfo) => { this.queue.push({ msg, rinfo }); const w = this.waiters; this.waiters = []; w.forEach(f => f()); });
  }

  send(buf, port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => this.socket.send(buf, port, host, err => (err ? reject(err) : resolve())));
  }

  async receive(timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (!this.queue.length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    return this.queue.shift();
  }

  close() { try { this.socket.close(); } catch { /* closed */ } }
}

// Fails early with a clear message if something (a real Redis, another test run, …) already listens on `port`.
export async function ensurePortFree(port, { udp = false } = {}) {
  const free = await new Promise(resolve => {
    if (udp) {
      const sock = dgram.createSocket('udp4');
      sock.once('error', () => resolve(false));
      sock.bind(port, '127.0.0.1', () => sock.close(() => resolve(true)));
    } else {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    }
  });
  if (!free) throw new TestFailure(`Port ${port} is already in use by another program (another server or test run?). Stop it and run the test again.`);
}

// Picks a free TCP port for tests that let us choose (e.g. --port flags).
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

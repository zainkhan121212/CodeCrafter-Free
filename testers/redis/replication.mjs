import net from 'node:net';
import { R, encodeCommand, parse, show } from '../../lib/protocols/resp.mjs';
import { TcpConn, freePort } from '../../lib/harness/net.mjs';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { word, randInt, key } from '../../lib/harness/random.mjs';
import { RedisClient } from './client.mjs';

export const EMPTY_RDB = Buffer.from('524544495330303131fa0972656469732d76657205372e322e30fa0a72656469732d62697473c040fa056374696d65c26d08bc65fa08757365642d6d656dc2b0c41000fa08616f662d62617365c000fff06e3bfec0ff5aa2', 'hex');
const REPL_ID = '8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb';

async function startOnPort(t, extra = []) {
  const port = await freePort();
  const proc = t.spawn(['--port', String(port), ...extra]);
  return { proc, port };
}

function parseInfo(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(l => l.includes(':')).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

async function info(t, client) {
  const reply = await client.command('INFO', 'replication');
  if (reply.type !== 'bulk' || reply.value === null) throw new TestFailure(`Expected INFO to return a bulk string, got ${show(reply)}`);
  return parseInfo(reply.value);
}

// ---------- the tester as a replica (learner's server is the master) ----------

class FakeReplica {
  constructor(t, conn, name) { this.t = t; this.conn = conn; this.name = name; this.client = new RedisClient(conn, t.log, name); this.offset = 0; }

  static async connect(t, port, proc, name) {
    const conn = await TcpConn.connect(port, { isAlive: () => proc.running });
    t.onCleanup(() => conn.close());
    return new FakeReplica(t, conn, name);
  }

  async handshake(listeningPort, { capa = ['capa', 'psync2'], upTo = 'rdb' } = {}) {
    await this.client.check(['PING'], R.simple('PONG'));
    await this.client.check(['REPLCONF', 'listening-port', String(listeningPort)], R.simple('OK'));
    await this.client.check(['REPLCONF', ...capa], R.simple('OK'));
    if (upTo === 'replconf') return;
    this.client.send('PSYNC', '?', '-1');
    const reply = await this.client.read();
    const m = reply.type === 'simple' && /^FULLRESYNC ([0-9A-Za-z]{40}) 0$/.exec(reply.value);
    if (!m) throw new TestFailure(`${this.client.label()}Expected "+FULLRESYNC <40-character replication ID> 0", got ${show(reply)}`);
    this.t.log.success(`${this.client.label()}✔︎ Received ${show(reply)}`);
    if (upTo === 'psync') return;
    await this.readRdb();
  }

  async readRdb() {
    const header = await this.conn.readWith(b => {
      const end = b.indexOf('\r\n');
      return end < 0 ? null : { value: b.toString('latin1', 0, end), length: end + 2 };
    }, 3000, 'RDB file header ($<length>\\r\\n)');
    const m = /^\$(\d+)$/.exec(header);
    if (!m) throw new TestFailure(`${this.client.label()}Expected the RDB file to start with "$<length>\\r\\n", got ${JSON.stringify(header)}`);
    const rdb = await this.conn.readExact(Number(m[1]), 3000, 'RDB file contents');
    if (rdb.toString('latin1', 0, 5) !== 'REDIS') throw new TestFailure(`${this.client.label()}RDB file must start with "REDIS", got ${JSON.stringify(rdb.toString('latin1', 0, 9))}`);
    this.t.log.success(`${this.client.label()}✔︎ Received RDB file (${rdb.length} bytes)`);
  }

  // Reads one propagated command (a RESP array of bulk strings).
  async readCommand(timeout = 2000) {
    const raw = await this.conn.readWith(b => { const p = parse(b); return p ? { value: { v: p.value, len: p.length }, length: p.length } : null; }, timeout, 'propagated command');
    this.offset += raw.len;
    return raw.v.value.map(x => x.value);
  }

  async expectCommand(expected) {
    const got = await this.readCommand();
    if (got.map((x, i) => (i === 0 ? String(x).toUpperCase() : x)).join(' ') !== expected.join(' ')) throw new TestFailure(`${this.client.label()}Expected propagated command ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    this.t.log.success(`${this.client.label()}✔︎ Received propagated ${JSON.stringify(expected.join(' '))}`);
  }
}

// ---------- the tester as a master (learner's server is a replica) ----------

class FakeMaster {
  constructor(t) { this.t = t; this.commands = []; }

  async start() {
    this.server = net.createServer(sock => {
      if (this.conn) { sock.destroy(); return; }
      this.conn = new TcpConn(sock);
      this.connected?.();
    });
    await new Promise(r => this.server.listen(0, '127.0.0.1', r));
    this.t.onCleanup(() => { this.conn?.close(); this.server.close(); });
    this.port = this.server.address().port;
    this.t.log.info(`Started a master on port ${this.port}`);
    return this;
  }

  async accept(timeout = 5000) {
    if (!this.conn) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new TestFailure(`Your replica did not connect to the master on port ${this.port} within ${timeout / 1000}s`)), timeout);
        this.connected = () => { clearTimeout(timer); resolve(); };
      });
    }
    return this.conn;
  }

  async receive(what) {
    const v = await this.conn.readWith(parse, 3000, what);
    if (v.type !== 'array' || !v.value) throw new TestFailure(`Expected ${what} as a RESP array, got ${show(v)}`);
    return v.value.map(x => x.value);
  }

  async expectReceive(expected, what) {
    const got = await this.receive(what);
    const norm = a => a.map((x, i) => (i === 0 ? String(x).toUpperCase() : String(x).toLowerCase())).join(' ');
    if (norm(got) !== norm(expected)) throw new TestFailure(`Expected the replica to send ${JSON.stringify(expected.join(' '))}, got ${JSON.stringify(got.join(' '))}`);
    this.t.log.success(`master: ✔︎ Received ${JSON.stringify(got.join(' '))}`);
  }

  reply(buf) { this.conn.write(buf); }

  // Runs the handshake from the master side up to `step` (1 = PING, 2 = REPLCONFs, 3 = PSYNC, 4 = RDB sent).
  async handshake(replicaPort, step = 4) {
    await this.accept();
    await this.expectReceive(['PING'], 'PING');
    this.reply(Buffer.from('+PONG\r\n'));
    if (step < 2) return;
    await this.expectReceive(['REPLCONF', 'listening-port', String(replicaPort)], 'REPLCONF listening-port');
    this.reply(Buffer.from('+OK\r\n'));
    const capa = await this.receive('REPLCONF capa');
    if (String(capa[0]).toUpperCase() !== 'REPLCONF' || !capa.map(String).map(s => s.toLowerCase()).includes('psync2')) throw new TestFailure(`Expected "REPLCONF capa psync2", got ${JSON.stringify(capa.join(' '))}`);
    this.t.log.success(`master: ✔︎ Received ${JSON.stringify(capa.join(' '))}`);
    this.reply(Buffer.from('+OK\r\n'));
    if (step < 3) return;
    await this.expectReceive(['PSYNC', '?', '-1'], 'PSYNC ? -1');
    this.reply(Buffer.from(`+FULLRESYNC ${REPL_ID} 0\r\n`));
    this.reply(Buffer.concat([Buffer.from(`$${EMPTY_RDB.length}\r\n`), EMPTY_RDB]));
    this.t.log.info('master: sent FULLRESYNC and an empty RDB file');
  }

  propagate(...commands) {
    const buf = Buffer.concat(commands.map(encodeCommand));
    for (const c of commands) this.t.log.info(`master: propagating ${c.join(' ')}`);
    this.reply(buf);
    return buf.length;
  }

  async expectAck(offset) {
    const got = await this.receive('REPLCONF ACK');
    if (got.length !== 3 || String(got[0]).toUpperCase() !== 'REPLCONF' || String(got[1]).toUpperCase() !== 'ACK' || got[2] !== String(offset)) {
      throw new TestFailure(`Expected "REPLCONF ACK ${offset}", got ${JSON.stringify(got.join(' '))}`);
    }
    this.t.log.success(`master: ✔︎ Received REPLCONF ACK ${offset}`);
  }
}

async function replicaSetup(t, step = 4) {
  const master = await new FakeMaster(t).start();
  const { proc, port } = await startOnPort(t, ['--replicaof', `127.0.0.1 ${master.port}`]);
  await master.handshake(port, step);
  return { master, proc, port };
}

async function masterWithReplicas(t, count, { port = null } = {}) {
  const { proc, port: p } = port ? { proc: t.spawn([]), port } : await startOnPort(t);
  const replicas = [];
  for (let i = 0; i < count; i++) {
    const r = await FakeReplica.connect(t, p, proc, `replica-${i + 1}`);
    await r.handshake(6380 + i);
    replicas.push(r);
  }
  const client = await RedisClient.connect(t, { port: p, proc, name: 'client' });
  return { proc, port: p, replicas, client };
}

export const stages = {
  async bw1(t) {
    const { proc, port } = await startOnPort(t);
    t.log.info(`Connecting to port ${port}...`);
    await RedisClient.connect(t, { port, proc });
    t.log.success('Connection successful');
  },

  async ye5(t) {
    const { proc, port } = await startOnPort(t);
    const client = await RedisClient.connect(t, { port, proc });
    t.log.info(`$ redis-cli -p ${port} INFO replication`);
    t.assertEqual((await info(t, client)).role, 'master', 'role');
    t.log.success('✔︎ role is master');
  },

  async hc6(t) {
    const master = await new FakeMaster(t).start();
    const { proc, port } = await startOnPort(t, ['--replicaof', `127.0.0.1 ${master.port}`]);
    // Keep the master responsive so replicas that already do the handshake don't stall.
    master.accept(8000).then(() => master.handshake(port).catch(() => {}), () => {});
    const client = await RedisClient.connect(t, { port, proc });
    t.log.info(`$ redis-cli -p ${port} INFO replication`);
    t.assertEqual((await info(t, client)).role, 'slave', 'role');
    t.log.success('✔︎ role is slave');
  },

  async xc1(t) {
    const proc = t.spawn([]);
    const client = await RedisClient.connect(t, { proc });
    t.log.info('$ redis-cli INFO replication');
    const fields = await info(t, client);
    t.assertEqual(fields.role, 'master', 'role');
    if (!/^[0-9A-Za-z]{40}$/.test(fields.master_replid || '')) t.fail(`Expected master_replid to be a 40-character alphanumeric string, got ${JSON.stringify(fields.master_replid)}`);
    t.assertEqual(fields.master_repl_offset, '0', 'master_repl_offset');
    t.log.success('✔︎ role, master_replid and master_repl_offset are correct');
  },

  async gl7(t) { await replicaSetup(t, 1); },
  async eh4(t) { await replicaSetup(t, 2); },
  async ju6(t) { await replicaSetup(t, 3); },

  async fj0(t) {
    const { proc, port } = await startOnPort(t);
    const r = await FakeReplica.connect(t, port, proc, 'replica');
    await r.handshake(6380, { upTo: 'replconf' });
  },

  async vm3(t) {
    const { proc, port } = await startOnPort(t);
    const r = await FakeReplica.connect(t, port, proc, 'replica');
    await r.handshake(6380, { upTo: 'psync' });
  },

  async cf8(t) {
    const { proc, port } = await startOnPort(t);
    const r = await FakeReplica.connect(t, port, proc, 'replica');
    await r.handshake(6380, { capa: ['capa', 'eof', 'capa', 'psync2'] });
  },

  async zn8(t) {
    const { replicas: [replica], client } = await masterWithReplicas(t, 1);
    const cmds = [[key(), '1'], [key(), '2'], [key(), '3']].map(([k, v]) => ['SET', k, v]);
    for (const c of cmds) await client.check(c, R.simple('OK'));
    for (const c of cmds) await replica.expectCommand(c);
  },

  async hd5(t) {
    const { replicas, client } = await masterWithReplicas(t, randInt(3, 5));
    const cmds = [[key(), '1'], [key(), '2'], [key(), '3']].map(([k, v]) => ['SET', k, v]);
    for (const c of cmds) await client.check(c, R.simple('OK'));
    for (const r of replicas) for (const c of cmds) await r.expectCommand(c);
  },

  async yg4(t) {
    const { master, proc, port } = await replicaSetup(t);
    const pairs = [[key(), String(randInt(1, 999))], [key(), String(randInt(1, 999))], [key(), String(randInt(1, 999))]];
    master.propagate(...pairs.map(([k, v]) => ['SET', k, v]));
    await t.sleep(200);
    const client = await RedisClient.connect(t, { port, proc, name: 'client' });
    for (const [k, v] of pairs) await client.check(['GET', k], R.bulk(v), { timeout: 2000 });
    if (!(await master.conn.expectNoData(200))) t.fail('The replica must not send responses for propagated commands back to the master');
  },

  async xv6(t) {
    const { master } = await replicaSetup(t);
    master.propagate(['REPLCONF', 'GETACK', '*']);
    await master.expectAck(0);
  },

  async yd3(t) {
    const { master } = await replicaSetup(t);
    // The ACK offset counts the bytes of every propagated command processed before the current GETACK.
    let processed = 0;
    const getack = async () => {
      const sent = master.propagate(['REPLCONF', 'GETACK', '*']);
      await master.expectAck(processed);
      processed += sent;
    };
    await getack();
    processed += master.propagate(['PING']);
    if (!(await master.conn.expectNoData(150))) t.fail('The replica must not respond to a propagated PING');
    await getack();
    processed += master.propagate(['SET', key(), String(randInt(1, 999))], ['SET', key(), String(randInt(1, 999))]);
    await getack();
  },

  async my8(t) {
    const proc = t.spawn([]);
    const client = await RedisClient.connect(t, { proc });
    await client.check(['WAIT', '0', '60000'], R.int(0), { timeout: 1000 });
  },

  async tu8(t) {
    const n = randInt(3, 6);
    const { client } = await masterWithReplicas(t, n, { port: 6379 });
    for (const want of [Math.max(1, n - 2), n, n + 2]) await client.check(['WAIT', String(want), '500'], R.int(n), { timeout: 2000 });
  },

  async na2(t) {
    const n = randInt(3, 5);
    const { replicas, client } = await masterWithReplicas(t, n, { port: 6379 });
    // Replicas read propagated commands; the first `acking` of them answer GETACK with their offset.
    const serve = (acking) => Promise.all(replicas.map(async (r, i) => {
      for (;;) {
        const before = r.offset;
        const cmd = await r.readCommand(3000).catch(() => null);
        if (!cmd) return;
        if (String(cmd[0]).toUpperCase() === 'REPLCONF' && String(cmd[1]).toUpperCase() === 'GETACK') {
          if (i < acking) r.conn.write(encodeCommand(['REPLCONF', 'ACK', String(before)]));
          return;
        }
      }
    }));
    const k1 = randInt(1, n);
    await client.check(['SET', key(), word()], R.simple('OK'));
    const served1 = serve(k1);
    await client.check(['WAIT', String(k1), '2000'], R.int(k1), { timeout: 3000 });
    await served1;
    const k2 = randInt(0, n - 1);
    const served2 = serve(k2);
    await client.check(['SET', key(), word()], R.simple('OK'));
    const started = Date.now();
    await client.check(['WAIT', String(n), '500'], R.int(k2), { timeout: 3000 });
    if (Date.now() - started < 400) t.fail('WAIT returned before its timeout even though not enough replicas acknowledged');
    await served2;
  },
};

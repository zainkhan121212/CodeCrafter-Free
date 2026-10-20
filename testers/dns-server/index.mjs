// DNS server tester: sends DNS queries over UDP to port 2053 and checks the replies.
import dgram from 'node:dgram';
import { UdpClient } from '../../lib/harness/net.mjs';
import { TestFailure } from '../../lib/harness/runner.mjs';
import { buildQuery, buildResponse, parseMessage } from '../../lib/protocols/dns.mjs';
import { word, randInt, pick, shuffle } from '../../lib/harness/random.mjs';

const PORT = 2053;
const TLDS = ['com', 'io', 'org', 'net', 'dev'];
const randomDomain = () => `${word()}.${word()}.${pick(TLDS)}`;

// Sends a query, retrying while the server starts up, and returns the parsed reply.
async function ask(t, proc, query, describe) {
  const client = new UdpClient();
  t.onCleanup(() => client.close());
  t.log.info(`Sending ${describe}`);
  for (let attempt = 0; attempt < 15; attempt++) {
    await client.send(query, PORT);
    const reply = await client.receive(attempt < 3 ? 400 : 700);
    if (reply) {
      t.log.info(`Received ${reply.msg.length}-byte response`);
      try { return parseMessage(reply.msg); } catch (err) { throw new TestFailure(`Response is not a valid DNS packet: ${err.message}`); }
    }
    if (!proc.running) throw new TestFailure('Your program exited before responding');
  }
  throw new TestFailure(`No response received on UDP port ${PORT}`);
}

function expectField(t, name, actual, expected) {
  if (actual !== expected) throw new TestFailure(`Expected ${name} to be ${expected}, got ${actual}`);
}

function checkReplyHeader(t, h, { id, opcode = 0, rd = 0 }) {
  expectField(t, 'ID', h.id, id);
  expectField(t, 'QR', h.qr, 1);
  expectField(t, 'OPCODE', h.opcode, opcode);
  expectField(t, 'AA', h.aa, 0);
  expectField(t, 'TC', h.tc, 0);
  expectField(t, 'RD', h.rd, rd);
  expectField(t, 'RA', h.ra, 0);
  expectField(t, 'Z', h.z, 0);
  expectField(t, 'RCODE', h.rcode, opcode === 0 ? 0 : 4);
  t.log.success('✓ Header is correct');
}

function checkQuestions(t, reply, names) {
  expectField(t, 'QDCOUNT', reply.header.qdcount, names.length);
  names.forEach((name, i) => {
    const q = reply.questions[i];
    if (q.name !== name) throw new TestFailure(`Expected question ${i + 1} name to be ${JSON.stringify(name)}, got ${JSON.stringify(q.name)}`);
    expectField(t, `question ${i + 1} type`, q.type, 1);
    expectField(t, `question ${i + 1} class`, q.cls, 1);
  });
  t.log.success(`✓ Question section is correct (${names.join(', ')})`);
}

function checkAnswers(t, reply, names, ips = null) {
  expectField(t, 'ANCOUNT', reply.header.ancount, names.length);
  names.forEach((name, i) => {
    const a = reply.answers[i];
    if (a.name !== name) throw new TestFailure(`Expected answer ${i + 1} name to be ${JSON.stringify(name)}, got ${JSON.stringify(a.name)}`);
    expectField(t, `answer ${i + 1} type`, a.type, 1);
    expectField(t, `answer ${i + 1} class`, a.cls, 1);
    expectField(t, `answer ${i + 1} RDLENGTH`, a.rdlength, 4);
    if (ips && a.ip !== ips[i]) throw new TestFailure(`Expected answer ${i + 1} to be ${ips[i]} (from the resolver), got ${a.ip}`);
  });
  t.log.success(`✓ Answer section is correct`);
}

export const stages = {
  async ux2(t) {
    const proc = t.spawn();
    await ask(t, proc, buildQuery({ id: 1234, questions: [{ name: 'codecrafters.io' }] }), 'a DNS query to port 2053');
    t.log.success('✓ Received a response over UDP');
  },

  async tz1(t) {
    const proc = t.spawn();
    const reply = await ask(t, proc, buildQuery({ id: 1234, questions: [{ name: 'codecrafters.io' }] }), 'query with ID 1234');
    expectField(t, 'ID', reply.header.id, 1234);
    expectField(t, 'QR', reply.header.qr, 1);
    expectField(t, 'OPCODE', reply.header.opcode, 0);
    expectField(t, 'RCODE', reply.header.rcode, 0);
    t.log.success('✓ Header is correct');
  },

  async bf2(t) {
    const proc = t.spawn();
    const reply = await ask(t, proc, buildQuery({ id: 1234, questions: [{ name: 'codecrafters.io' }] }), 'query for codecrafters.io (A, IN)');
    expectField(t, 'ID', reply.header.id, 1234);
    expectField(t, 'QR', reply.header.qr, 1);
    checkQuestions(t, reply, ['codecrafters.io']);
  },

  async xm2(t) {
    const proc = t.spawn();
    const reply = await ask(t, proc, buildQuery({ id: 1234, questions: [{ name: 'codecrafters.io' }] }), 'query for codecrafters.io (A, IN)');
    expectField(t, 'ID', reply.header.id, 1234);
    checkQuestions(t, reply, ['codecrafters.io']);
    checkAnswers(t, reply, ['codecrafters.io']);
  },

  async uc8(t) {
    const proc = t.spawn();
    for (const opcode of shuffle([0, pick([1, 2])])) {
      const id = randInt(1, 65535), rd = randInt(0, 1);
      const reply = await ask(t, proc, buildQuery({ id, opcode, rd, questions: [{ name: randomDomain() }] }), `query with ID ${id}, OPCODE ${opcode}, RD ${rd}`);
      checkReplyHeader(t, reply.header, { id, opcode, rd });
    }
  },

  async hd8(t) {
    const proc = t.spawn();
    const id = randInt(1, 65535), rd = randInt(0, 1), name = randomDomain();
    const reply = await ask(t, proc, buildQuery({ id, rd, questions: [{ name }] }), `query for ${name}`);
    checkReplyHeader(t, reply.header, { id, rd });
    checkQuestions(t, reply, [name]);
    checkAnswers(t, reply, [name]);
  },

  async yc9(t) {
    const proc = t.spawn();
    const id = randInt(1, 65535), base = `${word()}${word()}.${pick(TLDS)}`;
    const names = [`${word()}.${base}`, `${word()}.${base}`];
    const reply = await ask(t, proc, buildQuery({ id, rd: 1, questions: names.map(name => ({ name })), compress: true }), `query with 2 questions (the second one compressed): ${names.join(', ')}`);
    checkReplyHeader(t, reply.header, { id, rd: 1 });
    checkQuestions(t, reply, names);
    checkAnswers(t, reply, names);
  },

  async gt1(t) {
    // A fake upstream resolver that only answers single-question queries.
    const resolver = dgram.createSocket('udp4');
    const ips = new Map();
    let queries = 0;
    resolver.on('message', (msg, rinfo) => {
      let q;
      try { q = parseMessage(msg); } catch { return; }
      queries++;
      if (q.questions.length !== 1) return;
      const name = q.questions[0].name;
      if (!ips.has(name)) ips.set(name, `${randInt(1, 223)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`);
      resolver.send(buildResponse({ id: q.header.id, rd: q.header.rd, questions: q.questions, answers: [{ name, ip: ips.get(name) }] }), rinfo.port, rinfo.address);
    });
    await new Promise(resolve => resolver.bind(0, '127.0.0.1', resolve));
    t.onCleanup(() => resolver.close());
    const address = `127.0.0.1:${resolver.address().port}`;
    t.log.info(`Started a test resolver at ${address}`);
    const proc = t.spawn(['--resolver', address]);

    const id = randInt(1, 65535), name = randomDomain();
    const reply = await ask(t, proc, buildQuery({ id, rd: 1, questions: [{ name }] }), `query for ${name}`);
    checkReplyHeader(t, reply.header, { id, rd: 1 });
    checkQuestions(t, reply, [name]);
    checkAnswers(t, reply, [name], [ips.get(name)]);
    if (!queries) throw new TestFailure('Your server did not forward the query to the resolver');

    const id2 = randInt(1, 65535), base = `${word()}${word()}.${pick(TLDS)}`;
    const names = [`${word()}.${base}`, `${word()}.${base}`];
    const reply2 = await ask(t, proc, buildQuery({ id: id2, rd: 1, questions: names.map(n => ({ name: n })), compress: true }), `query with 2 questions: ${names.join(', ')}`);
    checkReplyHeader(t, reply2.header, { id: id2, rd: 1 });
    checkQuestions(t, reply2, names);
    checkAnswers(t, reply2, names, names.map(n => ips.get(n)));
  },
};

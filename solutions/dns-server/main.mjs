// Reference DNS server used to verify the DNS server tester. Spoilers!
import dgram from 'node:dgram';
import { parseMessage, encodeHeader, encodeName, buildQuery } from '../../lib/protocols/dns.mjs';

const i = process.argv.indexOf('--resolver');
const resolver = i >= 0 ? process.argv[i + 1].split(':') : null;
const server = dgram.createSocket('udp4');

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

function reply(header, questions, answers) {
  const rcode = header.opcode === 0 ? 0 : 4;
  const parts = [encodeHeader({ id: header.id, qr: 1, opcode: header.opcode, rd: header.rd, rcode, qdcount: questions.length, ancount: answers.length })];
  for (const q of questions) parts.push(encodeName(q.name), u16(1), u16(1));
  for (const a of answers) parts.push(encodeName(a.name), u16(1), u16(1), u32(60), u16(4), Buffer.from(a.ip.split('.').map(Number)));
  return Buffer.concat(parts);
}

function forward(question) {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4');
    const id = Math.floor(Math.random() * 65535);
    sock.on('message', msg => { sock.close(); resolve(parseMessage(msg).answers.map(a => ({ name: a.name, ip: a.ip }))); });
    sock.send(buildQuery({ id, rd: 1, questions: [question] }), Number(resolver[1]), resolver[0]);
  });
}

server.on('message', async (msg, rinfo) => {
  const { header, questions } = parseMessage(msg);
  let answers;
  if (resolver) answers = (await Promise.all(questions.map(forward))).flat();
  else answers = questions.map(q => ({ name: q.name, ip: '8.8.8.8' }));
  server.send(reply(header, questions, answers), rinfo.port, rinfo.address);
});
server.bind(2053, '127.0.0.1');

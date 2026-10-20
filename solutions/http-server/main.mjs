// Reference HTTP server used to verify the HTTP server tester. Spoilers!
import net from 'node:net';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dirIndex = process.argv.indexOf('--directory');
const directory = dirIndex >= 0 ? process.argv[dirIndex + 1] : null;

function response(status, reason, headers = {}, body = null) {
  const lines = [`HTTP/1.1 ${status} ${reason}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  return Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n'), body ?? Buffer.alloc(0)]);
}

async function handle(req) {
  const { method, path, headers, body } = req;
  const extra = headers.connection?.toLowerCase() === 'close' ? { Connection: 'close' } : {};
  const text = (str, status = 200) => {
    let data = Buffer.from(str);
    const h = { 'Content-Type': 'text/plain', ...extra };
    const encodings = (headers['accept-encoding'] || '').split(',').map(s => s.trim());
    if (encodings.includes('gzip')) { data = gzipSync(data); h['Content-Encoding'] = 'gzip'; }
    h['Content-Length'] = data.length;
    return response(status, 'OK', h, data);
  };
  if (path === '/') return response(200, 'OK', extra);
  if (path.startsWith('/echo/')) return text(decodeURIComponent(path.slice(6)));
  if (path === '/user-agent') return text(headers['user-agent'] || '');
  if (path.startsWith('/files/') && directory) {
    const file = join(directory, path.slice(7));
    if (method === 'POST') {
      await writeFile(file, body);
      return response(201, 'Created', extra);
    }
    try {
      const data = await readFile(file);
      return response(200, 'OK', { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length, ...extra }, data);
    } catch {
      return response(404, 'Not Found', extra);
    }
  }
  return response(404, 'Not Found', extra);
}

function parseRequest(buf) {
  const end = buf.indexOf('\r\n\r\n');
  if (end < 0) return null;
  const [line, ...rest] = buf.toString('latin1', 0, end).split('\r\n');
  const [method, path] = line.split(' ');
  const headers = {};
  for (const h of rest) { const i = h.indexOf(':'); headers[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim(); }
  const length = Number(headers['content-length'] || 0);
  if (buf.length < end + 4 + length) return null;
  return { req: { method, path, headers, body: buf.subarray(end + 4, end + 4 + length) }, size: end + 4 + length };
}

net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  let chain = Promise.resolve();
  socket.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const parsed = parseRequest(buffer);
      if (!parsed) break;
      buffer = buffer.subarray(parsed.size);
      chain = chain.then(async () => {
        socket.write(await handle(parsed.req));
        if (parsed.req.headers.connection?.toLowerCase() === 'close') socket.end();
      });
    }
  });
  socket.on('error', () => {});
}).listen(4221, '127.0.0.1');

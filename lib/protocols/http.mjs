// Minimal HTTP/1.1 message codec for the HTTP server tester.

// Parses one response from the start of `buf`. Returns { value, length } or null if incomplete.
// Without Content-Length the body is treated as empty (the tester never sends requests that need chunking).
export function parseResponse(buf) {
  const end = buf.indexOf('\r\n\r\n');
  if (end < 0) return null;
  const head = buf.toString('latin1', 0, end);
  const [statusLine, ...lines] = head.split('\r\n');
  const m = statusLine.match(/^(HTTP\/\d\.\d) (\d{3})(?: (.*))?$/);
  if (!m) throw new Error(`Invalid status line: ${JSON.stringify(statusLine)} (expected e.g. "HTTP/1.1 200 OK")`);
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) throw new Error(`Invalid header line: ${JSON.stringify(line)}`);
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  let length = 0;
  if (headers['content-length'] !== undefined) {
    length = Number(headers['content-length']);
    if (!Number.isInteger(length) || length < 0) throw new Error(`Invalid Content-Length: ${JSON.stringify(headers['content-length'])}`);
  }
  if (buf.length < end + 4 + length) return null;
  const body = Buffer.from(buf.subarray(end + 4, end + 4 + length));
  return { value: { version: m[1], status: Number(m[2]), reason: m[3] || '', headers, body, statusLine }, length: end + 4 + length };
}

export function buildRequest(method, path, headers = {}, body = null) {
  const lines = [`${method} ${path} HTTP/1.1`];
  const all = { Host: 'localhost:4221', ...headers };
  if (body !== null && all['Content-Length'] === undefined) all['Content-Length'] = String(Buffer.byteLength(body));
  for (const [k, v] of Object.entries(all)) lines.push(`${k}: ${v}`);
  return Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n'), body === null ? Buffer.alloc(0) : Buffer.from(body)]);
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './content.mjs';

export function unifiedDiff(before, after) {
  const a = before.trimEnd().split('\n'), b = after.trimEnd().split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    const old = i + 1, next = j + 1;
    if (i < a.length && j < b.length && a[i] === b[j]) lines.push({ kind: ' ', text: a[i++], old, next }), j++;
    else if (j < b.length && (i === a.length || dp[i][j + 1] > dp[i + 1][j])) lines.push({ kind: '+', text: b[j++], old, next });
    else lines.push({ kind: '-', text: a[i++], old, next });
  }
  const ranges = [];
  lines.forEach((line, n) => {
    if (line.kind === ' ') return;
    const start = Math.max(0, n - 3), end = Math.min(lines.length, n + 4), last = ranges.at(-1);
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  });
  return ['--- a/app/main.py', '+++ b/app/main.py', ...ranges.flatMap(({ start, end }) => {
    const chunk = lines.slice(start, end);
    const oldCount = chunk.filter(l => l.kind !== '+').length, newCount = chunk.filter(l => l.kind !== '-').length;
    return [`@@ -${lines[start].old - (oldCount ? 0 : 1)},${oldCount} +${lines[start].next - (newCount ? 0 : 1)},${newCount} @@`, ...chunk.map(l => l.kind + l.text)];
  })].join('\n') + '\n';
}

const cache = new Map();
export function pythonAnswers(course) {
  if (cache.has(course)) return cache.get(course);
  if (course !== 'redis') return [];
  let source = readFileSync(join(root, 'content/courses/redis/starters/python/app/main.py'), 'utf8').replaceAll('\r\n', '\n');
  const answers = [];
  const step = (stage, explanation, edits) => {
    const before = source;
    for (const [old, next] of edits) {
      if (!source.includes(old)) throw new Error(`Python base mismatch: ${stage}`);
      source = source.replace(old, next);
    }
    if (source === before) throw new Error(`Empty Python answer: ${stage}`);
    answers.push({ stage, explanation, previousStage: answers.at(-1)?.stage ?? null,
      diff: unifiedDiff(before, source), before, source });
  };
  step('jm1', 'Uncomment these two lines to listen on port 6379 and accept a client connection.', [[
    '    # server_socket = socket.create_server(("localhost", 6379))\n    # server_socket.accept() # wait for client',
    '    server_socket = socket.create_server(("localhost", 6379))\n    server_socket.accept() # wait for client']]);
  step('rg2', 'Read the request from the accepted connection, then send PONG as a RESP simple string ending in CRLF.', [[
    '    server_socket.accept() # wait for client',
    '    connection, _ = server_socket.accept()\n    with connection:\n        connection.recv(1024)\n        connection.sendall(b"+PONG\\r\\n")']]);
  step('wy1', 'Keep reading requests on the same connection until the client disconnects. This stage handles individual PING requests; ECHO will introduce a buffered RESP reader.', [[
    '        connection.recv(1024)\n        connection.sendall(b"+PONG\\r\\n")',
    '        while connection.recv(1024):\n            connection.sendall(b"+PONG\\r\\n")']]);
  step('zu2', 'Give each client its own thread so waiting for one client does not block other clients.', [
    ['import socket  # noqa: F401', 'import socket\nimport threading'],
    ['\n\ndef main():', '\n\ndef serve_client(connection):\n    with connection:\n        while connection.recv(1024):\n            connection.sendall(b"+PONG\\r\\n")\n\n\ndef main():'],
    ['    connection, _ = server_socket.accept()\n    with connection:\n        while connection.recv(1024):\n            connection.sendall(b"+PONG\\r\\n")',
      '    while True:\n        connection, _ = server_socket.accept()\n        threading.Thread(target=serve_client, args=(connection,), daemon=True).start()']]);
  step('qq0', 'Parse a RESP array using a buffered socket reader, then return the ECHO argument as a bulk string. Reading by byte length handles spaces and fragmented TCP data. PING keeps its existing response.', [
    ['\n\ndef serve_client(connection):', String.raw`

def read_command(reader):
    header = reader.readline()
    if not header:
        return None
    arguments = []
    for _ in range(int(header[1:])):
        size = int(reader.readline()[1:])
        arguments.append(reader.read(size))
        reader.read(2)  # trailing CRLF
    return arguments


def bulk(value):
    return b"$" + str(len(value)).encode() + b"\r\n" + value + b"\r\n"


def execute(arguments):
    command = arguments[0].upper()
    if command == b"PING":
        return b"+PONG\r\n"
    if command == b"ECHO":
        return bulk(arguments[1])
    return b"-ERR unknown command\r\n"


def serve_client(connection):`],
    ['    with connection:\n        while connection.recv(1024):\n            connection.sendall(b"+PONG\\r\\n")',
      '    with connection, connection.makefile("rb") as reader:\n        while (arguments := read_command(reader)) is not None:\n            connection.sendall(execute(arguments))']]);
  step('la7', 'Store keys and values in a shared dictionary. SET returns OK. GET returns a bulk string, or a null bulk string when the key is missing.', [
    ['import threading', 'import threading\n\nvalues = {}'],
    ['    return b"-ERR unknown command\\r\\n"', String.raw`    if command == b"SET":
        values[arguments[1]] = arguments[2]
        return b"+OK\r\n"
    if command == b"GET":
        value = values.get(arguments[1])
        return b"$-1\r\n" if value is None else bulk(value)
    return b"-ERR unknown command\r\n"`]]);
  step('yz1', 'Store an optional expiry alongside each value. PX uses milliseconds; EX uses seconds. Compare against a monotonic clock on GET. Overwriting a key also replaces its expiry.', [
    ['import threading', 'import threading\nimport time'],
    ['        values[arguments[1]] = arguments[2]', '        deadline = None\n        if len(arguments) > 4:\n            seconds = int(arguments[4]) / (1000 if arguments[3].upper() == b"PX" else 1)\n            deadline = time.monotonic() + seconds\n        values[arguments[1]] = (arguments[2], deadline)'],
    ['        value = values.get(arguments[1])\n        return b"$-1\\r\\n" if value is None else bulk(value)', '        value, deadline = values.get(arguments[1], (None, None))\n        if deadline is not None and time.monotonic() >= deadline:\n            return b"$-1\\r\\n"\n        return b"$-1\\r\\n" if value is None else bulk(value)']]);
  cache.set(course, answers);
  return answers;
}

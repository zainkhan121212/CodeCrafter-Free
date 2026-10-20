// Local dashboard server. Read-only and bound to loopback: it never runs code.
// Tests run in the learner's terminal (`ccfree test`); this server tails the run logs and streams them live.
import http from 'node:http';
import { readFile, readdir, stat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { root, listCourses, getCourse } from './lib/content.mjs';
import { readProgress, listRuns, readRunEvents, runsDir, home } from './lib/store.mjs';

const ASSETS = {
  '/': ['app/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['app/style.css', 'text/css; charset=utf-8'],
  '/render.mjs': ['lib/render.mjs', 'text/javascript; charset=utf-8'],
  '/vendor/marked.esm.js': ['app/vendor/marked.esm.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['app/favicon.svg', 'image/svg+xml'],
};

const testerCache = new Map();
async function testedStages(slug) {
  if (!testerCache.has(slug)) {
    try {
      const mod = await import(pathToFileURL(join(root, 'testers', slug, 'index.mjs')).href);
      testerCache.set(slug, Object.keys(mod.stages || {}));
    } catch {
      testerCache.set(slug, []);
    }
  }
  return testerCache.get(slug);
}

// Tails every runs/*.events.jsonl file and broadcasts new events to SSE clients.
function createLiveFeed() {
  const clients = new Set();
  const offsets = new Map();
  let primed = false;
  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const files = (await readdir(runsDir()).catch(() => [])).filter(f => f.endsWith('.events.jsonl'));
      for (const f of files) {
        const full = join(runsDir(), f);
        const { size } = await stat(full).catch(() => ({ size: 0 }));
        const from = offsets.get(f) ?? (primed ? 0 : size);
        offsets.set(f, from);
        if (size <= from) continue;
        const fh = await open(full, 'r');
        const buf = Buffer.alloc(size - from);
        await fh.read(buf, 0, buf.length, from);
        await fh.close();
        const text = buf.toString('utf8');
        const lastNewline = text.lastIndexOf('\n');
        if (lastNewline < 0) continue;
        offsets.set(f, from + Buffer.byteLength(text.slice(0, lastNewline + 1)));
        const runId = f.replace('.events.jsonl', '');
        for (const line of text.slice(0, lastNewline).split('\n')) {
          if (!line) continue;
          const payload = `data: ${JSON.stringify({ runId, ...JSON.parse(line) })}\n\n`;
          for (const res of clients) res.write(payload);
        }
      }
      primed = true;
    } catch { /* keep polling */ } finally { busy = false; }
  }
  const timer = setInterval(poll, 250);
  poll();
  return {
    add(res) {
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    close() { clearInterval(timer); for (const res of clients) res.end(); },
  };
}

export function createServer() {
  const live = createLiveFeed();
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, {
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    // Only answer requests addressed to loopback (defends against DNS rebinding).
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '')) return send(403, { error: 'Forbidden host' });
    if (req.method !== 'GET') return send(405, { error: 'The dashboard is read-only. Run tests with `ccfree test` in your terminal.' });
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(400, { error: 'Bad URL' }); }

    try {
      if (path === '/api/courses') {
        const courses = await Promise.all(listCourses().map(async c => ({
          slug: c.slug, name: c.name, title: c.title, shortDescription: c.shortDescription, languages: c.languages,
          stageCount: c.stages.length, testedCount: (await testedStages(c.slug)).length,
          extensions: c.extensions.map(e => ({ slug: e.slug, name: e.name, count: c.stages.filter(s => s.extension === e.slug).length })),
        })));
        return send(200, courses);
      }
      const courseMatch = path.match(/^\/api\/courses\/([\w-]+)$/);
      if (courseMatch) {
        const course = getCourse(courseMatch[1]);
        if (!course) return send(404, { error: 'Unknown course' });
        return send(200, { ...course, tested: await testedStages(course.slug) });
      }
      if (path === '/api/progress') return send(200, { home: home(), projects: Object.values((await readProgress()).projects) });
      if (path === '/api/runs') return send(200, await listRuns(100));
      const eventsMatch = path.match(/^\/api\/runs\/([\w-]+)\/events$/);
      if (eventsMatch) {
        const events = await readRunEvents(eventsMatch[1]);
        return events ? send(200, events) : send(404, { error: 'Unknown run' });
      }
      if (path === '/api/live') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        live.add(res);
        return;
      }
      if (ASSETS[path]) {
        const [file, type] = ASSETS[path];
        return send(200, await readFile(join(root, file)), type);
      }
      return send(404, { error: 'Not found' });
    } catch (err) {
      return send(500, { error: String(err.message || err) });
    }
  });
  server.on('close', () => live.close());
  return server;
}

// Listens on `port`, or the next free port if it is taken (up to 20 tries).
export async function startServer({ port = 4317, host = '127.0.0.1' } = {}) {
  for (let attempt = 0; ; attempt++) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port + attempt, host, resolve);
      });
      return { server, url: `http://${host}:${server.address().port}` };
    } catch (err) {
      server.close();
      if (err.code !== 'EADDRINUSE' || attempt >= 19 || port === 0) throw err;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer({ port: Number(process.env.PORT || 4317) });
  console.log(`CodeCrafter Free dashboard: ${url}`);
}

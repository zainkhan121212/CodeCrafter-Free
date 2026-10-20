#!/usr/bin/env node
// Maintainer tool: imports the MIT-licensed CodeCrafters course definitions,
// stage descriptions and starter repositories into content/.
//
//   git clone --depth 1 https://github.com/codecrafters-io/build-your-own-redis <dir>/redis   (repeat per course)
//   npm i --no-save yaml
//   node scripts/import-upstream.mjs <dir>
//
// Testers are NOT imported: CodeCrafter Free ships its own cross-platform testers in testers/.
import { readFile, writeFile, mkdir, readdir, cp, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { parse } = await import('yaml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(process.argv[2] || '');
const COURSES = ['redis', 'http-server', 'shell', 'grep', 'interpreter', 'git', 'sqlite', 'bittorrent', 'dns-server', 'kafka', 'claude-code'];
const SKIP_STARTER_FILES = new Set(['README.md', 'codecrafters.yml']);
const out = join(root, 'content', 'courses');

const isComment = line => /^\s*#/.test(line);
const isBlankOrComment = line => /^\s*(#.*)?$/.test(line);

// Replaces the upstream comment header (everything before the first command) with our own,
// and drops comments that only describe the upstream hosted workflow.
function rewriteScript(text, header) {
  const lines = text.replace(/\r\n/g, '\n').replace(/codecrafters-build-/g, 'ccfree-build-').split('\n');
  const [shebang, ...rest] = lines;
  const firstCommand = rest.findIndex(l => !isBlankOrComment(l));
  const body = rest.slice(firstCommand < 0 ? rest.length : firstCommand)
    .filter(l => !(isComment(l) && /codecrafters|copied from|edit this to change|edit \.ccfree/i.test(l)))
    .map(l => l.replace(/\s+#.*$/, ''))
    .filter(l => !/^\s*#\s*$/.test(l));
  return [shebang, '#', header, '', ...body].join('\n').replace(/\n{3,}/g, '\n\n');
}

const provenance = [];
for (const slug of COURSES) {
  const src = join(upstream, slug);
  const def = parse(await readFile(join(src, 'course-definition.yml'), 'utf8'));
  const descFiles = await readdir(join(src, 'stage_descriptions'));
  const stages = [];
  for (const s of def.stages) {
    const file = descFiles.find(f => f.endsWith(`-${s.slug}.md`));
    if (!file) throw new Error(`${slug}: no description for stage ${s.slug}`);
    stages.push({
      slug: s.slug,
      name: s.name,
      difficulty: s.difficulty || 'medium',
      extension: s.primary_extension_slug || null,
      marketing: (s.marketing_md || '').trim(),
      description: (await readFile(join(src, 'stage_descriptions', file), 'utf8')).replace(/\r\n/g, '\n').trim(),
    });
  }

  // Canonical order: base stages, then each extension's stages in the order extensions are listed.
  const extOrder = (def.extensions || []).map(e => e.slug);
  const rank = s => (s.extension ? extOrder.indexOf(s.extension) : -1);
  stages.sort((a, b) => rank(a) - rank(b));

  const starterRoot = join(src, 'compiled_starters');
  const languages = (await readdir(starterRoot)).filter(l => def.languages.some(x => x.slug === l)).sort();
  const dest = join(out, slug);
  await rm(join(dest, 'starters'), { recursive: true, force: true });
  for (const lang of languages) {
    const dir = join(dest, 'starters', lang);
    await cp(join(starterRoot, lang), dir, {
      recursive: true,
      filter: p => !SKIP_STARTER_FILES.has(p.slice(join(starterRoot, lang).length + 1)),
    });
    // Upstream build scripts live in .codecrafters/; ours live in .ccfree/.
    const from = join(dir, '.codecrafters');
    if (await stat(from).catch(() => null)) {
      await mkdir(join(dir, '.ccfree'), { recursive: true });
      for (const f of await readdir(from)) {
        const header = f === 'compile.sh'
          ? '# Compiles your program. ccfree runs this once before the tests start.'
          : '# Runs your program. ccfree starts this for every test instance.';
        await writeFile(join(dir, '.ccfree', f), rewriteScript(await readFile(join(from, f), 'utf8'), header));
      }
      await rm(from, { recursive: true });
    }
    // SO_REUSEPORT does not exist on Windows; Python already sets SO_REUSEADDR on POSIX.
    const py = join(dir, 'app', 'main.py');
    if (await stat(py).catch(() => null))
      await writeFile(py, (await readFile(py, 'utf8')).replace(', reuse_port=True', ''));
    const local = join(dir, 'your_program.sh');
    if (await stat(local).catch(() => null))
      await writeFile(local, rewriteScript(await readFile(local, 'utf8'),
        '# Runs your program locally: compiles it (if needed), then executes it with the given arguments.'));
  }

  const course = {
    slug,
    name: def.name.replace(/^Build your own /, ''),
    title: def.name,
    shortDescription: def.short_description_md.trim(),
    description: def.description_md.trim(),
    releaseStatus: def.release_status,
    languages,
    extensions: (def.extensions || []).map(e => ({ slug: e.slug, name: e.name, description: e.description_markdown.trim() })),
    stages,
  };
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'course.json'), JSON.stringify(course, null, 1) + '\n');
  const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  provenance.push(`| ${slug} | [build-your-own-${slug}@${commit.slice(0, 7)}](https://github.com/codecrafters-io/build-your-own-${slug}/tree/${commit}) | ${stages.length} | ${languages.length} |`);
  console.log(`${slug}: ${stages.length} stages, ${course.extensions.length} extensions, ${languages.length} starters`);
}

const license = await readFile(join(upstream, 'redis', 'LICENSE'), 'utf8');
const fence = '```';
await writeFile(join(root, 'content', 'UPSTREAM.md'), `# Imported course content

Stage lists, stage descriptions and starter code under \`content/courses/\` are imported from the
open-source CodeCrafters course repositories, which are published under the MIT License (reproduced below).
They were imported with \`scripts/import-upstream.mjs\`. Starter READMEs and CodeCrafters config files are
not imported, and build scripts are moved from \`.codecrafters/\` to \`.ccfree/\`.

The testers that grade your code are **not** imported. CodeCrafter Free ships its own cross-platform testers in \`testers/\`.

CodeCrafter Free is an independent project and is not affiliated with or endorsed by CodeCrafters.

| Course | Source commit | Stages | Starter languages |
| --- | --- | --- | --- |
${provenance.join('\n')}

## License of the imported content

${fence}
${license.trim()}
${fence}
`);

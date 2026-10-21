// Course catalog loaded from content/courses/<slug>/course.json (imported from upstream, see content/UPSTREAM.md).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COURSE_ORDER = ['redis', 'http-server', 'shell', 'grep', 'interpreter', 'git', 'sqlite', 'bittorrent', 'dns-server', 'kafka', 'claude-code'];

const cache = new Map();

export function getCourse(slug) {
  if (!COURSE_ORDER.includes(slug)) return null;
  if (!cache.has(slug)) {
    const course = JSON.parse(readFileSync(join(root, 'content', 'courses', slug, 'course.json'), 'utf8'));
    course.languages = ['python'];
    course.stages.forEach((s, i) => { s.number = i + 1; });
    cache.set(slug, course);
  }
  return cache.get(slug);
}

export const listCourses = () => COURSE_ORDER.map(getCourse);

export function findStage(course, slug) {
  return course.stages.find(s => s.slug === slug) || null;
}

export function starterDir(courseSlug, language) {
  const dir = join(root, 'content', 'courses', courseSlug, 'starters', language);
  return existsSync(dir) ? dir : null;
}

export function starterLanguages(courseSlug) {
  return readdirSync(join(root, 'content', 'courses', courseSlug, 'starters'));
}

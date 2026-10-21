// Browser-compatible helpers shared by the CLI and the dashboard.

const LANGUAGE_NAMES = {
  c: 'C', clojure: 'Clojure', cpp: 'C++', crystal: 'Crystal', csharp: 'C#', dart: 'Dart', elixir: 'Elixir',
  gleam: 'Gleam', go: 'Go', haskell: 'Haskell', java: 'Java', javascript: 'JavaScript', kotlin: 'Kotlin',
  ocaml: 'OCaml', odin: 'Odin', php: 'PHP', python: 'Python', ruby: 'Ruby', rust: 'Rust', scala: 'Scala',
  swift: 'Swift', typescript: 'TypeScript', zig: 'Zig',
};
export const languageName = slug => LANGUAGE_NAMES[slug] || slug;

export function latestStageRun(runs, course, stage, projectDir) {
  if (!projectDir) return null;
  const normalize = path => {
    const value = String(path).replaceAll('\\', '/').replace(/\/$/, '');
    return /^[a-z]:\//i.test(value) ? value.toLowerCase() : value;
  };
  return runs.find(run => run.course === course && run.stages?.includes(stage) &&
    normalize(run.project) === normalize(projectDir)) || null;
}

// Stage descriptions use a small Mustache subset: {{#lang_is_go}}...{{/lang_is_go}},
// inverted {{^...}} sections, {{#reader_is_bot}} and {{language_name}}.
export function renderTemplate(markdown, { language = null } = {}) {
  const truthy = key => key === `lang_is_${language}`;
  let text = markdown;
  for (let i = 0; i < 5; i++) {
    const next = text.replace(/\{\{([#^])([\w]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_, kind, key, body) =>
      (kind === '#') === truthy(key) ? body : '');
    if (next === text) break;
    text = next;
  }
  return text.replace(/\{\{language_name\}\}/g, language ? languageName(language) : 'your language')
    .replace(/codecrafters test/g, 'ccfree test')
    .replace(/\n{3,}/g, '\n\n');
}

// Base stages followed by the enabled extensions' stages (all extensions, in course order, by default).
export function orderedStages(course, extensions = null) {
  const enabled = extensions ?? course.extensions.map(e => e.slug);
  return [
    ...course.stages.filter(s => !s.extension),
    ...enabled.flatMap(ext => course.stages.filter(s => s.extension === ext)),
  ];
}

// Current stage = first stage, in order, that is not completed.
export function currentStage(course, completed = {}, extensions = null) {
  return orderedStages(course, extensions).find(s => !completed[s.slug]) || null;
}

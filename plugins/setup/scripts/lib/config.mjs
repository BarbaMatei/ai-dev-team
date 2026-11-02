const KIT_PLUGINS = ['guardrails', 'review', 'test-quality', 'spec-upkeep', 'metrics', 'browser', 'e2e', 'ui-review', 'architect', 'setup'];
const COMMON_IGNORE = ['.env', '.env.*', '!.env.example', '*.log', '.DS_Store', 'Thumbs.db', '.idea/', '.vs/'];

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function browser(answers, stacks) {
  const boot = [];
  for (const s of answers.stacks) {
    const b = stacks[s.id].boot[s.role];
    if (b) boot.push({ name: s.role, command: b.command, cwd: s.dir, ready: b.ready });
  }
  const web = boot.find((b) => b.name === 'web');
  return { baseUrl: web ? web.ready : 'http://localhost:3000', boot };
}

export function renderConfig(answers, stacks, version) {
  const tests = {};
  for (const s of answers.stacks) {
    const { command, ...rest } = stacks[s.id].test;
    tests[s.role] = { command, cwd: s.dir, ...rest };
  }
  const cfg = { tests, testLock: true, testGuard: true, rulesDir: '.claude/rules', triggers: [], bugs: { label: 'bug' }, metrics: { since: 1 } };
  if (answers.stacks.some((s) => s.role === 'web')) cfg.browser = browser(answers, stacks);
  if (answers.release === 'kit') cfg.release = { packages: answers.stacks.map((s) => s.dir), tag: '{name}-v{version}' };
  const { name, language, owner, ownerType, visibility, release, releaseRef } = answers;
  cfg.setup = { name, language, owner, ownerType, visibility, stacks: answers.stacks, release, ...(releaseRef ? { releaseRef } : {}), version };
  return json(cfg);
}

export function renderSettings() {
  const enabledPlugins = { 'superpowers@claude-plugins-official': true };
  for (const p of KIT_PLUGINS) enabledPlugins[`${p}@ai-dev-team`] = true;
  return json({
    enabledPlugins,
    extraKnownMarketplaces: { 'ai-dev-team': { source: { source: 'github', repo: 'BarbaMatei/ai-dev-team' } } },
  });
}

export function renderEditorconfig(answers, stacks) {
  const root = answers.stacks.find((s) => s.dir === '.');
  const base = root ? stacks[root.id].indent : 2;
  let out = `root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\nindent_style = space\nindent_size = ${base}\n`;
  for (const s of answers.stacks) if (s !== root) out += `\n[${s.dir}/**]\nindent_size = ${stacks[s.id].indent}\n`;
  return out;
}

export function renderGitignore(answers, stacks) {
  const lines = new Set(COMMON_IGNORE);
  for (const s of answers.stacks) for (const l of stacks[s.id].gitignore) lines.add(l);
  return `${[...lines].join('\n')}\n`;
}

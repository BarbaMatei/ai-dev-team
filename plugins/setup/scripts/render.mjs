import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnswersError, validate } from './lib/answers.mjs';
import { ciJobNames as jobNames, renderCi } from './lib/ci.mjs';
import { renderConfig, renderEditorconfig, renderGitignore, renderSettings } from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
const template = (name) => fs.readFileSync(path.join(root, 'templates', name), 'utf8').replace(/\r\n/g, '\n');

function fill(text, values) {
  return text
    .replace(/^[ \t]*\{\{(\w+)\}\}\n/gm, (m, k) => (values[k] === '' ? '' : m))
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
}

export function ciJobNames(answers) {
  return jobNames(validate(answers, readJson('stacks.json')));
}

export function renderFiles(input) {
  const stacks = readJson('stacks.json');
  const version = readJson('.claude-plugin', 'plugin.json').version;
  const a = validate(input, stacks);
  const values = {
    name: a.name,
    language: a.language,
    releaseRef: a.releaseRef ?? '',
    sshKeyLine: a.ownerType === 'User' ? 'ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}' : '',
  };
  const files = [
    ['CLAUDE.md', fill(template('CLAUDE.md'), values)],
    ['.claude/ai-dev-team.json', renderConfig(a, stacks, version)],
    ['.claude/settings.json', renderSettings()],
    ['.claude/rules/.gitkeep', ''],
    ['.githooks/pre-commit', template('.githooks/pre-commit')],
    ['.github/workflows/ci.yml', renderCi(a, stacks)],
    ['.github/workflows/secret-scan.yml', template('.github/workflows/secret-scan.yml')],
    ['.github/workflows/release.yml', fill(template(`.github/workflows/${a.release === 'kit' ? 'release-kit' : 'release'}.yml`), values)],
    ['.github/pull_request_template.md', template('.github/pull_request_template.md')],
    ['.editorconfig', renderEditorconfig(a, stacks)],
    ['.gitignore', renderGitignore(a, stacks)],
  ];
  if (a.release === 'semantic-release') files.push(['.releaserc.json', template('.releaserc.json')]);
  return files.map(([p, content]) => ({ path: p, content })).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

function main(argv) {
  const [answersFile, outDir] = argv;
  if (!answersFile || !outDir) throw new AnswersError('setup: usage: node render.mjs <answers.json> <out-dir>');
  let answers;
  try {
    answers = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  } catch (e) {
    throw new AnswersError(`setup: cannot read ${answersFile} as JSON`);
  }
  const files = renderFiles(answers);
  for (const f of files) {
    const target = path.join(outDir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, { mode: f.path === '.githooks/pre-commit' ? 0o755 : 0o644 });
    console.log(`file ${f.path}`);
  }
}

const direct = (() => {
  try {
    return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (direct) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof AnswersError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
}

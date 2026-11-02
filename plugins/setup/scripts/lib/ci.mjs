import path from 'node:path';

const FOUND = "if: steps.project.outputs.found == 'true'";

export function ciJobNames(answers) {
  return answers.stacks.map((s) => s.role);
}

const block = (cmd, pad) => `${pad}run: |\n${cmd.split('\n').map((l) => `${pad}  ${l}`).join('\n')}\n`;

function job(stack, def) {
  const probe = def.projectFile.map((f) => path.posix.join(stack.dir, f)).join(' ');
  const lines = [
    `  ${stack.role}:`,
    `    name: ${stack.role}`,
    '    runs-on: ubuntu-latest',
    '    defaults:',
    '      run:',
    '        shell: bash',
    `        working-directory: ${stack.dir}`,
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - id: project',
    '        name: Look for the project file',
    '        working-directory: .',
    `        run: if ls ${probe} >/dev/null 2>&1; then echo "found=true" >> "$GITHUB_OUTPUT"; fi`,
    `      - ${FOUND}`,
    `        uses: ${def.ci.setup.uses}`,
    '        with:',
    ...Object.entries(def.ci.setup.with).map(([k, v]) => `          ${k}: ${JSON.stringify(v)}`),
  ];
  let out = `${lines.join('\n')}\n`;
  for (const s of def.ci.steps) out += `      - name: ${s.name}\n        ${FOUND}\n${block(s.run, '        ')}`;
  return out;
}

export function renderCi(answers, stacks) {
  const head = 'name: ci\non:\n  pull_request:\n  push:\n    branches-ignore: [main]\npermissions:\n  contents: read\njobs:\n';
  return head + answers.stacks.map((s) => job(s, stacks[s.id])).join('');
}

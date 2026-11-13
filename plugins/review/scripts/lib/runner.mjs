const NO_TEST = [
  /No test matches the given testcase filter/,
  /No test is available/,
  /No test files found/,
  /No tests found/,
  /^\s*Tests\s+\d+ skipped \(\d+\)/,
];

export function ranNoTest(text) {
  return text.split(/\r?\n/).some((l) => NO_TEST.some((re) => re.test(l)));
}

const NAME = { dotnet: /^\s*Failed (\S+)/, vitest: /^\s*(?:FAIL|×)\s+(.+?)(?:\s+\d+\s*ms)?$/ };

export function failingTests(text, format) {
  const re = NAME[format];
  if (!re) return [];
  const names = [...new Set(text.split(/\r?\n/).map((l) => re.exec(l)?.[1]).filter(Boolean))];
  return names.length > 5 ? [...names.slice(0, 5), '…'] : names;
}

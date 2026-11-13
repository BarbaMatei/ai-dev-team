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

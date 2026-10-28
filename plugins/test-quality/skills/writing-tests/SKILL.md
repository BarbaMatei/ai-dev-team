---
name: writing-tests
description: Use when writing or changing a test. The rules that let a test catch a bug - one visible behaviour per test, mocks only at boundaries, every assertion able to fail, hand-written expected values, no wall clock, scoped runs.
---

# Writing tests

A test earns its place only if it goes red when the behaviour it names breaks. Test-first (red, green, refactor) is superpowers' `test-driven-development` skill; it is not repeated here. When the branch's tests are done, the `check-tests` skill flags tests that break these rules.

## Rules

1. A test proves one behaviour a caller can see: a return value, a state change, a response, a stored row, a message sent to a boundary.
2. Mock only boundaries (network, clock, randomness, file system, external services, gateways, third-party SDKs); never the code under test or a real in-process collaborator.
3. Every assertion must be able to fail: break the line it guards and the test must go red. The review plugin's `mutate-check` does this in one command.
4. Write expected values out by hand (`105`, not `price * 1.05`); never compute them with the production code.
5. Name the test after the behaviour, in plain words: `rejects a negative quantity`, not `Test1` or `ValidateWorks`.
6. No sleeps and no wall clock: inject time (a fake clock you set).
7. Put the test beside the existing tests for that code, in their style (framework, helpers, naming).
8. Run it scoped (the new test, then the tests of the code you touched); never the whole suite by default.

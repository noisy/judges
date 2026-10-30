# Changelog

## Unreleased

### Rules
- A rule can be a directory: `<rules dir>/<id>/RULE.md`, with the directory name as its id. A directory without `RULE.md` is reported as an invalid rule. A file and a directory with the same id in one rules directory is a usage error (exit 2) that names both.
- `check` and `command` are no longer rule fields. A rule that sets either is invalid, and the other rules still run.

### Rule tests
- Rule tests replace the fixtures of 0.2.0: `<id>.fixtures/` and `rule-expect` lines are gone. A rule directory keeps its tests in `tests/`. A test is a directory with `test.yaml`, or a single Markdown file with the expected result in its frontmatter and the code in `## <path>` blocks.
- The code of a test is `repo/` with an optional `change.patch` (a review of the patch, or an audit of `repo/`), `base` and `head` (a review of real history), or `commit` (an audit of one commit). History tests use a temporary checkout and never touch the working tree or the index.
- The expected result is `expect: findings | clean`, with optional `must`, `must_not` and `count`. A failed test gets a reason code: `invalid`, `did-not-run`, `missed`, `false-positive`, `must`, `must-not` or `count`. A broken test fails as `invalid` without a model call.
- `judge test --json` prints one entry per test: `rule`, `test`, `mode`, `status` (`passed`, `failed` or `skipped`), `reason`, `findings` and `run`.
- A review leaves out `<rules dir>/*/tests/**`, so a rule never flags its own tests.

### Markers
- New names: `rule-exception: <id> -- <reason>` and `rule-debt: <id> -- <reason>`. `rule-ignore` and `rule-todo` are still read as aliases.
- The judge decides what a marker covers. The prompt lists each marker at its own line with its whole reason, and the judge returns a violation a marker accounts for with `covered_by`. `--json` lists those findings in the rule's new `covered` array and counts them in `suppressed`. A `covered_by` that names no marker from the prompt covers nothing. The line-level and file-level coverage rules are gone.
- A reason may go on over several comment lines. Markers inside docstrings and block comments, and on ` * ` lines, are read. `judge markers` shows them too.

## 0.2.0 (2026-10-30)

The first release with rules. A rule is one Markdown file: settings in the frontmatter, the rule text in the body.
judges runs each rule against a change or a set of files with a coding-agent CLI (`claude -p` by default), and
reports where the code breaks it.

### Rules
- Load flat rule files from `--rules <dir>`. The flag can repeat, and a later directory overrides a rule by id.
- `--only <id>` runs only the named rules. An unknown id is a usage error.
- An invalid rule appears in the report with status `error` and the reason. The other rules still run.
- Rule fields:
  - `scope`: path globs. A negated glob (`!x`) excludes files.
  - `context`: `diff` (only the changed hunks), `file` (whole files, the default) or `repo` (an agent that may read the whole repository). `mode: one-shot | agent` still works as an alias.
  - `model`: `small`, `medium` or `large`, or an exact model id.
  - `budget`: time and cost caps, plus `max_turns` for agent rules.
  - `severity`: low, medium or high. It decides blocking, not the model's own severity.
  - `stage`: `commit`, `push` or `ci`. `--stage <stage>` runs only that gate's rules.
  - `allow_read`: lets an agent rule read named directories outside the repository.

### Input
- `--staged`, `--diff` and `--last-commit`, as before.
- New: `--base <ref>` reviews a branch against its merge base with `<ref>`, the way a merge request pipeline sees it.
- File names with spaces and non-ASCII characters work in diff modes. Binary files are skipped.

### Results
- `--json` prints one result per rule. It includes status, findings, cost, turns, the files given to the model, and what an agent rule read.
- On a diff, one-shot findings outside the added lines are dropped. Only new problems count. The record shows how many were dropped (`outsideDiff`).
- Entries in which the model says the code follows the rule are dropped (`dismissed`).
- `--fail-on <severity>` blocks at or above that severity. Without it judges only advises.
- `--format gitlab|sarif|junit --output <path>` writes CI reports. The flags can repeat in pairs.
- The answer parser accepts prose around the JSON, code fences, `{"findings": [...]}` and a single finding.

### Markers
- `rule-ignore: <id> -- <reason>` and `rule-todo: <id> -- <reason>` comments mark accepted exceptions and known debt. Findings they cover are dropped and counted.
- `judge markers` lists every marker in the repository, grouped by rule. A marker without a reason is a finding.

### Rule tests
- `judge test` runs each rule on its fixtures in `<rules dir>/<id>.fixtures/`. A violation fixture must produce a finding, and a pass fixture must produce none.

### Sandbox
- Rules run with a minimal, read-only configuration: no MCP servers, no user settings, no write or network tools. Secret files are always denied.

### Exit codes
- 0: the run completed, advisory.
- 1: `--fail-on` blocked, or a rule test failed.
- 2: a usage error, such as an unknown flag value, a missing rules directory, nothing staged, or an unknown base ref.

### Coming next
The judges-bench spec has moved ahead of this release:
- markers are renamed to `rule-exception` and `rule-debt`, and the model decides what a marker covers
- a rule can be a directory (`<id>/RULE.md`) with `tests/` next to it
- `check` and `command` are no longer rule fields

These changes come in a later release.

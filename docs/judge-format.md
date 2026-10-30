# Judge Format Specification (v1)

Each `JUDGE.md` file defines an independent AI evaluator in `judge-cli`. The file requires a strict YAML Frontmatter header, followed by the Markdown prompt instructions.

## Frontmatter Fields

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | - | Display name of the judge in the UI. |
| `description` | `string` | **Yes** | - | A short description explaining what the judge evaluates. |
| `version` | `string` | **Yes** | - | Semantic versioning format (e.g. `1.0.0`). Strictly validated. |
| `mode` | `'one-shot' \| 'agent'` | No | `'one-shot'` | `one-shot` sees only the text it is given; `agent` may read the repository. See [Agent judges](#agent-judges). |
| `timeout_seconds` | `number` | No | `30` | Execution timeout in seconds. Must be a positive integer. |

`JUDGE.md` files also accept the rule settings below (`scope`, `severity`, `model`, `budget`, `tools`, `max_turns`).

## Minimal Valid `JUDGE.md` Example

```markdown
---
name: Magic Numbers
description: Detects unexplained raw numbers in code.
version: 1.0.0
---

Analyze the following code for randomly placed, hard-coded numbers that are not assigned to a named constant.
```

## Full Example with Optional Fields

```markdown
---
name: SRP Validator
description: Spots variables or functions combining multiple, unrelated responsibilities.
version: 1.2.0
mode: one-shot
timeout_seconds: 45
---

Evaluate the code for Single Responsibility Principle (SRP) violations.
- Functions should do one thing.
- Classes should have only one reason to change.
```

## Rule Files

Deviations from a rule are marked in the code with `rule-ignore` / `rule-todo` markers; see [markers.md](markers.md).

A rule is a Markdown file `<dir>/<id>.md`, or a directory `<dir>/<id>/` that holds the rule in `RULE.md` and its [tests](#testing-rules) in `tests/`. Rules are loaded from every directory passed with `--rules <dir>` (repeatable); a later directory overrides a rule with the same id, and rules override `JUDGE.md` judges with the same id. The body holds the instructions: an `Intent` in one sentence, then the rule.

- Only `<dir>/*.md` and `<dir>/*/RULE.md` are rules. Rules are not searched for deeper, so the `.md` files of a rule's tests are never rules. Other files, and directories whose name starts with `.`, are ignored.
- A directory without `RULE.md` is reported as an invalid rule under the directory name, so a rule moved into a directory without a rename does not stop running in silence.
- A file `<id>.md` and a directory `<id>/` in the same rules directory is a usage error (exit code `2`) that names both paths: nothing can tell which one is meant.
- `check` and `command` are not rule fields. Every rule is checked by a model and judges runs no commands, so a rule that sets either is invalid. A check that a linter or a test can do belongs in the linter or the test.

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | - | Must match the file name without `.md`, or for `RULE.md` the directory name. |
| `name` | `string` | No | `id` | Display name. |
| `description` | `string` | No | `''` | Short summary. |
| `version` | `string` | No | `''` | Semver, validated when present. |
| `scope` | `string[]` | No | `["**/*"]` | Path globs the rule applies to. |
| `stage` | `'commit' \| 'push' \| 'ci'` | No | `'commit'` | The gate the rule runs at. `--stage commit` and `--stage push` run only their own rules and report the others as skipped; `--stage ci`, or no `--stage`, runs every rule. Never derived from the model or budget. |
| `severity` | `'low' \| 'medium' \| 'high'` | No | `'medium'` | Severity of a violation. |
| `model` | `string` | No | engine default | Alias (`small`, `medium`, `large`) or an exact model id. |
| `budget` | `string` | No | - | Time and cost caps, e.g. `30s, $0.10` or `2m`. Either part is optional. The time part sets `timeout_seconds`; setting both is an error. |
| `mode` | `'one-shot' \| 'agent'` | No | `'one-shot'` | Same as for `JUDGE.md`. |
| `tools` | `string[]` | No | agent: `[Read, Grep, Glob]` | Only with `mode: agent`. Read-only tools only: `Read`, `Grep`, `Glob`. |
| `allow_read` | `string[]` | No | `[]` | Only with `mode: agent`. Directories outside the repo the judge may read. See [Reading outside the repo](#reading-outside-the-repo). |
| `max_turns` | `number` | No | agent: `8` | Turn cap. Must be a positive integer. |
| `timeout_seconds` | `number` | No | `30`, agent: `120` | Same as for `JUDGE.md`. |

```markdown
---
id: one-call-per-connector
scope: ["src/connectors/**/*.py"]
severity: high
model: small
budget: 30s, $0.10
---
Intent: a connector is a thin adapter to one external service.
Rule: one HTTP call per public function; no calls to other connector functions; no branching on domain data.
```

## Agent judges

`mode` is the single switch. A `one-shot` judge gets the rule, the files in scope and the diff, and answers from that text alone. An `agent` judge gets the same, then may read other files, search and list directories (sibling modules, tests, imports) before it answers. It reports only violations in the changed files in scope.

```markdown
---
id: connector-has-integration-test
mode: agent
scope: ["src/connectors/**/*.py"]
severity: medium
model: small
budget: 90s, $0.25
---
Intent: every connector has an integration test.
```

- **Defaults.** `tools: [Read, Grep, Glob]`, `max_turns: 8`, and a 120 s timeout when neither `budget` nor `timeout_seconds` sets one.
- **Validation.** `tools` on a one-shot judge is an error. A tool outside `Read`, `Grep`, `Glob` is an error on any judge: judges are read-only by construction.
- **Engines.** Only `claude` runs agent judges. `codex` and `gemini` report the judge as an error, `agent mode not supported by <engine>`, never a silent one-shot run.
- **Working directory.** The repository root: the git root, or `--root <dir>` (file input only). File paths are shown relative to it. One-shot judges run in a temp dir, so no repository `CLAUDE.md` reaches them.
- **Known limitation: the repository's `CLAUDE.md`.** Agent judges run in the repository root, so the CLI auto-loads that repository's own `CLAUDE.md`, which can influence the judge. `--bare` would stop it, but it also turns off OAuth and keychain login, so it is not used.
- **Committed content.** The files in the prompt are what is being committed (the staged content in `--staged` mode). The judge is told the files on disk may differ.
- **Line numbers.** In both modes file contents are shown as `  17| code` and the judge reports those numbers, so findings land on the lines markers cover.
- **Run record.** The result lists the files given in the prompt as `inline: [paths]` (every judge), and every tool call as `examined: [{ tool, target, denied? }]`. The summary line shows counts, e.g. `(read 2 files, 4 searches)`; `--json` has the full list.

### Sandbox

Every claude judge runs with:

| Flag | Why |
| :--- | :--- |
| `--tools <list>` | Only the rule's read-only tools exist in the session; one-shot judges get none. |
| `--restricted` | Confines `Read`, `Grep` and `Glob` to the working directory. Absolute paths, `../` and symlinks pointing out of it are refused, whatever the settings allow. |
| `--permission-mode dontAsk`, `--permission-prompts none` | Anything not pre-approved is denied at once instead of waiting for an answer, so a print-mode run never hangs on a prompt. |
| `--disallowedTools Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch` | Write, exec and network tools stay out even if `--tools` ever named one. |
| `--settings '{"permissions":{...}}'` | Deny rules for secrets on every run, plus the allow rules for `allow_read`. |
| `--add-dir <dir>` | One per `allow_read` directory; nothing otherwise. |
| `--strict-mcp-config`, `--setting-sources ''`, `--no-session-persistence` | Minimal configuration: no MCP servers, hooks, settings or sessions inherited from the developer. |

Verified on claude 2.1.282 with a canary file in `/tmp`: an agent judge told to read it, glob for it, or reach it through `../` or a symlink was refused each time (the calls show up as `denied` in `examined`), while reading files in the repository worked. A judge told to create a file had no tool to do it, and no file was created. Runs took 12 to 18 seconds; none waited on a prompt.

### Reading outside the repo

Repo only is the default. Services often live side by side in one parent folder, and a judge may need a sibling, for example to check how the API a connector calls is really shaped. `allow_read` names those directories:

```markdown
---
id: client-matches-billing-api
mode: agent
scope: ["src/clients/billing/**/*.py"]
allow_read: ["../billing-service/**", "../shared-contracts/**"]
---
Intent: the billing client calls endpoints the billing service really exposes, with the fields it really expects.
```

- **Forms.** Relative to the repo root (`../billing-service`), absolute (`/srv/contracts`) or home (`~/contracts`), optionally ending in `/**`. Each entry is a whole directory: the sandbox grants whole directories, so a narrower glob such as `../billing-service/*.py` is a validation error rather than a promise it cannot keep.
- **Mapping.** Each directory joins the working directories with `--add-dir`, and a matching `Read(//<dir>/**)` allow rule goes into `--settings`. `--restricted` still refuses everything else outside the repo.
- **Secrets floor.** On every run, whitelisted or not, reads matching `**/.env*`, `**/.ssh/**`, `**/.aws/**`, `**/.claude*/**`, `**/*.pem` or `**/*key*.json` are denied, and Grep skips those files. The list is `SECRET_DENY_PATTERNS` in `src/engines/claude.ts`.
- **Run record.** `examined` shows reads outside the repo with their full path, so a use of the whitelist is visible.

Verified on claude 2.1.282 with a repo and a whitelisted sibling side by side in `/tmp`, twice: `../billing/docs/api.txt` in the sibling was read; `../billing/.env` and `../billing/docs/service-key.json` were denied; a Grep over the sibling for the canary text in those two files found nothing; a canary file in `/tmp` outside both stayed denied. None of the denied canary strings appeared in the output.

## Validating Judges

You can programmatically evaluate all your loaded judges (both global and local) to ensure their frontmatter schemas are correct and complete.

### Validate All Judges 
\`\`\`bash
judge config --check
judge config --check --rules rules
\`\`\`
Checks every loaded judge and rule. Exits `0` if all are valid, exits `1` and prints the nested error stack if any are invalid.

### Validate a Specific Judge
\`\`\`bash
judge config --check naming-conventions
\`\`\`
Only validates the judge whose directory matches exactly \`naming-conventions\`.

## Testing rules

A rule with tests is a directory, `<dir>/<id>/RULE.md`, and its tests live in `<dir>/<id>/tests/`. Each test is some code and the result the rule must give on it. `judge test` runs the rule on each test and says which ones pass. Run it when you write a rule, when you change its text, and when the model or the engine changes. A rule in a single file, `<id>.md`, has no tests.

```
rules/
  comments-explain-why.md                 a rule in one file: no tests
  no-print-calls/
    RULE.md                               the rule
    tests/
      prints-total/                       review: repo/ and a patch
        test.yaml
        change.patch
        repo/src/app.py
      old-prints/                         audit: repo/ only
        test.yaml
        repo/src/app.py
      mr-41/test.yaml                     review of real history: base and head
      audit-v2/test.yaml                  audit of real history: commit
      prints-in-loop.md                   a single-file test
```

Each directory with a `test.yaml` and each `.md` file in `tests/` is one test, named after the directory or the file without `.md`. Other files and hidden entries are ignored.

### Where the code comes from

A directory test takes its code from exactly one of these:

| The test has | Mode | What the rule reviews |
| :--- | :--- | :--- |
| `repo/` and `change.patch` | review | the change in the patch, applied to a copy of `repo/` with `git apply` |
| `repo/` only | audit | every file in `repo/` |
| `base` and `head` in `test.yaml` | review | `base...head` of the repository `judge test` runs in, checked out at `head` |
| `commit` in `test.yaml` | audit | every file of that repository at `commit` |

- `change.patch` is the output of `git diff`.
- `base`, `head` and `commit` are any commit-ish git resolves: a commit id, a branch, a tag. Quote a commit id made only of digits. The commits must be in the local clone; a shallow CI clone may not have them.
- A history test reads the commit into a temporary directory through a temporary index. It never touches the working tree, the index or the checked-out branch, and uncommitted edits are not part of the test. The rule text is the one on disk now, so the test checks today's rule against old code.

A single-file test holds everything in one Markdown file:

````markdown
---
expect: findings
must:
  - file: src/report.py
    lines: 3
---
A loop that prints each line. This note is for people; the model never sees it.

## src/report.py
```python
def write_report(lines):
    pass
```

## change
```diff
diff --git a/src/report.py b/src/report.py
--- a/src/report.py
+++ b/src/report.py
@@ -1,2 +1,3 @@
 def write_report(lines):
-    pass
+    for line in lines:
+        print(line)
```
````

- The frontmatter is the expected result.
- `## <path>` and the code block after it is one file of the repository. `## change` and a `diff` block is the change: with it the test is a review, without it an audit.
- Any other text is a note for people. It never reaches the model.

### The expected result

The whole `test.yaml`, or the frontmatter of a single-file test:

| Field | Value | Meaning |
| :--- | :--- | :--- |
| `expect` | `findings` or `clean` | required: must the rule report something? |
| `must` | list of `{ file, lines }` | each place needs at least one finding |
| `must_not` | list of `{ file, lines }` | no finding may be at these places |
| `count` | a number, or `{ min, max }` | how many findings |

`lines` is a line number or `[first, last]`; leave it out to mean the whole file. A finding is at a place when it is in that file and its lines overlap. Findings that no field mentions are allowed; a test that wants none elsewhere says so with `count`.

### How a test runs, and its verdict

Each test is its own run of its rule alone, in a temporary copy, with the rule's own scope, context, model, mode, budget and markers. Paths are relative to the root of the test's repository. `## Examples` in `RULE.md` reaches the model as in a review.

A test passes only when the rule ran with status `ok` and every field of the expected result holds. A failed test gets a reason that starts with the code of the first check that fails:

| Code | When |
| :--- | :--- |
| `invalid` | the test itself is broken; the rule did not run |
| `did-not-run` | the rule ended with status `error`, `timeout` or `skipped` (for example no file in its scope) |
| `missed` | `expect: findings`, but there is no finding |
| `false-positive` | `expect: clean`, but there is a finding |
| `must` | a place in `must` has no finding |
| `must-not` | a finding is at a place in `must_not` |
| `count` | the number of findings is outside `count` |

A test is invalid, and fails without a model call, when its YAML does not parse, `expect` is missing or wrong, a field is unknown (a typo like `must_nt`), `expect: clean` comes with `must` or `count`, a place has no `file` or bad `lines`, a directory test has no code source or more than one, only one of `base` and `head` is given, `change.patch` has no `repo/`, a directory in `tests/` has no `test.yaml`, a single-file test has `base`, `head` or `commit`, `## change` has no `diff` block, the patch does not apply, or a commit-ish does not resolve. A broken test is never skipped, because a skipped test looks the same as a passing one. The tests of an invalid rule fail with `did-not-run`.

```bash
judge test --rules rules
judge test --rules rules --only no-print-calls --json
```

Without `--json`, one line per test: `✔ <rule>/<test> (review)`, `✘ <rule>/<test> (audit): <reason>` or `○ <rule>: skipped (no tests)`, then a count of each status. A rule without tests is skipped and does not fail the run. `judge test` exits `0` when no test failed, `1` when one failed, and `2` on a usage error, such as an unknown `--only` id or a missing rules directory. `--rules`, `--only` and `--engine` work as in a review.

`--json` prints an array with one entry per test, sorted by rule id and then test name:

```json
[
  { "rule": "comments-explain-why", "test": null, "mode": null, "status": "skipped", "reason": "no tests", "findings": [], "run": null },
  {
    "rule": "no-print-calls", "test": "prints-in-loop", "mode": "review", "status": "failed",
    "reason": "missed: expected findings, got none", "findings": [],
    "run": { "status": "ok", "durationMs": 812, "costUsd": 0.002, "turns": 1, "inline": ["src/report.py"] }
  }
]
```

`status` is `passed`, `failed` or `skipped`, `reason` is null for a passed test, and `findings` have paths relative to the test's repository. `run` holds the fields of a review result (`status`, `durationMs`, `costUsd`, `turns`, `inline`, `examined`, `error`, `skipReason`, ...); it is null when the rule was never started: a rule without tests, or an invalid test.

### A review never reviews tests

A test holds code that breaks its rule on purpose. So every review leaves out the files under `<dir>/*/tests/` of every `--rules` directory, in every input mode and whatever the rule's scope says. A rule with a wide scope does not flag its own test when someone commits it.

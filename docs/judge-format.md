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

`JUDGE.md` files also accept the rule settings below (`scope`, `severity`, `check`, `model`, `budget`, `tools`, `max_turns`, `command`).

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

A rule is a flat Markdown file `<dir>/<id>.md`, loaded from every directory passed with `--rules <dir>` (repeatable). Rules override `JUDGE.md` judges with the same id. The body holds the instructions: an `Intent` in one sentence, then the rule.

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | - | Must match the file name without `.md`. |
| `name` | `string` | No | `id` | Display name. |
| `description` | `string` | No | `''` | Short summary. |
| `version` | `string` | No | `''` | Semver, validated when present. |
| `scope` | `string[]` | No | `["**/*"]` | Path globs the rule applies to. |
| `severity` | `'low' \| 'medium' \| 'high'` | No | `'medium'` | Severity of a violation. |
| `check` | `'judge' \| 'deterministic'` | No | `'judge'` | `deterministic` rules are never sent to a model. |
| `command` | `string` | No | - | Script or test for a `deterministic` rule. Only allowed with `check: deterministic`. |
| `model` | `string` | No | engine default | Alias (`small`, `medium`, `large`) or an exact model id. |
| `budget` | `string` | No | - | Time and cost caps, e.g. `30s, $0.10` or `2m`. Either part is optional. The time part sets `timeout_seconds`; setting both is an error. |
| `mode` | `'one-shot' \| 'agent'` | No | `'one-shot'` | Same as for `JUDGE.md`. |
| `tools` | `string[]` | No | agent: `[Read, Grep, Glob]` | Only with `mode: agent`. Read-only tools only: `Read`, `Grep`, `Glob`, `LS`. |
| `max_turns` | `number` | No | agent: `8` | Turn cap. Must be a positive integer. |
| `timeout_seconds` | `number` | No | `30`, agent: `120` | Same as for `JUDGE.md`. |

```markdown
---
id: one-call-per-connector
scope: ["src/connectors/**/*.py"]
severity: high
check: judge
model: small
budget: 30s, $0.10
---
Intent: a connector is a thin adapter to one external service.
Rule: one HTTP call per public function; no calls to other connector functions; no branching on domain data.
```

```markdown
---
id: lint
check: deterministic
command: npm run lint
---
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
- **Validation.** `tools` on a one-shot judge is an error. A tool outside `Read`, `Grep`, `Glob`, `LS` is an error on any judge: judges are read-only by construction.
- **Engines.** Only `claude` runs agent judges. `codex` and `gemini` report the judge as an error, `agent mode not supported by <engine>`, never a silent one-shot run.
- **Working directory.** The repository root: the git root, or `--root <dir>`. File paths are shown relative to it. One-shot judges run in a temp dir, so no repository `CLAUDE.md` reaches them.
- **Committed content.** The files in the prompt are what is being committed (the staged content in `--staged` mode). The judge is told the files on disk may differ.
- **Line numbers.** In both modes file contents are shown as `  17| code` and the judge reports those numbers, so findings land on the lines markers cover.
- **Run record.** Every tool call is recorded in the result as `examined: [{ tool, target, denied? }]`. The summary line shows counts, e.g. `(read 2 files, 4 searches)`; `--json` has the full list.

### Sandbox

Every claude judge runs with:

| Flag | Why |
| :--- | :--- |
| `--tools <list>` | Only the rule's read-only tools exist in the session; one-shot judges get none. |
| `--restricted` | Confines `Read`, `Grep` and `Glob` to the working directory. Absolute paths, `../` and symlinks pointing out of it are refused, whatever the settings allow. |
| `--permission-mode dontAsk`, `--permission-prompts none` | Anything not pre-approved is denied at once instead of waiting for an answer, so a print-mode run never hangs on a prompt. |
| `--disallowedTools Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch` | Write, exec and network tools stay out even if `--tools` ever named one. |
| `--strict-mcp-config`, `--setting-sources ''`, `--no-session-persistence` | Minimal configuration: no MCP servers, hooks, settings or sessions inherited from the developer. |

Verified on claude 2.1.282 with a canary file in `/tmp`: an agent judge told to read it, glob for it, or reach it through `../` or a symlink was refused each time (the calls show up as `denied` in `examined`), while reading files in the repository worked. A judge told to create a file had no tool to do it, and no file was created. Runs took 12 to 18 seconds; none waited on a prompt.

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

# Judge Format Specification (v1)

Each `JUDGE.md` file defines an independent AI evaluator in `judge-cli`. The file requires a strict YAML Frontmatter header, followed by the Markdown prompt instructions.

## Frontmatter Fields

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | - | Display name of the judge in the UI. |
| `description` | `string` | **Yes** | - | A short description explaining what the judge evaluates. |
| `version` | `string` | **Yes** | - | Semantic versioning format (e.g. `1.0.0`). Strictly validated. |
| `mode` | `'one-shot' \| 'agent'` | No | `'one-shot'` | Execution mode. Currently `one-shot` is supported. `agent` triggers a fallback warning. |
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
| `tools` | `string[]` | No | `[]` | Read-only tools for the judge. Empty means one-shot. |
| `max_turns` | `number` | No | - | Turn cap. Must be a positive integer. |
| `timeout_seconds` | `number` | No | `30` | Same as for `JUDGE.md`. |

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

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

## Validating Judges

You can programmatically evaluate all your loaded judges (both global and local) to ensure their frontmatter schemas are correct and complete.

### Validate All Judges 
\`\`\`bash
judge config --check
\`\`\`
Checks every loaded judge. Exits `0` if all are valid, exits `1` and prints the nested error stack if any are invalid.

### Validate a Specific Judge
\`\`\`bash
judge config --check naming-conventions
\`\`\`
Only validates the judge whose directory matches exactly \`naming-conventions\`.

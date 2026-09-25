# Creating Custom Judges

Judges are the core intelligence modules of the `judge-cli`. Instead of maintaining a single, massive API prompt that tries to "review everything," `judge-cli` uses multiple, hyper-focused Judges that run in parallel.

A Judge is simply a Markdown file named `JUDGE.md` placed in a unique directory.

## 📁 Location

Judges can be defined at two levels:
1. **Global Judges**: Available across all projects on your machine.
   `~/.judge/judges/<judge-id>/JUDGE.md`
2. **Local Judges**: Specific to a single repository. Local Judges override Global Judges if they share the same `<judge-id>` directory name.
   `./.judge/judges/<judge-id>/JUDGE.md`

*(The `<judge-id>` is simply the name of the folder containing the `JUDGE.md` file).*

## 📏 Rule Files

A rule is a single Markdown file named after its id, kept in any directory (for example `rules/` in your repository) and loaded with `--rules`:

```bash
judge --staged --rules rules
```

`--rules` can be repeated. A rule overrides a judge with the same id. The frontmatter needs only `id` (matching the file name); `scope`, `severity`, `check`, `mode`, `model`, `budget`, `tools`, `allow_read` and `max_turns` are optional. `mode: agent` lets the judge read the repository with read-only tools; see [Agent judges](docs/judge-format.md#agent-judges). See [docs/judge-format.md](docs/judge-format.md#rule-files) for every field.

```markdown
---
id: booleans-read-as-questions
severity: low
budget: 30s, $0.05
---
Intent: a boolean name reads as a yes/no question, so a condition reads as a sentence.
Rule: every boolean is named as a question, starting with `is`, `has`, `should`, `can`, `was` or `needs`.
```

## ⚙️ Supported Frontmatter Options

`judge-cli` requires YAML Frontmatter at the very top of your `JUDGE.md` file to configure the UI and metadata for the Judge. The Frontmatter is enclosed between triple dashes (`---`).

| Key | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | The human-readable Display Name shown in the animated CLI spinner (e.g., `SRP Validator`). |
| `description` | `string` | No | A short summary of what this Judge specializes in. Useful for documentation and sharing Judges with your team. |

## ✍️ The Prompt Body (Instructions)

Everything below the frontmatter serves as the core system instructions for the LLM. 

When your Git Diff or file code is evaluated, the LLM receives your instructions, followed by the code it needs to analyze. 

### Best Practices for Writing Prompts

1. **Be Hyper-Specific**: Don't write a "Clean Code" judge. Write an "SRP Validator", a "Magic Numbers Detector", or a "Dependency Injection Reviewer". Focused judges hallucinate less and run faster.
2. **Set Strict Rules**: Tell the AI exactly what constitutes a violation in your codebase.
3. **No Formatting Instructions Needed**: You do **not** need to tell the AI to "output JSON" or explain the JSON schema. `judge-cli` handles wrapping your prompt with strict schema enforcement automatically behind the scenes. Just focus on the code rules!

## 📝 Example `JUDGE.md`

```markdown
---
name: Naming Conventions
description: Catches variables and functions that use single-letter names or break camelCase.
---

Evaluate the provided code strictly for naming convention violations. 

### Rules:
1. All variables and functions MUST be written in strict \`camelCase\`.
2. Do not allow single-letter variable names (e.g. \`x\`, \`i\`, \`data\`), except in traditional \`for\` loops.
3. Booleans should be prefixed with \`is\`, \`has\`, or \`should\`.

Flag any issue breaking these 3 rules.
```

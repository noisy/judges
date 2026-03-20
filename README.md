# Judge: The AI-Powered Code Quality Assistant

**Judge** is a fast, pluggable CLI tool that uses Small/Large Language Models to review your code against specific, focused rules. Instead of a single monolithic "Clean Code" prompt, Judge uses multiple specialized AI agents in parallel (e.g., SRP Validator, DRY Principle, Documentation Reviewer) to evaluate your git diffs or specific files.

## Features
- **Parallel Evaluation**: Evaluates all your judges concurrently for blazing fast results.
- **Progressive Disclosure UI**: Beautiful terminal spinners that summarize issues natively using `--short`, `--top X`, or `--full`.
- **JSON Output**: Fully parsable output (`--json`) built for AI Agents (like Claude Code) to use in their workflows.
- **Git Hook Ready**: Easy to drop into Husky for automated pre-commit code reviews.
- **Pluggable Judges**: Easy YAML + Markdown definitions (`JUDGE.md`) to add custom rules for your specific team or project.

---

## Installation

Install globally via NPM:

```bash
npm install -g judge-cli
```

Once installed globally, the `judge` command is available everywhere.

*(Alternatively, to install locally per-project, run `npm install --save-dev judge-cli` and map it via `npx judge` or NPX scripts).*

---

## Usage Mode

**1. Git Diff Mode**
By default, running `judge` evaluates your currently staged Git changes.

```bash
judge
```

**2. File Mode**
You can also point it at specific files instead of the git diff:

```bash
judge --file src/index.ts
judge -f src/index.ts src/utils.ts
```

**Options:**
- `--short`, `-s`: Only show the summarization line per judge (0 issues detailed).
- `--full`: Show all issues found by judges.
- `--top <X>`: Show the top X issues per judge (Default: 3).
- `--json`, `-j`: Output results in exact JSON format (for agents).
- `--help`, `-h`: Show the help message.

---

## Defining Custom Judges

Judges are simply Markdown files named `JUDGE.md` located in `~/.judge/judges/<judge-name>/` (global) or `./.judge/judges/<judge-name>/` (project local).

They follow a structure heavily inspired by AI Skills, utilizing YAML Frontmatter for configuration and Markdown for the system prompt.

👉 **[Read the full guide on Creating Custom Judges and Supported Frontmatter Options](./CREATING_JUDGES.md)**

The system will automatically discover any `JUDGE.md` files in those directories and run them in parallel.

---

## 🚦 The "Green, Refactor" Workflow (Recommended)

By default, `judge-cli` is **non-blocking**. Even if it finds high severity code smells, it will exit gracefully (Exit Code `0`).

We highly recommend connecting Judges to your Git `post-commit` hook. This enforces a "Green -> Refactor" workflow:
1. You make the code work and commit it.
2. The `post-commit` hook instantly triggers the Judges to evaluate what you just committed using the `--last-commit` flag.
3. You review the AI feedback, refactor the code based on the insights, and make a follow-up commit.

**Setup in Husky (`.husky/post-commit`):**
```sh
npx judge --last-commit
```

### Strict Gatekeeper Mode (`--fail-on`)

If you want the judges to act as rigid gatekeepers that physically block code from entering your repository, you can move them to a `pre-commit` hook and enforce the `--fail-on` flag:

**Setup in Husky (`.husky/pre-commit`):**
```sh
npm run test
npx judge --staged --fail-on high
```

The `--fail-on` flag accepts:
- `high`: Blocks commit if any `High` severity issue is found.
- `medium` (or `med`): Blocks on `High` or `Medium` severity.
- `low`: Blocks on virtually any issue found.

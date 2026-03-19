# Judge: The AI-Powered Code Quality Assistant

**Judge** is a fast, pluggable CLI tool that uses Small/Large Language Models to review your code against specific, focused rules. Instead of a single monolithic "Clean Code" prompt, Judge uses multiple specialized AI agents in parallel (e.g., SRP Validator, DRY Principle, Documentation Reviewer) to evaluate your git diffs or specific files.

## Features
- **Parallel Evaluation**: Evaluates all your judges concurrently for blazing fast results.
- **Progressive Disclosure UI**: Beautiful terminal spinners that summarize issues natively using `--short`, `--top X`, or `--full`.
- **JSON Output**: Fully parsable output (`--json`) built for AI Agents (like Claude Code) to use in their workflows.
- **Git Hook Ready**: Easy to drop into Husky for automated pre-commit code reviews.
- **Pluggable Judges**: Easy YAML + Markdown definitions (`JUDGE.md`) to add custom rules for your specific team or project.

---

## Installation & Setup

Since this is a Node.js project, you should first install dependencies:

```bash
npm install
npm run build
```

### Setting up a Local Alias
To make it easy to run `judge` anywhere without typing the full path to `node`, you can create a local alias in your shell (`~/.bashrc` or `~/.zshrc`):

```bash
alias judge="node $(pwd)/dist/index.js"
```
After adding this, restart your terminal or run `source ~/.zshrc`. You can now run `judge` in any directory!

*(Alternatively, you can link the package globally using `npm link` if you've configured the `bin` field in `package.json`.)*

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

They follow a structure heavily inspired by AI Skills. The frontmatter defines metadata, and the body provides instructions.

**Example `srp/JUDGE.md`:**
```markdown
---
name: SRP Validator
description: Spots variables or functions combining multiple, unrelated responsibilities.
---

Evaluate the code for Single Responsibility Principle (SRP) violations.
- Functions should do one thing.
- Classes should have only one reason to change.
- Look for "God modules" or functions with `and` in their names.
```

The system will automatically discover any `JUDGE.md` files in those directories and run them in parallel.

---

## Automated Pre-Commit Workflow

We highly recommend using Husky or another Git hook manager to automate `judge`.

**Fast Pre-Commit Hook (`.husky/pre-commit`):**
```bash
# Run judge on staged files using the fast --short mode
npx tsx src/index.ts --short
```
This blocks bad code from being committed and encourages continuous, incremental quality improvements.

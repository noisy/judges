# AI Judges PoC

This is the PoC for the `judge` CLI tool. It runs pluggable LLMs on git diffs or specific files to evaluate code quality, according to `JUDGE.md` files.

## Installation

```bash
git clone https://github.com/noisy/judges.git
cd judges
npm install
npm run build
npm link
```

## Usage

You must have the `claude` CLI installed and authenticated (i.e. Anthropic CLI), as the PoC shells out to `claude -p` for model execution.

There are two modes: diff mode (default) and file mode.

### Diff Mode (Default)
It uses `git diff HEAD` to extract your changes and pipes them to the AI judges.

```bash
judge
```

### File Mode
Specify a target file or multiple files.

```bash
judge --file src/index.ts
judge -f src/index.ts -f package.json
```

### JSON Output
By default, the output is human-readable. If you are an agent and want to parse the results, use the `--json` flag.

```bash
judge --json
```

## Judges Directory

Judges are discovered automatically from two locations:
1. `~/.judge/judges/`
2. `./.judge/judges/`

Each judge should be placed in its own directory containing a `JUDGE.md` file. For example:
```
./.judge/judges/code-quality/JUDGE.md
```

### `JUDGE.md` Format
The skill description must contain YAML frontmatter and a markdown body.
```markdown
---
name: Code Quality Judge
description: Reviews code for best practices
---
Please review the code carefully and provide detailed feedback...
```

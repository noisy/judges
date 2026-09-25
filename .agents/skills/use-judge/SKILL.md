---
name: Use Judge CLI
description: How to use the 'judge' CLI tool to auto-evaluate and review code changes during a task.
---

# Use Judge CLI

The user has a custom AI-powered code review tool called `judge`. This tool acts as a panel of specialized expert judges (like SRP Validator, Naming Conventions, Documentation Reviewer, etc.) that evaluate code changes locally before committing.

## When to use this skill
- Before you submit code for human review.
- After making significant structural changes to the codebase.
- Whenever you feel like getting a second opinion on the code quality of your task.
- Before committing changes (although a pre-commit hook may automatically run this anyway).

## How to use the CLI

The project provides an alias `judge` that maps to the built distribution.
If the alias is not loaded in your environment, you can run it via `npx tsx <path-to-judge-workspace>/src/index.ts` or `node <path-to-judge-workspace>/dist/index.js` assuming you know the path to the judge tool. Often the user runs it globally or sets up an NPM script.

### 1. Evaluate your Staged Changes (Diff Mode)
By default, running `judge` evaluates whatever is currently staged or unstaged in `git diff`.
Use the `--json` flag to get output in a format you (the AI) can easily parse!
```bash
judge --json
```

### 2. Evaluate Specific Files
If you just want to review a single file you touched, run it with the `--file` flag:
```bash
judge --file src/components/Button.tsx --json
```

## Parsing the Output

When you run with `--json`, it outputs one result per judge, which look like:
```json
[
  {
    "judgeId": "srp",
    "displayName": "SRP Validator",
    "file": "/path/to/.judge/judges/srp/JUDGE.md",
    "status": "ok",
    "issues": [
      {
        "file": "src/components/Button.tsx",
        "line": "45-60",
        "severity": "medium",
        "message": "This component combines data fetching and presentation. Separate into a container."
      }
    ],
    "durationMs": 8421
  },
  {
    "judgeId": "architecture",
    "displayName": "Architecture Reviewer",
    "file": "/path/to/.judge/judges/architecture/JUDGE.md",
    "status": "timeout",
    "issues": [],
    "durationMs": 30004,
    "error": "claude CLI timed out after 30 seconds."
  }
]
```

`status` is `ok`, `error` or `timeout`. Only `ok` results carry issues; for `error` and `timeout` the judge did not run, so read `error` and do not treat it as a code finding.

## Your Responsibility
If you receive issues from the `judge` CLI, you MUST:
1. Read the parsed JSON issues.
2. Consider if the critique is valid.
3. If it is valid, proactively modify the code to address those concerns.
4. Run the judges again to verify your fixes!

This process of "self-correction via AI Judges" will result in much higher quality code for the user.

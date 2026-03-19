---
name: build-judge-poc
description: Build a PoC for a software project from a design conversation. Use when asked to implement a PoC, prototype, or first working version of something that has been designed but not yet built.
---

# Build a PoC from a design conversation

## Read first

Before writing a single line of code, read the full conversation history. The design decisions, constraints, and trade-offs are already there. Your job is to extract the minimum buildable thing from that context — not to redesign it.

## Your goal

Build the smallest thing that proves the core idea works end-to-end. Not a demo, not a mockup — something that actually runs and produces real output.

**Done means:** a person can clone the repo, follow a README with at most 3 steps, run the tool, and see it work. No hand-holding required after that.

## Principles

**Minimize scope.** If a feature is not needed to prove the core loop works, leave a `TODO:` and move on. The conversation will tell you what's core and what's future.

**Be self-sufficient.** Make decisions, leave comments explaining them, keep moving. Do not stop to ask for clarification.

**Make work verifiable.** Build in slices where each slice produces something runnable. If you can't run it, it's not done.

**Use `claude -p` for LLM calls.** Do not set up API keys or SDK integrations. Shell out to `claude -p "prompt"` for any LLM call in the PoC. If the CLI is unavailable, fail with a clear error message.

## Working style for long autonomous runs

**Plan before you build.** Write a short ordered list of slices to a `PLAN.md` file before touching any code. Each slice should be independently runnable. Commit this file first — it's your contract with yourself.

**One slice at a time.** Complete a slice fully before starting the next. "Fully" means: it runs, you've verified it, you've committed it. Never have two slices half-done simultaneously.

**Commit often.** Every working slice is a commit. A commit is a checkpoint you can return to. If something breaks, you know exactly where to look.

**Verify yourself, don't assume.** After each slice, actually run the code. Read the output. If it's wrong, fix it before moving on. Never assume something works because you wrote it.

**Dead ends have an exit.** If you've tried the same fix three times and it's still broken, step back: mock the broken part, leave a `// STUCK: description` comment, and continue with the next slice. Do not loop indefinitely.

**Keep a `DECISIONS.md`.** Every time you make a non-obvious decision — a trade-off, an interpretation of the design, something the conversation didn't specify — log it in one line. This is how the human reviews your work without watching every step.

## When you're stuck

Mock the hard part, leave a clear comment, and keep building. A complete pipeline with a mock beats an incomplete pipeline with a real LLM call.
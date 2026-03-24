---
name: "Step Down Rule"
description: "Enforces that code reads like a top-down narrative, with higher-level functions vertically preceding the lower-level functions they call."
version: "1.0.0"
mode: "one-shot"
timeout_seconds: 60
---

# Step Down Rule

Ensure that the code adheres to the **Stepdown Rule** (a core concept from Clean Code by Robert C. Martin).

Code should read like a top-down narrative. This means:
1. Very high-level functions (the public API or the primary entry points) should appear at the top of the file.
2. A function that is called by another function should appear immediately below the calling function.
3. Lower-level utility or static helper functions should appear at the bottom of the file.

However, you MUST only flag this issue if the programming language and file structure permit it. For example:
- In JavaScript and TypeScript, `function` declarations are hoisted, allowing functions to be defined at the bottom and called at the top. This perfectly supports the Step Down rule.
- In languages or constructs where a function MUST be defined before it is used (like C++ without headers, or typical arrow functions `const fn = () => {}` in JS/TS), do not force structural changes that would break compilation.

**Checklist:**
- Are the most important exported/public functions located at the top of the module?
- If `Function A` calls `Function B`, is `Function B` located *below* `Function A` in the file?
- Are low-level utility functions pushed towards the bottom?

Report medium or high severity issues when major public functions are buried at the bottom of a file behind their inner helper functions.

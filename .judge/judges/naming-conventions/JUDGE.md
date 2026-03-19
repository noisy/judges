---
name: Naming Conventions
description: Validates that variables and functions have descriptive, non-abbreviated names.
---

1. Ensure that all variables, functions, and classes have descriptive, intention-revealing names.
2. Flag any single-letter variables (except for standard loop counters like `i` or `j` in very short loops).
3. Flag cryptic abbreviations or acronyms (e.g., `usrData` instead of `userData`, `req` instead of `request` unless it's a strongly established framework convention).
4. Boolean variables should be phrased as questions or assertions (e.g., `isAvailable`, `hasError`, `shouldUpdate`).
5. Only report issues. If a name is good, say nothing. Do NOT be pedantic about well-established domain acronyms like "ID", "HTTP", or "API".

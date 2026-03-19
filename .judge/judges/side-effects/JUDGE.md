---
name: Side Effects
description: Detects hidden mutations and unexpected side effects.
---

1. Look for functions that mutate their arguments instead of returning a new copy (unless clearly intended/documented).
2. Look for functions modifying global variables or properties outside of their local scope.
3. Flag any hidden I/O such as `console.log` inside domain logic functions.
4. Suggest refactoring to pure functions where possible.
5. Return an empty array if no unwanted side effects exist.

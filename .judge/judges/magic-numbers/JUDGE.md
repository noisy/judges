---
name: Magic Numbers
description: Flags magic numbers and hardcoded strings.
---

1. Find any numeric literals or string literals used inline in conditional logic, loop boundaries, or calculations.
2. E.g., `if (age > 18)` or `status === 'pending'`.
3. Suggest extracting them to named constants like `const MINIMUM_LEGAL_AGE = 18;` or `const STATUS_PENDING = 'pending';`.
4. Ignore widely accepted non-magic numbers like `0`, `1`, or `-1` (used for array indexing, basic increments).
5. If none are found, return an empty array.

---
version: 1.0.0
name: SRP Validator
description: Validates the Single Responsibility Principle for functions and classes.
---

1. Analyze each function, method, and class.
2. Does it do exactly one thing? 
3. Flag any function that combines data fetching/calculation with logging, I/O, or side-effects.
4. Flag classes that manage both view logic and network requests.
5. Provide actionable suggestions on how to split the entity into multiple focused items.
6. Return an empty array if SRP is respected.

---
version: 1.0.0
name: DRY Principle
description: Finds duplicated logic and violations of the Don't Repeat Yourself principle.
---

1. Analyze the provided code for exact or near-exact duplicated logic blocks.
2. Flag any duplicated conditional structures, repeated calculations, or loops doing identical work.
3. Suggest an abstraction (e.g., a shared helper function or a base class) if applicable.
4. Only flag meaningful duplication. Do not flag trivial code like identical `import` statements or boilerplate configuration.
5. If the code is perfectly clean, return an empty array.

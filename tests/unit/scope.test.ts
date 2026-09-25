import { describe, it, expect } from 'vitest';
import { scopeContext, splitDiffByFile } from '../../src/scope.js';
import { EvaluationContext } from '../../src/types.js';

const tsSection = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-const valid = true;
+const isValid = true;
`;

const pySection = `diff --git a/src/connectors/x.py b/src/connectors/x.py
new file mode 100644
--- /dev/null
+++ b/src/connectors/x.py
@@ -0,0 +1 @@
+def get(): pass
`;

const renameSection = `diff --git a/old/name.ts b/src/renamed.ts
similarity index 100%
rename from old/name.ts
rename to src/renamed.ts
`;

describe('splitDiffByFile', () => {
  it('splits a unified diff into one section per file, keyed by the new path', () => {
    const sections = splitDiffByFile(tsSection + pySection + renameSection);

    expect(sections.map((s) => s.path)).toEqual(['src/a.ts', 'src/connectors/x.py', 'src/renamed.ts']);
    expect(sections[0].text).toBe(tsSection);
    expect(sections[1].text).toBe(pySection);
  });

  it('returns no sections for an empty diff', () => {
    expect(splitDiffByFile('')).toEqual([]);
  });

  it('keeps hunk lines that look like headers but are not at line start', () => {
    const tricky = tsSection.replace('+const isValid = true;', '+const s = "diff --git a/x b/x";');
    expect(splitDiffByFile(tricky)).toHaveLength(1);
  });
});

describe('scopeContext', () => {
  const diffContext: EvaluationContext = {
    type: 'diff',
    rawDiff: tsSection + pySection,
    files: [
      { path: 'src/a.ts', content: 'const isValid = true;' },
      { path: 'src/connectors/x.py', content: 'def get(): pass' }
    ]
  };

  it('keeps only the files and diff hunks matching the scope', () => {
    const scoped = scopeContext(diffContext, ['src/connectors/**/*.py']);

    expect(scoped.files.map((f) => f.path)).toEqual(['src/connectors/x.py']);
    expect(scoped.rawDiff).toBe(pySection);
  });

  it('matches if any glob in the scope matches', () => {
    const scoped = scopeContext(diffContext, ['**/*.md', 'src/*.ts']);

    expect(scoped.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('keeps everything under the default scope, including dotfiles', () => {
    const withDotfile = { ...diffContext, files: [...diffContext.files, { path: '.github/ci.yml', content: '' }] };

    expect(scopeContext(withDotfile, ['**/*']).files).toHaveLength(3);
  });

  it('returns no files and an empty diff when nothing matches', () => {
    const scoped = scopeContext(diffContext, ['docs/**']);

    expect(scoped.files).toEqual([]);
    expect(scoped.rawDiff).toBe('');
  });

  it('leaves rawDiff absent for file input', () => {
    const filesContext: EvaluationContext = { type: 'files', files: [{ path: 'src/a.ts', content: '' }] };

    expect(scopeContext(filesContext, ['src/**'])).toEqual(filesContext);
  });
});

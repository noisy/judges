# Markers

A marker declares, in the code, that a place deviates from a named rule on purpose. The reason travels with the code, the judge is told the place is accounted for, and findings the marker covers are dropped before output. No model is involved in any of this.

## Grammar

```
<comment> rule-ignore: <rule-id> -- <reason>    permanent exception; stays while the reason holds
<comment> rule-todo:   <rule-id> -- <reason>    known debt; removed when paid
```

- `<comment>` is any of `#`, `//`, `--`, `;`, `/* ... */` or `<!-- ... -->`. The marker must be the whole line (leading whitespace is fine); a marker at the end of a code line is not read.
- `<rule-id>` is the rule's `id`: letters, digits, `-`, `_` and `.`.
- `-- <reason>` is required. A marker with no reason, or an empty one, covers nothing and is reported as a finding.

## What a marker covers

- **Line-level** (the default): the next line that is neither blank nor another marker, plus the marker's own comment line. Stacked markers all cover the same code line.
- **File-level**: markers at the very top of the file (after an optional `#!` shebang line), before any other line, cover the whole file. Several can be stacked there.

A finding's `line` can be a number, a numeric string, a range (`45-60`) or `N/A`:

| Finding line | Covered by a line marker | Covered by a file marker |
| :--- | :--- | :--- |
| `42` / `"42"` | when the marker covers line 42 | yes |
| `45-60` | only when every line 45..60 is covered | yes |
| `N/A` | no | yes |

A range that spans unmarked code is kept on purpose.

## During a run

1. **The judge is told.** Each judge's prompt lists the markers for its id in its scoped files as "accounted for, do not report" (file, line, kind, reason).
2. **Covered findings are dropped.** The prompt note saves tokens and false positives; the post-filter is the guarantee. The count shows in the summary (`✔ my-rule: 0 issues (2 suppressed by markers)`) and as `suppressed` in `--json`.
3. **Invalid markers are findings.** Every file in the run's input is checked once, and a `Markers` result joins the output when something is wrong:
   - no reason: `medium`, `rule-ignore for <id> has no reason`
   - an id that is not a loaded rule or judge: `low`, `marker refers to unknown rule <id>`

   These findings count towards `--fail-on`.

## Inventory

```bash
judge markers            # every marker in the repository, grouped by rule id
judge markers src tests  # only these paths
judge markers --json     # [{ "ruleId": ..., "markers": [{ kind, ruleId, reason, file, markerLine, scope }] }]
```

Paths are relative to the repository root in every mode, so markers, scope globs and findings share one base.

# Markers

A marker declares, in the code, that a place breaks a named rule on purpose, or is known debt. The reason travels with the code. judges finds the markers and gives them to the rule's judge, and the judge decides what each marker covers: a line, a block, a function or a whole file. Covered findings are dropped, counted and listed, so a reviewer sees what each marker covered.

## Grammar

```
<comment> rule-exception: <rule-id> -- <reason>    an accepted exception; stays while the reason holds
<comment> rule-debt:      <rule-id> -- <reason>    known debt; the code should change later
```

Put the marker where a reader would be surprised, or as a warning in a docstring:

```python
def main(args):
    # rule-exception: no-print-in-src -- the CLI writes its result to stdout
    print(run(args))


def migrate(db):
    """Copy the old tables into the new schema.

    rule-debt: no-print-in-src -- the progress lines go to stdout for now.
    Move them to logging when the job runner collects logs.
    """
```

- The marker starts its comment: only spaces and one opener may come before it. The openers are `#`, `//`, `--`, `;`, `/*`, `*`, `<!--`, `"""` and `'''`. A line inside a docstring or a block comment needs no opener. Marker text after code, or in the middle of a sentence, is not a marker.
- `<rule-id>` is the rule's `id`: letters, digits, `-`, `_` and `.`.
- `-- <reason>` is required, and starts on the marker line. The reason goes on over the next lines until the comment ends:
  - at a blank line, or a comment line with no text;
  - after a `#`, `//`, `--` or `;` marker, at a line that is not a comment of the same kind;
  - at a line that closes the comment (`*/`, `-->`, `"""`, `'''`); the text before the closer is still part of the reason;
  - at the next marker.

  The lines are joined into one, without the comment characters (a leading `*` too).
- A marker with no reason, or an empty one, covers nothing and is reported as a finding.
- `rule-ignore` and `rule-todo`, the old names, are still read as `rule-exception` and `rule-debt`.

## During a run

1. **The judge is told.** Each rule's prompt lists the markers that name its id and have a reason, from the files the rule is given, anywhere in those files: `<file>:<line>` of the marker line, the kind and the whole reason. The prompt asks the judge to decide what each marker covers, to return a violation a marker accounts for with `"covered_by": "<file>:<line>"`, and to report every other violation, even right next to a marker.
2. **Covered findings are dropped and listed.** A finding whose `covered_by` names a marker from the prompt is removed from the findings. `--json` lists it in the rule's `covered`, with `covered_by` set to the marker's place, and counts it in `suppressed`. The summary shows the count (`✔ my-rule: 0 issues (2 suppressed by markers)`). Covered findings never count for `--fail-on` and are left out of the CI reports.
3. **Only those markers can cover.** A `covered_by` that names anything else, such as a marker of another rule, a marker without a reason, or a line with no marker, covers nothing: the finding is reported as usual.
4. **Invalid markers are findings.** Every file in the run's input is checked once, whatever the rules' scopes, and a `Markers` result joins the output when something is wrong:
   - no reason: `medium`, `rule-exception for <id> has no reason`
   - an id that is not a loaded rule or judge (compared exactly, case included): `low`, `marker refers to unknown rule <id>`

   These findings count towards `--fail-on`.

What a marker covers is the judge's judgement, so it is not fully deterministic. A reason that says what it is about (which numbers, which call, which function) helps the judge cover exactly that.

## Inventory

```bash
judge markers            # every marker in the repository, grouped by rule id
judge markers src tests  # only these paths
judge markers --json     # [{ "ruleId": ..., "markers": [{ kind, ruleId, reason, file, markerLine }] }]
```

`kind` is `exception` or `debt`. `reason` is the whole reason as one line, and is left out when there is none. The inventory calls no model and needs no rule files.

Paths are relative to the repository root in every mode, so markers, scope globs and findings share one base.

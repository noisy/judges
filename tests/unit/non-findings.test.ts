import { describe, it, expect } from 'vitest';
import { dropNonFindings, isNonFinding } from '../../src/non-findings.js';
import { Issue } from '../../src/types.js';

// Messages Haiku wrote as findings in S25/L3-comments-and-errors-two-rules.
const SAYS_NO_VIOLATION = [
  "The comment explains the reason for the value (the card network's 120-day limit and the one-day safety margin), so it's justified. No issue here; this line is not reported.",
  'The ValueError for a non-positive refund amount says what was wrong, includes the bad value (got {amount_cents}), and tells the reader what to enter (amount in cents, e.g. 1250). This message complies and is not a finding; no change needed. (Kept as a reference point for the rule; no issue reported here.)',
  "The comment explains why the window is 119 rather than the network's 120, which is useful, but it is attached to the constant line directly above it. No issue here per the rule, since it gives a reason the code cannot show. Disregard if already reviewed; this entry is retained only because the line-7 comment is a reason-bearing comment and should not be flagged.",
  "The comment explains why the window is 119 days rather than 120, which is useful, but it is attached to the constant the code already names. No issue with the rule here; this entry is intentionally omitted from findings because the comment conveys a reason (safety margin against the network's 120-day limit), which the code cannot show.",
  "The comment explains the reason for the 119-day value (the network's 120-day limit minus a safety day), so it is acceptable. However, it sits above the constant rather than being inline, which is fine. No restatement issue here; keeping this as a note only if you want to tighten wording. Consider no change."
];

const REAL_FINDINGS = [
  // S23/L5-same-name-method: a real finding that also clears another line.
  '`invoice_lines` calls `invoice.total()`, which is `Invoice.total`, decorated with `@deprecated("Use amount_due(); total() ignores partial payments.")` in src/billing/models.py:24-25. The new call also ignores partial payments, so it reports the wrong amount for partly paid invoices. Replace it with `invoice.amount_due()`, which is what `total_due` already uses. The `order.total()` call on line 6 is not a violation, because `Order.total` is not deprecated.',
  'This message does not say what to do.',
  'The error message is fine in tone but does not say what value was expected.',
  'No issue with the name itself, but the comment restates the code.',
  'The function has no test.'
];

describe('isNonFinding', () => {
  it.each(SAYS_NO_VIOLATION)('drops an entry that says the code follows the rule: %s', (message) => {
    expect(isNonFinding(message)).toBe(true);
  });

  it.each(REAL_FINDINGS)('keeps a real finding: %s', (message) => {
    expect(isNonFinding(message)).toBe(false);
  });
});

describe('dropNonFindings', () => {
  it('keeps the real findings and counts the dropped entries', () => {
    const issue = (message: string): Issue => ({ file: 'a.py', line: 7, severity: 'low', message });
    const issues = [issue(SAYS_NO_VIOLATION[0]), issue(REAL_FINDINGS[1])];

    const { kept, dismissed } = dropNonFindings(issues);

    expect(kept).toEqual([issue(REAL_FINDINGS[1])]);
    expect(dismissed).toBe(1);
  });
});

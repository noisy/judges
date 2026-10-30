import { describe, it, expect } from 'vitest';
import { readConfidence, splitByConfidence } from '../../src/confidence.js';
import { Issue } from '../../src/types.js';

const at = (line: number, confidence: number | null): Issue => ({ file: 'a.py', line, severity: 'low', message: 'm', confidence });

describe('readConfidence', () => {
  it.each([[82, 82], [0, 0], [100, 100], [69.6, 70], ['high', 90], ['medium', 60], ['low', 30]])('reads %j as %j', (value, percent) => {
    expect(readConfidence(value)).toBe(percent);
  });

  it.each([[101], [-1], ['82'], ['sure'], [undefined], [null]])('reads %j as no confidence', (value) => {
    expect(readConfidence(value)).toBeNull();
  });
});

describe('splitByConfidence', () => {
  it('keeps every finding without a threshold', () => {
    expect(splitByConfidence([at(1, 90), at(2, 30)])).toEqual({ kept: [at(1, 90), at(2, 30)], belowThreshold: [] });
  });

  it('drops what is under the threshold, keeps the threshold itself, and never drops a finding without a confidence', () => {
    expect(splitByConfidence([at(1, 70), at(2, 69), at(3, null)], 70)).toEqual({
      kept: [at(1, 70), at(3, null)],
      belowThreshold: [at(2, 69)]
    });
  });
});

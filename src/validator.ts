import { z } from 'zod';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: any;
}

const semverRegex = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-zA-Z0-9-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const JudgeSchema = z.object({
  name: z.string().min(1, '`name` cannot be empty'),
  
  description: z.string().min(1, '`description` cannot be empty'),
  
  version: z.string().regex(semverRegex, '`version` must be a valid semver'),
  
  mode: z.enum(['one-shot', 'agent']).optional().default('one-shot'),
  
  timeout_seconds: z.number().int('`timeout_seconds` must be an integer')
    .positive('`timeout_seconds` must be positive')
    .optional()
    .default(30)
});

export function validateJudge(data: any): ValidationResult {
  const warnings: string[] = [];
  
  const parsed = JudgeSchema.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(i => {
      // If it's a custom error message from errorMap or explicit strings above, use it directly.
      // Otherwise fallback to combining path and message.
      if (i.message.includes('`')) return `error: ${i.message}`;
      return `error: \`${i.path.join('.')}\` ${i.message}`;
    });
    return { valid: false, errors, warnings };
  }

  const validData = parsed.data;

  // Non-fatal warning for agent mode
  if (validData.mode === 'agent') {
    warnings.push('`mode`: agent mode not yet implemented, falling back to one-shot');
    validData.mode = 'one-shot'; 
  }

  return { valid: true, errors: [], warnings, data: validData };
}

import { z } from 'zod';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: any;
}

export interface Budget {
  timeout_seconds?: number;
  max_budget_usd?: number;
}

const semverRegex = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-zA-Z0-9-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_AGENT_TIMEOUT_SECONDS = 120;
const DEFAULT_AGENT_TOOLS: string[] = ['Read', 'Grep', 'Glob'];
const DEFAULT_AGENT_MAX_TURNS = 8;
// Judges are read-only by construction: no tool that writes, runs code or reaches the network.
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'LS'] as const;
const SECONDS_PER_UNIT: Record<string, number> = { s: 1, m: 60 };
const BUDGET_FORMAT_ERROR = '`budget` must look like "30s, $0.10" (time in s or m, cost in $, either part optional)';

const settingsFields = {
  mode: z.enum(['one-shot', 'agent']).optional().default('one-shot'),

  timeout_seconds: z.number().int('`timeout_seconds` must be an integer')
    .positive('`timeout_seconds` must be positive')
    .optional(),

  budget: z.string().transform((value, ctx) => {
    const budget = parseBudget(value);
    if (!budget) {
      ctx.addIssue({ code: 'custom', message: BUDGET_FORMAT_ERROR });
      return z.NEVER;
    }
    return budget;
  }).optional(),

  scope: z.array(z.string().min(1, '`scope` globs cannot be empty')).optional().default(['**/*']),

  severity: z.enum(['low', 'medium', 'high']).optional().default('medium'),

  check: z.enum(['judge', 'deterministic']).optional().default('judge'),

  model: z.string().min(1, '`model` cannot be empty').optional(),

  tools: z.array(z.enum(READ_ONLY_TOOLS, {
    error: `\`tools\` entries must be read-only tools: ${READ_ONLY_TOOLS.join(', ')}`,
  })).min(1, '`tools` cannot be empty').optional(),

  max_turns: z.number().int('`max_turns` must be an integer')
    .positive('`max_turns` must be positive')
    .optional(),

  command: z.string().min(1, '`command` cannot be empty').optional(),
};

const JudgeSchema = z.object({
  name: z.string().min(1, '`name` cannot be empty'),

  description: z.string().min(1, '`description` cannot be empty'),

  version: z.string().regex(semverRegex, '`version` must be a valid semver'),

  ...settingsFields,
}).superRefine(checkSettingsConsistency).transform(resolveDefaults);

const RuleSchema = z.object({
  id: z.string().min(1, '`id` cannot be empty'),

  name: z.string().min(1, '`name` cannot be empty').optional(),

  description: z.string().optional().default(''),

  version: z.string().regex(semverRegex, '`version` must be a valid semver').optional().default(''),

  ...settingsFields,
}).superRefine(checkSettingsConsistency)
  .transform(resolveDefaults)
  .transform(rule => ({ ...rule, name: rule.name ?? rule.id }));

export function validateJudge(data: any): ValidationResult {
  return toValidationResult(JudgeSchema.safeParse(data));
}

export function validateRule(data: any, fileId: string): ValidationResult {
  const result = toValidationResult(RuleSchema.safeParse(data));
  if (data?.id !== undefined && data.id !== fileId) {
    result.errors.push(`error: \`id\` "${data.id}" must match the file name "${fileId}"`);
    return { ...result, valid: false, data: undefined };
  }
  return result;
}

// Settings an invalid judge falls back to, so it can still be listed and reported.
export function defaultSettings() {
  return resolveDefaults(z.object(settingsFields).parse({}));
}

// "30s, $0.10" -> { timeout_seconds: 30, max_budget_usd: 0.1 }; null when malformed.
export function parseBudget(value: string): Budget | null {
  const parts = value.split(',').map(part => part.trim());
  const budget: Budget = {};

  for (const part of parts) {
    const time = part.match(/^(\d+)(s|m)$/);
    const cost = part.match(/^\$(\d+(?:\.\d+)?)$/);

    if (time && budget.timeout_seconds === undefined) {
      budget.timeout_seconds = Number(time[1]) * SECONDS_PER_UNIT[time[2]];
    } else if (cost && budget.max_budget_usd === undefined) {
      budget.max_budget_usd = Number(cost[1]);
    } else {
      return null;
    }
  }

  const hasZero = budget.timeout_seconds === 0 || budget.max_budget_usd === 0;
  return hasZero ? null : budget;
}

interface SettingsInput {
  mode: 'one-shot' | 'agent';
  tools?: string[];
  max_turns?: number;
  timeout_seconds?: number;
  budget?: Budget;
  check: 'judge' | 'deterministic';
  command?: string;
}

function checkSettingsConsistency(data: SettingsInput, ctx: z.RefinementCtx): void {
  if (data.timeout_seconds !== undefined && data.budget?.timeout_seconds !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['budget'], message: '`budget` time and `timeout_seconds` cannot both be set' });
  }
  if (data.tools !== undefined && data.mode !== 'agent') {
    ctx.addIssue({ code: 'custom', path: ['tools'], message: '`tools` is only allowed with `mode: agent`' });
  }
  if (data.command !== undefined && data.check !== 'deterministic') {
    ctx.addIssue({ code: 'custom', path: ['command'], message: '`command` is only allowed with `check: deterministic`' });
  }
}

// `mode` decides the defaults: one-shot judges get no tools, agents get read-only tools and a turn cap.
function resolveDefaults<T extends SettingsInput>({ budget, ...rest }: T) {
  const isAgent = rest.mode === 'agent';
  return {
    ...rest,
    tools: rest.tools ?? (isAgent ? DEFAULT_AGENT_TOOLS : []),
    max_turns: rest.max_turns ?? (isAgent ? DEFAULT_AGENT_MAX_TURNS : undefined),
    timeout_seconds: rest.timeout_seconds ?? budget?.timeout_seconds
      ?? (isAgent ? DEFAULT_AGENT_TIMEOUT_SECONDS : DEFAULT_TIMEOUT_SECONDS),
    max_budget_usd: budget?.max_budget_usd,
  };
}

function toValidationResult(parsed: z.ZodSafeParseResult<any>): ValidationResult {
  const warnings: string[] = [];

  if (!parsed.success) {
    const errors = parsed.error.issues.map(i => {
      // If it's a custom error message from errorMap or explicit strings above, use it directly.
      // Otherwise fallback to combining path and message.
      if (i.message.includes('`')) return `error: ${i.message}`;
      return `error: \`${i.path.join('.')}\` ${i.message}`;
    });
    return { valid: false, errors, warnings };
  }

  return { valid: true, errors: [], warnings, data: parsed.data };
}

import { z } from 'zod';
import { STAGES } from './types.js';

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
// How much the model sees. `diff` and `file` run as one call with no tools; `repo` as an agent.
export const CONTEXTS = ['diff', 'file', 'repo'] as const;
export type Context = typeof CONTEXTS[number];
// `mode` is the old way to say `context`; alone, it stands for one context each.
const CONTEXT_OF_MODE = { 'one-shot': 'file', agent: 'repo' } as const;
// Judges are read-only by construction: no tool that writes, runs code or reaches the network.
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'] as const;
const SECONDS_PER_UNIT: Record<string, number> = { s: 1, m: 60 };
// A directory outside the repo, whole: `../billing-service`, `../billing-service/**`, `/abs/dir/**`, `~/dir/**`.
// The sandbox grants whole directories, so a narrower glob would promise less than it grants.
const ALLOW_READ_PATTERN = /^[^*?[\]{}]+?(\/\*\*)?$/;
const ALLOW_READ_ERROR = '`allow_read` entries must be a directory, optionally ending in /** (relative to the repo root, absolute, or ~/)';
const BUDGET_FORMAT_ERROR = '`budget` must look like "30s, $0.10" (time in s or m, cost in $, either part optional)';
// A team that relied on its command must learn that it never runs, so these fields are rejected, not ignored.
const NOT_A_RULE_FIELD = 'is not a rule field: every rule is checked by a model, and judges runs no commands. A check a linter or a test can do belongs there';

const settingsFields = {
  mode: z.enum(['one-shot', 'agent']).optional(),

  context: z.enum(CONTEXTS, { error: `\`context\` must be one of: ${CONTEXTS.join(', ')}` }).optional(),

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

  stage: z.enum(STAGES).optional().default('commit'),

  severity: z.enum(['low', 'medium', 'high']).optional().default('medium'),

  check: z.never({ error: `\`check\` ${NOT_A_RULE_FIELD}` }).optional(),

  model: z.string().min(1, '`model` cannot be empty').optional(),

  tools: z.array(z.enum(READ_ONLY_TOOLS, {
    error: `\`tools\` entries must be read-only tools: ${READ_ONLY_TOOLS.join(', ')}`,
  })).min(1, '`tools` cannot be empty').optional(),

  allow_read: z.array(z.string().regex(ALLOW_READ_PATTERN, ALLOW_READ_ERROR)).optional(),

  max_turns: z.number().int('`max_turns` must be an integer')
    .positive('`max_turns` must be positive')
    .optional(),

  command: z.never({ error: `\`command\` ${NOT_A_RULE_FIELD}` }).optional(),
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

// What a rule's id must match: the name of its `<id>.md` file, or of the directory that holds its `RULE.md`.
export type IdSource = 'file name' | 'directory name';

export function validateRule(data: any, fileId: string, named: IdSource = 'file name'): ValidationResult {
  const result = toValidationResult(RuleSchema.safeParse(data));
  if (data?.id !== undefined && data.id !== fileId) {
    result.errors.push(`error: \`id\` "${data.id}" must match the ${named} "${fileId}"`);
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
  mode?: 'one-shot' | 'agent';
  context?: Context;
  tools?: string[];
  allow_read?: string[];
  max_turns?: number;
  timeout_seconds?: number;
  budget?: Budget;
}

function checkSettingsConsistency(data: SettingsInput, ctx: z.RefinementCtx): void {
  if (data.timeout_seconds !== undefined && data.budget?.timeout_seconds !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['budget'], message: '`budget` time and `timeout_seconds` cannot both be set' });
  }
  checkContext(data, ctx);
}

// `mode` and `context` must agree, since the tool does not guess which one the author meant.
// A rule without tools (`diff`, `file`) can read nothing, so agent settings on it are a mistake.
function checkContext(data: SettingsInput, ctx: z.RefinementCtx): void {
  if (data.mode !== undefined && data.context !== undefined && modeOf(data.context) !== data.mode) {
    ctx.addIssue({ code: 'custom', path: ['context'],
      message: `\`context: ${data.context}\` contradicts \`mode: ${data.mode}\`; set only \`context\`` });
    return;
  }
  if (modeOf(contextOf(data)) === 'agent') return;
  for (const field of ['tools', 'max_turns', 'allow_read'] as const) {
    if (data[field] !== undefined) {
      ctx.addIssue({ code: 'custom', path: [field],
        message: `\`${field}\` is only allowed with \`context: repo\` (or \`mode: agent\`)` });
    }
  }
}

function contextOf(data: SettingsInput): Context {
  return data.context ?? CONTEXT_OF_MODE[data.mode ?? 'one-shot'];
}

function modeOf(context: Context): 'one-shot' | 'agent' {
  return context === 'repo' ? 'agent' : 'one-shot';
}

// `context` decides the defaults: one-shot judges get no tools, agents get read-only tools and a turn cap.
function resolveDefaults<T extends SettingsInput>({ budget, ...rest }: T) {
  const context = contextOf(rest);
  const mode = modeOf(context);
  const isAgent = mode === 'agent';
  return {
    ...rest,
    context,
    mode,
    tools: rest.tools ?? (isAgent ? DEFAULT_AGENT_TOOLS : []),
    allow_read: rest.allow_read ?? [],
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

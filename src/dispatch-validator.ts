export interface DispatchPayload {
  run_id: string;
  request_id?: string;
  task_type: string;
  context_intent?: string;
  input: string;
  repo: string;
  base_branch?: string;
  branch: string;
  acceptance_tests: string[];
  output_contract?: {
    required_fields?: string[];
  };
  priority?: string;
  [key: string]: unknown;
}

export interface CompletionContract {
  run_id: string;
  branch: string;
  commit_sha?: string;
  files_changed?: string[];
  test_result?: string;
  risk?: string;
  pr_url?: string;
  pr_skipped_reason?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  missing: string[];
}

const DISPATCH_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const WORKER_BRANCH_PATTERN = /^jarvis-[A-Za-z0-9._/-]+$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{6,40}$/i;

export function parseDispatchPayload(text: string): DispatchPayload | null {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as DispatchPayload;
}

export function validateDispatchPayload(
  payload: DispatchPayload | null,
): ValidationResult {
  const errors: string[] = [];
  if (!payload) {
    return {
      valid: false,
      errors: ['dispatch payload missing'],
      missing: ['dispatch payload'],
    };
  }

  requireNonEmptyString(payload.run_id, 'run_id', errors);
  requireNonEmptyString(payload.task_type, 'task_type', errors);
  requireNonEmptyString(payload.input, 'input', errors);
  requireNonEmptyString(payload.repo, 'repo', errors);
  requireNonEmptyString(payload.branch, 'branch', errors);

  if (payload.branch && !DISPATCH_BRANCH_PATTERN.test(payload.branch)) {
    errors.push('branch format');
  }
  if (!Array.isArray(payload.acceptance_tests)) {
    errors.push('acceptance_tests');
  } else if (
    payload.acceptance_tests.some(
      (item) => typeof item !== 'string' || item.trim().length === 0,
    )
  ) {
    errors.push('acceptance_tests format');
  }

  return {
    valid: errors.length === 0,
    errors,
    missing: [...errors],
  };
}

export function parseCompletionContract(
  text: string,
): CompletionContract | null {
  const match = /<completion>([\s\S]*?)<\/completion>/i.exec(text);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as CompletionContract;
  } catch {
    return null;
  }
}

export function validateCompletionContract(
  contract: CompletionContract | null,
  options: { expectedRunId?: string; expectedBranch?: string } = {},
): ValidationResult {
  const errors: string[] = [];
  if (!contract) {
    return {
      valid: false,
      errors: ['completion block'],
      missing: ['completion block'],
    };
  }

  requireNonEmptyString(contract.run_id, 'run_id', errors);
  requireNonEmptyString(contract.branch, 'branch', errors);
  requireNonEmptyString(contract.test_result, 'test_result', errors);
  requireNonEmptyString(contract.risk, 'risk', errors);

  if (options.expectedRunId && contract.run_id !== options.expectedRunId) {
    errors.push('run_id mismatch');
  }
  if (options.expectedBranch && contract.branch !== options.expectedBranch) {
    errors.push('branch mismatch');
  }
  if (contract.branch && !WORKER_BRANCH_PATTERN.test(contract.branch)) {
    errors.push('branch format');
  }

  const hasPrUrl =
    typeof contract.pr_url === 'string' && contract.pr_url.trim().length > 0;
  const hasPrSkip =
    typeof contract.pr_skipped_reason === 'string' &&
    contract.pr_skipped_reason.trim().length > 0;
  if (!hasPrUrl && !hasPrSkip) {
    errors.push('pr_url or pr_skipped_reason');
  }

  if (
    contract.commit_sha &&
    !COMMIT_SHA_PATTERN.test(contract.commit_sha.trim())
  ) {
    errors.push('commit_sha format');
  }

  if (
    contract.files_changed !== undefined &&
    (!Array.isArray(contract.files_changed) ||
      contract.files_changed.some(
        (item) => typeof item !== 'string' || item.trim().length === 0,
      ))
  ) {
    errors.push('files_changed format');
  }

  return {
    valid: errors.length === 0,
    errors,
    missing: [...errors],
  };
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(field);
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fencedMatch = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // fall through to generic extraction
    }
  }

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // fall through to scanning extraction
    }
  }

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;
    const extracted = extractBalancedObject(text, start);
    if (!extracted) continue;
    try {
      return JSON.parse(extracted) as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  return null;
}

function extractBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
      if (depth < 0) return null;
    }
  }

  return null;
}

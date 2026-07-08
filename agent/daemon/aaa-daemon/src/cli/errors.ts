/**
 * Structured CLI errors with credential redaction.
 *
 * All error output goes through formatError() to ensure consistent
 * Error: / Code: / Next action: formatting and that no credential-shaped
 * strings leak to stderr.
 */

/** Credential-shaped patterns that must never appear in error output. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /sk_agent_[A-Za-z0-9_-]+/g,
  /sk_machine_[A-Za-z0-9_-]+/g,
  /sap_[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

/** File-system paths that may contain credentials. */
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\/[\w@./-]+\.(slock|raft)\/[\w./-]+/g,
  /\/[\w@./-]*(agent-proxy-tokens|cli-transport|profiles)\/[\w./-]+/g,
];

/**
 * Redact credential-shaped strings from a text buffer.
 * Replaces matches with a `sk_<type>_<redacted>` shape.
 */
export function redact(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.startsWith('Bearer')) return 'Bearer <redacted>';
      if (match.startsWith('sk_agent')) return 'sk_agent_<redacted>';
      if (match.startsWith('sk_machine')) return 'sk_machine_<redacted>';
      if (match.startsWith('sap')) return 'sap_<redacted>';
      return '<redacted>';
    });
  }
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    result = result.replace(pattern, '<path-redacted>');
  }
  return result;
}

export class CliError extends Error {
  constructor(
    message: string,
    public code: string,
    public nextAction?: string,
    public exitCode: number = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Format a CliError into the canonical three-part error text. */
export function formatError(err: CliError): string {
  const lines: string[] = [
    `Error: ${redact(err.message)}`,
    `Code: ${err.code}`,
  ];
  if (err.nextAction) {
    lines.push(`Next action: ${redact(err.nextAction)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Wrap any caught error into a CliError.
 * Unknown errors get code CLI_FAILED; known CliErrors pass through.
 * Also picks up `nextAction` property from objects that aren't CliError.
 */
export function toCliError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const e = err as Error & { code?: string; nextAction?: string };
  return new CliError(
    e.message || String(err),
    e.code ?? 'CLI_FAILED',
    e.nextAction,
  );
}

/** Error codes for common situations. */
export const ErrorCodes = {
  MISSING_TARGET: { code: 'MISSING_TARGET', nextAction: 'Specify the target with --target "#channel" or --target dm:@user' },
  MISSING_CHANNEL: { code: 'MISSING_CHANNEL', nextAction: 'Specify the channel with --channel "#channel"' },
  MISSING_QUERY: { code: 'MISSING_QUERY', nextAction: 'Provide a search query with --query "text"' },
  MISSING_CONTENT: { code: 'MISSING_CONTENT', nextAction: 'Provide content via --content, positional args, or stdin' },
  MISSING_MESSAGE_ID: { code: 'MISSING_MESSAGE_ID', nextAction: 'Specify the message ID with --message-id <id>' },
  MISSING_TASK_ID: { code: 'MISSING_TASK_ID', nextAction: 'Specify the task with --id <id> or --channel with --number' },
  MISSING_TITLE: { code: 'MISSING_TITLE', nextAction: 'Provide a title with --title "text"' },
  MISSING_THREAD_ID: { code: 'MISSING_THREAD_ID', nextAction: 'Specify the thread ID with --thread-id <id>' },
  MISSING_REMINDER_ID: { code: 'MISSING_REMINDER_ID', nextAction: 'Specify the reminder with --id <id>' },
  MISSING_ATTACHMENT_ID: { code: 'MISSING_ATTACHMENT_ID', nextAction: 'Specify the attachment with --id <id>' },
  MISSING_FILE: { code: 'MISSING_FILE', nextAction: 'Specify the file path with --file <path>' },
  MISSING_PROVIDER: { code: 'MISSING_PROVIDER', nextAction: 'Specify the service with --service <name>' },
  MISSING_PROXY_URL: { code: 'MISSING_SLOCK_AGENT_PROXY_URL', nextAction: 'The daemon wrapper must inject SLOCK_AGENT_PROXY_URL.' },
  MISSING_AGENT_ID: { code: 'MISSING_SLOCK_AGENT_ID', nextAction: 'The daemon wrapper must inject SLOCK_AGENT_ID.' },
  MISSING_TOKEN_FILE: { code: 'MISSING_SLOCK_AGENT_PROXY_TOKEN_FILE', nextAction: 'The daemon wrapper must inject SLOCK_AGENT_PROXY_TOKEN_FILE.' },
  TOKEN_READ_FAILED: { code: 'TOKEN_READ_FAILED', nextAction: 'Check that SLOCK_AGENT_PROXY_TOKEN_FILE points to a readable file.' },
  WRITES_NOT_ALLOWED: {
    code: 'WRITES_NOT_ALLOWED',
    nextAction: 'This permission must be granted by the daemon or operator via environment variable or launch config.',
  },
  WRITE_TARGET_NOT_ALLOWED: { code: 'WRITE_TARGET_NOT_ALLOWED', nextAction: 'Add the target to SLOCK_WRITE_TARGET_ALLOWLIST or contact the operator.' },
  USAGE: { code: 'USAGE', nextAction: 'Run with --help to see available commands.' },
} as const;

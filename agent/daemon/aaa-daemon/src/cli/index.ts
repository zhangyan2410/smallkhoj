/**
 * Commander-based CLI entry point (MVP slice).
 *
 * Handles MVP commands with canonical output formatting:
 *   - message check / read / send
 *   - memory read (smallkhoj extension)
 *
 * Non-MVP commands fall through to the legacy parseRequest handler
 * in slock-cli.ts, ensuring zero regression.
 *
 * The public entry point `runSlockCli(argv, io)` signature is preserved.
 */

import { Command, Option } from 'commander';
import { stdin, stdout, stderr } from 'process';
import { writeFileSync } from 'fs';

import { CliError, ErrorCodes, formatError, toCliError } from './errors.js';
import type { CliRequest } from '../slock-cli-legacy.js';
import { assertWriteAllowed, writeScope, WriteScope } from './safety.js';
import {
  resolveProxyConfig,
  proxyRequest,
  agentPrefix,
  enrichProxyFailure,
  ProxyConfig,
} from './client.js';
import {
  OutputFormat,
  parseFormat,
  formatMessageCheck,
  formatMessageRead,
  formatMessageSend,
  formatMemoryRead,
  formatPassthrough,
} from './output.js';
import { readDaemonPackageVersion } from '../version.js';

export interface CliIo {
  stdout?: Pick<typeof stdout, 'write'>;
  stderr?: Pick<typeof stderr, 'write'>;
  env?: NodeJS.ProcessEnv;
}

/** Read stdin as text (for message content, etc). */
async function readStdinText(): Promise<string> {
  if (stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

function compactBody(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

/**
 * Build the commander program for MVP commands.
 * Returns the program and a registry of which commands are handled.
 */
function buildProgram(): Command {
  const program = new Command();
  program
    .name('slock')
    .description('Agent-facing CLI for Slock communication')
    .version(readDaemonPackageVersion())
    .addOption(new Option('--format <mode>', 'Output format').choices(['text', 'json']).default('text'))
    // Suppress commander's own error/help output — we format errors ourselves
    .configureOutput({
      writeErr: () => {},
      outputError: () => {},
    })
    .exitOverride(); // Prevent process.exit on errors

  // ── message ──────────────────────────────────────────────────
  const messageCmd = program.command('message').description('Message operations');

  messageCmd
    .command('check')
    .description('Check for new messages')
    .option('--limit <n>', 'Max messages to fetch')
    .action(async () => { /* handled via unified action */ });

  messageCmd
    .command('read')
    .description('Read message history')
    .option('--channel <target>', 'Channel to read')
    .option('--target <target>', 'Alias for --channel')
    .option('--limit <n>', 'Max messages to fetch')
    .action(async () => {});

  messageCmd
    .command('send')
    .description('Send a message')
    .requiredOption('--target <target>', 'Message target (channel or dm:@user)')
    .option('--attachment-id <id>', 'Attachment ID (repeatable)', collectArray, [])
    .action(async () => {});

  // ── memory (smallkhoj extension) ─────────────────────────────
  const memoryCmd = program.command('memory').description('Memory operations (smallkhoj extension)');

  memoryCmd
    .command('read')
    .description('Read memory content')
    .requiredOption('--scope <type>', 'Memory scope (agent|channel|thread|task)')
    .requiredOption('--id <scopeId>', 'Scope ID')
    .requiredOption('--path <path>', 'Memory path')
    .action(async () => {});

  return program;
}

function collectArray(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Metadata for each MVP command. */
interface CommandMeta {
  /** Builds the proxy request from commander options + stdin. */
  buildRequest: (opts: Record<string, unknown>, config: ProxyConfig, env: NodeJS.ProcessEnv) => Promise<{
    method: string;
    path: string;
    body?: unknown;
    writeScope?: WriteScope;
  }>;
  /** Formats the successful proxy response for text mode. */
  formatText: (json: unknown) => string;
}

/** Shared memory scope validator (matches legacy requireMemoryScope). */
function validateMemoryScope(scope: string): string {
  if (!['agent', 'channel', 'thread', 'task'].includes(scope)) {
    throw new CliError(
      `Unsupported memory scope: ${scope}`,
      'INVALID_SCOPE',
      'Use one of: agent, channel, thread, task',
    );
  }
  return scope;
}

/** Shared memory path validator (matches legacy requireMemoryPath). */
function validateMemoryPath(rawPath: string): string {
  const normalized = rawPath.trim().replace(/^\/+/, '');
  if (!normalized) {
    throw new CliError('Missing --path', 'MISSING_PATH', 'Provide a memory path with --path <path>');
  }
  if (normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw new CliError('Invalid memory path', 'INVALID_PATH', 'Path segments must not be . or ..');
  }
  return normalized.split('/').map((part) => encodeURIComponent(part)).join('/');
}

const COMMAND_META: Record<string, CommandMeta> = {
  'message check': {
    async buildRequest(opts, config) {
      const query = new URLSearchParams();
      const limit = opts.limit as string | undefined;
      if (limit) query.set('limit', limit);
      const suffix = query.toString();
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/receive${suffix ? `?${suffix}` : ''}` };
    },
    formatText: formatMessageCheck,
  },
  'message read': {
    async buildRequest(opts, config) {
      const channel = (opts.channel as string) ?? (opts.target as string);
      const limit = opts.limit as string | undefined;
      const query = new URLSearchParams();
      if (channel) query.set('channel', channel);
      if (limit) query.set('limit', limit);
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/history?${query}` };
    },
    formatText: formatMessageRead,
  },
  'message send': {
    async buildRequest(opts, config, env) {
      const target = opts.target as string;
      const attachmentIds = opts.attachmentId as string[];
      // Get content from positional args or stdin
      const inline = ''; // positional args handled separately
      const content = inline || await readStdinText();
      if (!content) {
        throw new CliError('Missing message content', ErrorCodes.MISSING_CONTENT.code, ErrorCodes.MISSING_CONTENT.nextAction);
      }
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/send`,
        body: compactBody({
          target,
          content,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
        writeScope: writeScope(target),
      };
    },
    formatText: formatMessageSend,
  },
  'memory read': {
    async buildRequest(opts, config) {
      const scope = validateMemoryScope(opts.scope as string);
      const rawPath = validateMemoryPath(opts.path as string);
      return {
        method: 'GET',
        path: `${agentPrefix(config.agentId)}/memory/scopes/${scope}/${encodeURIComponent(opts.id as string)}/path/${rawPath}`,
      };
    },
    formatText: formatMemoryRead,
  },
};

/** Known options that take a value (to skip the value when scanning positionals). */
const VALUE_OPTIONS = new Set([
  '--format', '--limit', '--channel', '--target', '--scope', '--id', '--path',
  '--attachment-id', '--content', '-t', '-c', '-q', '-s',
]);

/** Check if argv matches an MVP command. Returns the meta key or null. */
function matchMvpCommand(argv: string[]): string | null {
  const mvpKeys = Object.keys(COMMAND_META);
  // Skip options AND their values to find group + command positionals
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (VALUE_OPTIONS.has(argv[i]) && i + 1 < argv.length) {
        i++; // skip the value too
      }
      continue;
    }
    positional.push(argv[i]);
  }
  if (positional.length < 2) return null;
  const key = `${positional[0]} ${positional[1]}`;
  return mvpKeys.includes(key) ? key : null;
}

/**
 * Handle an MVP command end-to-end.
 * Returns exit code (0 = success, 1 = error).
 */
async function handleMvpCommand(
  metaKey: string,
  argv: string[],
  io: CliIo,
): Promise<number> {
  const out = io.stdout ?? stdout;
  const err = io.stderr ?? stderr;
  const cliEnv = io.env ?? process.env;

  try {
    // Determine output format from argv
    let formatVal: string | undefined;
    const formatIdx = argv.indexOf('--format');
    if (formatIdx >= 0 && argv[formatIdx + 1]) {
      formatVal = argv[formatIdx + 1];
    }
    const format = parseFormat(formatVal);

    // Resolve proxy config
    const config = resolveProxyConfig(cliEnv);

    // Parse command-specific options using commander
    const program = buildProgram();
    // We need to extract positional args (message content for send) before commander parses
    // For message send, content comes from stdin or positional args after options
    let commandOpts: Record<string, unknown> = {};

    try {
      await program.parseAsync(['node', 'slock', ...argv], { from: 'node' });
    } catch (cmdErr: any) {
      // Commander throws for missing required options, unknown commands, etc.
      // Convert to CliError with appropriate code.
      const cmdErrCode = cmdErr?.code as string | undefined;
      if (cmdErrCode?.includes('missingMandatoryOption')) {
        // Extract option name from message like "error: required option '--target <target>' not specified"
        const msg = cmdErr.message || '';
        const optMatch = msg.match(/'(--[\w-]+)/);
        const optName = optMatch ? optMatch[1] : 'option';
        // Map option name to appropriate error code and next action
        const optErrorMap: Record<string, { code: string; nextAction: string }> = {
          '--target': { code: 'MISSING_TARGET', nextAction: 'Specify the target with --target "#channel" or --target dm:@user' },
          '--scope': { code: 'MISSING_SCOPE', nextAction: 'Provide --scope with one of: agent, channel, thread, task' },
          '--id': { code: 'MISSING_SCOPE_ID', nextAction: 'Provide the scope ID with --id <id>' },
          '--path': { code: 'MISSING_PATH', nextAction: 'Provide a memory path with --path <path>' },
        };
        const mapping = optErrorMap[optName] ?? { code: 'MISSING_OPTION', nextAction: `Provide ${optName}` };
        throw new CliError(`Missing required option ${optName}`, mapping.code, mapping.nextAction);
      }
      // For other commander errors, convert generically
      throw toCliError(cmdErr);
    }

    // Extract options from the matched command
    const matchedCmd = findCommand(program, metaKey);
    if (matchedCmd) {
      commandOpts = matchedCmd.opts();
    }

    // For message send, handle positional content
    if (metaKey === 'message send') {
      const positionals = extractPositionals(argv);
      const inlineContent = positionals.slice(2).join(' ').trim(); // skip group + command
      if (inlineContent) {
        commandOpts = { ...commandOpts, _inlineContent: inlineContent };
      }
    }

    const meta = COMMAND_META[metaKey];

    // Build the request
    let req;
    if (metaKey === 'message send' && (commandOpts as Record<string, unknown>)._inlineContent) {
      // Use inline content instead of stdin
      const target = commandOpts.target as string;
      const attachmentIds = (commandOpts.attachmentId as string[]) ?? [];
      const content = (commandOpts as Record<string, unknown>)._inlineContent as string;
      req = {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/send`,
        body: compactBody({
          target,
          content,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
        writeScope: writeScope(target),
      };
    } else {
      req = await meta.buildRequest(commandOpts, config, cliEnv);
    }

    // Write safety gate
    assertWriteAllowed(req.writeScope, cliEnv);

    // Execute request
    const response = await proxyRequest(config, req);

    if (!response.ok) {
      // Convert proxy failure to structured three-part error
      const errorText = enrichProxyFailure(response.text, response.status);
      // Check for special MEMORY_CONFLICT JSON response
      if (errorText.trim().startsWith('{') && errorText.includes('MEMORY_CONFLICT')) {
        err.write(errorText.endsWith('\n') ? errorText : errorText + '\n');
        return 1;
      }
      // Map HTTP status to code and next action
      const httpCode = `HTTP_${response.status}`;
      let nextAction: string | undefined;
      if (response.status === 401 || response.status === 403) {
        nextAction = 'Check that SLOCK_AGENT_PROXY_TOKEN_FILE points to a valid proxy token.';
      } else if (response.status === 404) {
        nextAction = 'Check that the target (channel, task, memory scope) exists and is accessible.';
      } else if (response.status >= 500) {
        nextAction = 'This is likely a server-side issue. Try again in a moment or check the backend.';
      }
      const cliErr = new CliError(errorText, httpCode, nextAction);
      err.write(formatError(cliErr));
      return 1;
    }

    // Format output
    if (format === 'json') {
      out.write(formatPassthrough(response.text));
    } else {
      // Try to parse JSON for canonical formatting
      try {
        const json = JSON.parse(response.text);
        out.write(meta.formatText(json));
      } catch {
        // Non-JSON response, passthrough
        out.write(formatPassthrough(response.text));
      }
    }
    return 0;
  } catch (e) {
    const cliErr = e instanceof CliError ? e : toCliError(e);
    err.write(formatError(cliErr));
    return cliErr.exitCode;
  }
}

/** Find a command in the program by meta key (e.g. "message check"). */
function findCommand(program: Command, metaKey: string): Command | null {
  const [group, cmd] = metaKey.split(' ');
  const groupCmd = program.commands.find((c) => c.name() === group);
  if (!groupCmd) return null;
  return groupCmd.commands.find((c) => c.name() === cmd) ?? null;
}

/** Extract positional arguments from argv (skipping options and their values). */
function extractPositionals(argv: string[]): string[] {
  const result: string[] = [];
  const knownValueOpts = new Set([
    '--limit', '--channel', '--target', '--scope', '--id', '--path',
    '--format', '--attachment-id', '--content', '-t', '-c', '-q',
  ]);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (knownValueOpts.has(argv[i]) && i + 1 < argv.length) {
        i++; // skip the value
      }
      continue;
    }
    result.push(argv[i]);
  }
  return result;
}

/**
 * Public entry point. Tries MVP commander path first, falls back to legacy.
 * Preserves the same signature as the original runSlockCli.
 */
export async function runSlockCli(argv: string[], io: CliIo = {}): Promise<number> {
  const mvpKey = matchMvpCommand(argv);
  if (mvpKey) {
    return handleMvpCommand(mvpKey, argv, io);
  }

  // Fall through to legacy handler for non-MVP commands
  return runLegacyCli(argv, io);
}

/**
 * Legacy CLI handler — delegates to the original parseRequest flow.
 * This ensures all non-MVP commands continue to work unchanged.
 */
async function runLegacyCli(argv: string[], io: CliIo): Promise<number> {
  const out = io.stdout ?? stdout;
  const err = io.stderr ?? stderr;
  const cliEnv = io.env ?? process.env;

  try {
    // Import legacy parser dynamically to avoid circular dependency at module load
    const { parseRequest } = await import('../slock-cli-legacy.js');
    const config = resolveProxyConfig(cliEnv);
    const request = await parseRequest(argv, cliEnv);

    // Legacy safety check
    if (request.safety) {
      assertWriteAllowed(
        { resources: request.safety.resources },
        cliEnv,
      );
    }

    // Handle multipart uploads (attachment upload, profile avatar)
    if (request.multipartUpload) {
      return await handleMultipartUpload(config, request, io);
    }

    // Handle raw output files (attachment download)
    if (request.rawOutputFile) {
      const dlResponse = await fetch(new URL(request.path, config.proxyUrl), {
        method: request.method,
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'X-Agent-Id': config.agentId,
        },
      });
      if (dlResponse.ok) {
        const buffer = Buffer.from(await dlResponse.arrayBuffer());
        writeFileSync(request.rawOutputFile, buffer);
        out.write(JSON.stringify({ ok: true, output: request.rawOutputFile }) + '\n');
        return 0;
      }
      const dlText = await dlResponse.text();
      const enriched = enrichProxyFailure(dlText, dlResponse.status);
      err.write(enriched.endsWith('\n') ? enriched : enriched + '\n');
      return 1;
    }

    const response = await proxyRequest(config, request);
    if (!response.ok) {
      const enriched = enrichProxyFailure(response.text, response.status);
      err.write(enriched.endsWith('\n') ? enriched : enriched + '\n');
      return 1;
    }
    out.write(formatPassthrough(response.text));
    return 0;
  } catch (e) {
    // Legacy handler preserves old JSON error format for non-MVP commands
    const err_ = e as Error & { code?: string; nextAction?: string };
    const errorJson = JSON.stringify({
      ok: false,
      code: err_.code ?? 'CLI_FAILED',
      message: err_.message,
    });
    err.write(errorJson + '\n');
    return 1;
  }
}

/** Handle multipart file uploads (kept from original logic). */
async function handleMultipartUpload(
  config: ProxyConfig,
  request: CliRequest,
  io: CliIo,
): Promise<number> {
  const { existsSync, statSync, readFileSync } = await import('fs');
  const { basename } = await import('path');
  const out = io.stdout ?? stdout;
  const err = io.stderr ?? stderr;
  const upload = request.multipartUpload;
  if (!upload) {
    const e = new CliError('Internal error: multipartUpload missing', 'CLI_FAILED');
    err.write(formatError(e));
    return 1;
  }

  if (!existsSync(upload.filePath)) {
    const e = new CliError(`File does not exist: ${upload.filePath}`, 'MISSING_FILE');
    err.write(formatError(e));
    return 1;
  }
  const stat = statSync(upload.filePath);
  if (!stat.isFile()) {
    const e = new CliError(`Not a regular file: ${upload.filePath}`, 'INVALID_FILE');
    err.write(formatError(e));
    return 1;
  }
  if (stat.size <= 0) {
    const e = new CliError('Refusing to upload a 0-byte attachment', 'INVALID_FILE');
    err.write(formatError(e));
    return 1;
  }

  const buffer = readFileSync(upload.filePath);
  const filename = basename(upload.filePath);
  const form = new FormData();

  const inferMime = (fn: string, buf: Buffer, explicit?: string): string => {
    if (explicit) return explicit;
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (buf.length >= 3 && buf.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
    const lower = fn.toLowerCase();
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.md')) return 'text/markdown';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
  };

  form.append(upload.fieldName, new Blob([buffer], { type: inferMime(filename, buffer, upload.mimeType) }), filename);

  if (upload.channelTarget) {
    const resolved = await fetch(new URL(`${agentPrefix(config.agentId)}/resolve-channel`, config.proxyUrl), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'X-Agent-Id': config.agentId,
      },
      body: JSON.stringify({ target: upload.channelTarget }),
    });
    const resolvedText = await resolved.text();
    if (!resolved.ok) {
      const enriched = enrichProxyFailure(resolvedText, resolved.status);
      err.write(enriched.endsWith('\n') ? enriched : enriched + '\n');
      return 1;
    }
    const channelId = (JSON.parse(resolvedText) as { channelId?: string }).channelId;
    if (!channelId) {
      const e = new CliError(`Could not resolve channel: ${upload.channelTarget}`, 'RESOLVE_FAILED');
      err.write(formatError(e));
      return 1;
    }
    form.append('channelId', channelId);
  }
  if (upload.mimeType) form.append('mimeType', upload.mimeType);

  const response = await fetch(new URL(request.path, config.proxyUrl), {
    method: request.method,
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'X-Agent-Id': config.agentId,
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    const enriched = enrichProxyFailure(text, response.status);
    err.write(enriched.endsWith('\n') ? enriched : enriched + '\n');
    return 1;
  }
  out.write(formatPassthrough(text));
  return 0;
}

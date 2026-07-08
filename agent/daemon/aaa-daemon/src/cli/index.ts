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
  formatMessageSearch,
  formatMessageResolve,
  formatReact,
  formatServerInfo,
  formatChannelMembers,
  formatChannelAction,
  formatThreadRead,
  formatThreadUnfollow,
  formatTaskList,
  formatTaskAction,
  formatProfileShow,
  formatProfileUpdate,
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
 * Build the commander program for all migrated commands.
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

  messageCmd.command('check').description('Check for new messages')
    .option('--limit <n>', 'Max messages to fetch').action(async () => {});

  messageCmd.command('read').description('Read message history')
    .option('--channel <target>', 'Channel to read').option('--target <target>', 'Alias for --channel')
    .option('-c <target>', 'Short for --channel').option('--limit <n>', 'Max messages to fetch').action(async () => {});

  messageCmd.command('send').description('Send a message')
    .requiredOption('--target <target>', 'Message target (channel or dm:@user)')
    .option('--attachment-id <id>', 'Attachment ID (repeatable)', collectArray, [])
    .action(async () => {});

  messageCmd.command('search').description('Search messages')
    .option('--query <text>', 'Search query').option('-q <text>', 'Short for --query')
    .option('--channel <target>', 'Filter by channel').option('--target <target>', 'Alias for --channel')
    .option('-c <target>', 'Short for --channel').option('--limit <n>', 'Max results').action(async () => {});

  messageCmd.command('resolve').description('Resolve a message target')
    .option('--message-id <id>', 'Message ID').option('--message <id>', 'Alias for --message-id')
    .option('-m <id>', 'Short for --message-id').option('--id <id>', 'Alias for --message-id').action(async () => {});

  messageCmd.command('react').description('Add or remove a reaction')
    .option('--message-id <id>', 'Message ID').option('--message <id>', 'Alias for --message-id')
    .option('-m <id>', 'Short for --message-id').option('--id <id>', 'Alias for --message-id')
    .option('--reaction <value>', 'Reaction emoji or value').option('--emoji <value>', 'Alias for --reaction')
    .option('-r <value>', 'Short for --reaction').option('--remove', 'Remove reaction instead of adding')
    .option('--delete', 'Alias for --remove')
    .action(async () => {});

  // ── server ───────────────────────────────────────────────────
  const serverCmd = program.command('server').description('Server operations');
  serverCmd.command('info').description('Server / workspace introspection').action(async () => {});

  // ── channel ──────────────────────────────────────────────────
  const channelCmd = program.command('channel').description('Channel operations');

  channelCmd.command('members').description('List channel members')
    .option('--channel <target>', 'Channel name')
    .option('--target <target>', 'Alias for --channel').option('-c <target>', 'Short for --channel').action(async () => {});

  channelCmd.command('join').description('Join a channel')
    .option('--target <target>', 'Channel to join')
    .option('--channel <target>', 'Alias for --target')
    .option('-c <target>', 'Short for --target')
    .option('--channel-id <id>', 'Channel ID').action(async () => {});

  channelCmd.command('leave').description('Leave a channel')
    .option('--target <target>', 'Channel to leave')
    .option('--channel <target>', 'Alias for --target')
    .option('-c <target>', 'Short for --target')
    .option('--channel-id <id>', 'Channel ID').action(async () => {});

  // ── thread ───────────────────────────────────────────────────
  const threadCmd = program.command('thread').description('Thread operations');

  threadCmd.command('read').description('Read thread messages')
    .option('--thread-id <id>', 'Thread ID').option('--id <id>', 'Alias for --thread-id').action(async () => {});

  threadCmd.command('unfollow').description('Stop following a thread')
    .option('--target <id>', 'Thread ID or target').option('--thread-id <id>', 'Alias for --target')
    .option('--id <id>', 'Alias for --target').action(async () => {});

  // ── memory (smallkhoj extension) ─────────────────────────────
  const memoryCmd = program.command('memory').description('Memory operations (smallkhoj extension)');

  memoryCmd.command('read').description('Read memory content')
    .requiredOption('--scope <type>', 'Memory scope (agent|channel|thread|task)')
    .requiredOption('--id <scopeId>', 'Scope ID')
    .requiredOption('--path <path>', 'Memory path')
    .action(async () => {});

  // ── task ─────────────────────────────────────────────────────
  const taskCmd = program.command('task').description('Task board operations');

  // ── profile ──────────────────────────────────────────────────
  const profileCmd = program.command('profile').description('Profile operations');

  profileCmd.command('show').description('Show profile')
    .option('--handle <name>', 'User handle').option('-h <name>', 'Short for --handle')
    .action(async () => {});
  // 'get' as alias for 'show'
  profileCmd.command('get').description('Alias for show')
    .option('--handle <name>', 'User handle').option('-h <name>', 'Short for --handle')
    .action(async () => {});

  profileCmd.command('update').description('Update profile')
    .option('--display-name <name>', 'Display name').option('--description <text>', 'Description')
    .option('--bio <text>', 'Alias for --description').option('--avatar-url <url>', 'Avatar URL')
    .option('--avatar-file <path>', 'Upload avatar from file')
    .option('--mime-type <type>', 'MIME type for avatar file').option('--content-type <type>', 'Alias for --mime-type')
    .option('--status <status>', 'Status').option('--json <data>', 'JSON data payload')
    .action(async () => {});

  taskCmd.command('list').description('List tasks')
    .option('--channel <target>', 'Filter by channel').option('--status <status>', 'Filter by status')
    .action(async () => {});

  taskCmd.command('create').description('Create a task')
    .option('--title <title>', 'Task title (repeatable for batch)', collectArray, [])
    .option('--channel <target>', 'Channel').option('--assignee <id>', 'Assignee').option('-a <id>', 'Short for --assignee')
    .option('--status <status>', 'Initial status').option('--message-id <id>', 'Source message ID')
    .option('--json <data>', 'JSON data payload')
    .action(async () => {});

  taskCmd.command('claim').description('Claim a task')
    .option('--channel <target>', 'Channel').option('--number <n>', 'Task number (repeatable)', collectArray, [])
    .option('--message-id <id>', 'Message ID (repeatable)', collectArray, [])
    .option('--id <id>', 'Task ID').option('--task-id <id>', 'Alias for --id')
    .option('--assignee <id>', 'Assignee').option('-a <id>', 'Short for --assignee')
    .action(async () => {});

  taskCmd.command('unclaim').description('Unclaim a task')
    .option('--channel <target>', 'Channel').option('--number <n>', 'Task number')
    .option('--id <id>', 'Task ID').option('--task-id <id>', 'Alias for --id')
    .action(async () => {});

  taskCmd.command('update').description('Update a task')
    .option('--channel <target>', 'Channel').option('--number <n>', 'Task number')
    .option('--id <id>', 'Task ID').option('--task-id <id>', 'Alias for --id')
    .option('--status <status>', 'New status').option('--title <title>', 'New title')
    .option('--assignee <id>', 'New assignee').option('-a <id>', 'Short for --assignee')
    .option('--json <data>', 'JSON data payload')
    .action(async () => {});

  taskCmd.command('summary').description('Write task memory summary (smallkhoj extension)')
    .option('--id <id>', 'Task ID').option('--task-id <id>', 'Alias for --id')
    .option('--summary <text>', 'Summary text').option('--final-summary <text>', 'Alias for --summary')
    .option('--text <text>', 'Alias for --summary').option('--progress <text>', 'Progress description')
    .option('--evidence <text>', 'Evidence (repeatable)', collectArray, [])
    .option('--artifact <text>', 'Artifact (repeatable)', collectArray, [])
    .option('--next-step <text>', 'Next step (repeatable)', collectArray, [])
    .action(async () => {});

  taskCmd.command('promote').description('Promote task memory to channel (smallkhoj extension)')
    .option('--id <id>', 'Task ID').option('--task-id <id>', 'Alias for --id')
    .option('--source-path <path>', 'Source memory path').option('--path <path>', 'Alias for --source-path')
    .option('--channel-path <path>', 'Channel memory path').option('--reason <text>', 'Promotion reason')
    .option('--proposal', 'Create as proposal')
    .action(async () => {});

  return program;
}

function collectArray(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function requirePositiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new CliError(`${name} must be a positive integer; got ${raw}`, 'INVALID_NUMBER');
  }
  return value;
}

/** Parse a --json option value, throwing INVALID_JSON on failure (matches legacy contract). */
function parseJsonOptionValue(raw: string | undefined, name: string): unknown | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError(`Invalid ${name} JSON: ${raw}`, 'INVALID_JSON', `Provide valid JSON for ${name}`);
  }
}

/** Metadata for each migrated command. */
interface CommandMeta {
  /** Builds the proxy request from commander options + stdin. */
  buildRequest: (opts: Record<string, unknown>, config: ProxyConfig, env: NodeJS.ProcessEnv) => Promise<{
    method: string;
    path: string;
    body?: unknown;
    writeScope?: WriteScope;
    [key: string]: unknown;
  }>;
  /** Formats the successful proxy response for text mode. */
  formatText: (json: unknown, opts?: Record<string, unknown>, request?: Record<string, unknown>) => string;
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
      const channel = (opts.channel as string) ?? (opts.target as string) ?? (opts.c as string);
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
  // ── Batch 2: message search/resolve/react ──
  'message search': {
    async buildRequest(opts, config) {
      const q = (opts.query as string) ?? (opts.q as string) ?? ((opts._positionals as string[]) ?? []).join(' ').trim();
      if (!q) throw new CliError('Missing --query', ErrorCodes.MISSING_QUERY.code, ErrorCodes.MISSING_QUERY.nextAction);
      const channel = (opts.channel as string) ?? (opts.target as string) ?? (opts.c as string);
      const limit = opts.limit as string | undefined;
      const query = new URLSearchParams();
      query.set('q', q);
      if (channel) query.set('channel', channel);
      if (limit) query.set('limit', limit);
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/search?${query}` };
    },
    formatText: formatMessageSearch,
  },
  'message resolve': {
    async buildRequest(opts, config) {
      const messageId = (opts.messageId as string) ?? (opts.message as string) ?? (opts.id as string) ?? (opts.m as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!messageId) throw new CliError('Missing --message-id', ErrorCodes.MISSING_MESSAGE_ID.code, ErrorCodes.MISSING_MESSAGE_ID.nextAction);
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/messages/${encodeURIComponent(messageId)}/resolve` };
    },
    formatText: formatMessageResolve,
  },
  'message react': {
    async buildRequest(opts, config) {
      const pos = (opts._positionals as string[]) ?? [];
      const messageId = (opts.messageId as string) ?? (opts.message as string) ?? (opts.id as string) ?? (opts.m as string) ?? pos[0];
      if (!messageId) throw new CliError('Missing --message-id', ErrorCodes.MISSING_MESSAGE_ID.code, ErrorCodes.MISSING_MESSAGE_ID.nextAction);
      const reaction = (opts.reaction as string) ?? (opts.emoji as string) ?? (opts.r as string) ?? pos[1];
      if (!reaction) throw new CliError('Missing --reaction', ErrorCodes.MISSING_REACTION.code, ErrorCodes.MISSING_REACTION.nextAction);
      const remove = opts.remove === true || opts.delete === true;
      return {
        method: remove ? 'DELETE' : 'POST',
        path: `${agentPrefix(config.agentId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        body: { reaction },
        writeScope: writeScope(messageId),
        _isRemove: remove,
      };
    },
    formatText: (json, _opts, request) => {
      const isRemove = (request as Record<string, unknown>)?._isRemove === true;
      return isRemove ? 'Reaction removed.\n' : 'Reaction added.\n';
    },
  },
  // ── Batch 2: server info ──
  'server info': {
    async buildRequest(_opts, config) {
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/server` };
    },
    formatText: formatServerInfo,
  },
  // ── Batch 2: channel members/join/leave ──
  'channel members': {
    async buildRequest(opts, config) {
      const channel = (opts.channel as string) ?? (opts.target as string) ?? (opts.c as string);
      if (!channel) throw new CliError('Missing --channel', ErrorCodes.MISSING_CHANNEL.code, ErrorCodes.MISSING_CHANNEL.nextAction);
      const query = new URLSearchParams();
      query.set('channel', channel);
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/channel-members?${query}` };
    },
    formatText: formatChannelMembers,
  },
  'channel join': {
    async buildRequest(opts, config) {
      const channel = (opts.target as string) ?? (opts.channel as string) ?? (opts.c as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!channel) throw new CliError('Missing --target or --channel', 'MISSING_CHANNEL', 'Specify the channel with --target "#channel"');
      const channelId = opts.channelId as string | undefined;
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/channels/${encodeURIComponent(channelId ?? channel)}/join`,
        writeScope: writeScope(channel),
      };
    },
    formatText: (json) => formatChannelAction(json, 'join'),
  },
  'channel leave': {
    async buildRequest(opts, config) {
      const channel = (opts.target as string) ?? (opts.channel as string) ?? (opts.c as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!channel) throw new CliError('Missing --target or --channel', 'MISSING_CHANNEL', 'Specify the channel with --target "#channel"');
      const channelId = opts.channelId as string | undefined;
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/channels/${encodeURIComponent(channelId ?? channel)}/leave`,
        writeScope: writeScope(channel),
      };
    },
    formatText: (json) => formatChannelAction(json, 'leave'),
  },
  // ── Batch 2: thread read/unfollow ──
  'thread read': {
    async buildRequest(opts, config) {
      const threadId = (opts.threadId as string) ?? (opts.id as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!threadId) throw new CliError('Missing --thread-id', 'MISSING_THREAD_ID', 'Specify the thread ID with --thread-id <id>');
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/threads/${encodeURIComponent(threadId)}` };
    },
    formatText: formatThreadRead,
  },
  'thread unfollow': {
    async buildRequest(opts, config) {
      const target = (opts.target as string) ?? (opts.threadId as string) ?? (opts.id as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!target) throw new CliError('Missing --target or --thread-id', 'MISSING_THREAD_ID', 'Specify the thread ID with --target <id>');
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/threads/unfollow`,
        body: { threadId: target },
        writeScope: writeScope(`thread:${target}`),
      };
    },
    formatText: formatThreadUnfollow,
  },
  // ── Batch 3: task commands ──
  'task list': {
    async buildRequest(opts, config) {
      const channel = opts.channel as string | undefined;
      const status = opts.status as string | undefined;
      const query = new URLSearchParams();
      if (channel) query.set('channel', channel);
      if (status) query.set('status', status);
      const suffix = query.toString();
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/tasks${suffix ? `?${suffix}` : ''}` };
    },
    formatText: formatTaskList,
  },
  'task create': {
    async buildRequest(opts, config) {
      const titles = (opts.title as string[]) ?? [];
      const pos = (opts._positionals as string[]) ?? [];
      const title = titles[0] ?? pos.join(' ').trim();
      const channel = opts.channel as string;
      if (!title) throw new CliError('Missing --title', ErrorCodes.MISSING_TITLE.code, ErrorCodes.MISSING_TITLE.nextAction);
      if (!channel) throw new CliError('Missing --channel', ErrorCodes.MISSING_CHANNEL.code, ErrorCodes.MISSING_CHANNEL.nextAction);
      const body = titles.length > 0
        ? { channel, tasks: titles.map((item) => ({ title: item })) }
        : compactBody({
            title,
            channel,
            assignee: (opts.assignee as string) ?? (opts.a as string),
            status: opts.status as string,
            messageId: opts.messageId as string,
            data: parseJsonOptionValue(opts.json as string, '--json'),
          });
      return { method: 'POST', path: `${agentPrefix(config.agentId)}/tasks`, body, writeScope: writeScope(channel) };
    },
    formatText: (json) => formatTaskAction(json, 'create'),
  },
  'task claim': {
    async buildRequest(opts, config) {
      const channel = opts.channel as string | undefined;
      const numbers = ((opts.number as string[]) ?? []).map((raw) => requirePositiveInteger(raw, '--number'));
      const messageIds = (opts.messageId as string[]) ?? [];
      if (channel && (numbers.length > 0 || messageIds.length > 0)) {
        return {
          method: 'POST',
          path: `${agentPrefix(config.agentId)}/tasks/claim`,
          body: compactBody({ channel, task_numbers: numbers.length > 0 ? numbers : undefined, message_ids: messageIds.length > 0 ? messageIds : undefined }),
          writeScope: writeScope(channel),
        };
      }
      const taskId = (opts.id as string) ?? (opts.taskId as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!taskId) throw new CliError('Missing --id or --channel with --number/--message-id', ErrorCodes.MISSING_TASK_ID.code, ErrorCodes.MISSING_TASK_ID.nextAction);
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/tasks/${encodeURIComponent(taskId)}/claim`,
        body: compactBody({ assignee: (opts.assignee as string) ?? (opts.a as string) }),
        writeScope: writeScope(taskId),
      };
    },
    formatText: (json) => formatTaskAction(json, 'claim'),
  },
  'task unclaim': {
    async buildRequest(opts, config) {
      const channel = opts.channel as string | undefined;
      const number = opts.number as string | undefined;
      if (channel && number && !opts.id && !opts.taskId) {
        return {
          method: 'POST',
          path: `${agentPrefix(config.agentId)}/tasks/update-status`,
          body: { channel, task_number: requirePositiveInteger(number, '--number'), status: 'todo' },
          writeScope: writeScope(channel),
        };
      }
      const taskId = (opts.id as string) ?? (opts.taskId as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!taskId) throw new CliError('Missing --id or --channel with --number', ErrorCodes.MISSING_TASK_ID.code, ErrorCodes.MISSING_TASK_ID.nextAction);
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/tasks/${encodeURIComponent(taskId)}/unclaim`,
        writeScope: writeScope(taskId),
      };
    },
    formatText: (json) => formatTaskAction(json, 'unclaim'),
  },
  'task update': {
    async buildRequest(opts, config) {
      const channel = opts.channel as string | undefined;
      const number = opts.number as string | undefined;
      const status = opts.status as string | undefined;
      if (channel && number && status && !opts.id && !opts.taskId) {
        return {
          method: 'POST',
          path: `${agentPrefix(config.agentId)}/tasks/update-status`,
          body: { channel, task_number: requirePositiveInteger(number, '--number'), status },
          writeScope: writeScope(channel),
        };
      }
      const taskId = (opts.id as string) ?? (opts.taskId as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!taskId) throw new CliError('Missing --id', 'MISSING_TASK_ID', 'Specify the task with --id <id> or --channel with --number');
      const body = compactBody({
        title: opts.title as string,
        status,
        assignee: (opts.assignee as string) ?? (opts.a as string),
        channel,
        data: parseJsonOptionValue(opts.json as string, '--json'),
      });
      if (Object.keys(body).length === 0) throw new CliError('Missing task update fields', 'MISSING_UPDATE_FIELDS', 'Provide at least one of --status, --title, --assignee, --json');
      return {
        method: 'PATCH',
        path: `${agentPrefix(config.agentId)}/tasks/${encodeURIComponent(taskId)}`,
        body,
        writeScope: writeScope(taskId, channel),
      };
    },
    formatText: (json) => formatTaskAction(json, 'update'),
  },
  'task summary': {
    async buildRequest(opts, config) {
      const taskId = (opts.id as string) ?? (opts.taskId as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!taskId) throw new CliError('Missing task id', ErrorCodes.MISSING_TASK_ID.code, ErrorCodes.MISSING_TASK_ID.nextAction);
      const inline = (opts.summary as string) ?? (opts.finalSummary as string) ?? (opts.text as string);
      const finalSummary = inline || await readStdinText();
      if (!finalSummary) throw new CliError('Missing --summary', 'MISSING_SUMMARY', 'Provide summary via --summary or stdin');
      const evidence = (opts.evidence as string[]) ?? [];
      const artifacts = (opts.artifact as string[]) ?? [];
      const nextSteps = (opts.nextStep as string[]) ?? [];
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/tasks/${encodeURIComponent(taskId)}/memory/summary`,
        body: compactBody({
          finalSummary,
          progress: opts.progress as string,
          evidence: evidence.length > 0 ? evidence : undefined,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
        }),
        writeScope: writeScope(`task:${taskId}:memory`),
      };
    },
    formatText: (json) => formatTaskAction(json, 'summary'),
  },
  'task promote': {
    async buildRequest(opts, config) {
      const taskId = (opts.id as string) ?? (opts.taskId as string) ?? ((opts._positionals as string[]) ?? [])[0];
      if (!taskId) throw new CliError('Missing task id', ErrorCodes.MISSING_TASK_ID.code, ErrorCodes.MISSING_TASK_ID.nextAction);
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/tasks/${encodeURIComponent(taskId)}/memory/promote`,
        body: compactBody({
          sourcePath: (opts.sourcePath as string) ?? (opts.path as string),
          channelPath: opts.channelPath as string,
          reason: opts.reason as string,
          proposal: opts.proposal === true || undefined,
        }),
        writeScope: writeScope(`task:${taskId}:memory`, opts.channelPath as string),
      };
    },
    formatText: (json) => formatTaskAction(json, 'promote'),
  },
  // ── Batch 4: profile commands ──
  'profile show': {
    async buildRequest(opts, config) {
      const handle = (opts.handle as string) ?? (opts.h as string) ?? ((opts._positionals as string[]) ?? [])[0];
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/profile${handle ? `/${encodeURIComponent(handle)}` : ''}` };
    },
    formatText: formatProfileShow,
  },
  'profile get': {
    async buildRequest(opts, config) {
      const handle = (opts.handle as string) ?? (opts.h as string) ?? ((opts._positionals as string[]) ?? [])[0];
      return { method: 'GET', path: `${agentPrefix(config.agentId)}/profile${handle ? `/${encodeURIComponent(handle)}` : ''}` };
    },
    formatText: formatProfileShow,
  },
  'profile update': {
    async buildRequest(opts, config) {
      const avatarFile = opts.avatarFile as string | undefined;
      if (avatarFile) {
        return {
          method: 'POST',
          path: `${agentPrefix(config.agentId)}/profile/avatar`,
          multipartUpload: {
            filePath: avatarFile,
            fieldName: 'avatar',
            mimeType: (opts.mimeType as string) ?? (opts.contentType as string),
          },
          writeScope: writeScope('profile'),
        };
      }
      const body = compactBody({
        displayName: opts.displayName as string,
        description: (opts.description as string) ?? (opts.bio as string),
        avatarUrl: opts.avatarUrl as string,
        status: opts.status as string,
        data: parseJsonOptionValue(opts.json as string, '--json'),
      });
      if (Object.keys(body).length === 0) throw new CliError('Missing profile update fields', 'MISSING_UPDATE_FIELDS', 'Provide at least one of --display-name, --description, --avatar-url, --status, --json');
      return {
        method: 'POST',
        path: `${agentPrefix(config.agentId)}/profile`,
        body,
        writeScope: writeScope('profile'),
      };
    },
    formatText: formatProfileUpdate,
  },
};

/** Known options that take a value (to skip the value when scanning positionals). */
const VALUE_OPTIONS = new Set([
  '--format', '--limit', '--channel', '--target', '--scope', '--id', '--path',
  '--attachment-id', '--content', '--query', '--message-id', '--reaction',
  '--thread-id', '--channel-id', '--message', '--emoji',
  '--task-id', '--number', '--status', '--title', '--assignee', '--json',
  '--summary', '--final-summary', '--text', '--progress', '--source-path',
  '--channel-path', '--reason',
  '--handle', '--display-name', '--description', '--bio', '--avatar-url',
  '--avatar-file', '--mime-type', '--content-type',
  '-t', '-c', '-q', '-s', '-m', '-r', '-a', '-h',
]);

/** Check if argv matches a migrated command. Returns the meta key or null. */
function matchMigratedCommand(argv: string[]): string | null {
  const migratedKeys = Object.keys(COMMAND_META);
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
  return migratedKeys.includes(key) ? key : null;
}

/**
 * Handle an MVP command end-to-end.
 * Returns exit code (0 = success, 1 = error).
 */
async function handleMigratedCommand(
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
          '--message-id': { code: 'MISSING_MESSAGE_ID', nextAction: 'Specify the message ID with --message-id <id>' },
          '--reaction': { code: 'MISSING_REACTION', nextAction: 'Specify the reaction with --reaction <value>' },
          '--query': { code: 'MISSING_QUERY', nextAction: 'Provide a search query with --query "text"' },
          '--channel': { code: 'MISSING_CHANNEL', nextAction: 'Specify the channel with --channel "#channel"' },
          '--thread-id': { code: 'MISSING_THREAD_ID', nextAction: 'Specify the thread ID with --thread-id <id>' },
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

    // Add positional args for commands that accept them
    const positionals = extractPositionals(argv);
    const cmdPositionals = positionals.slice(2); // skip group + command
    if (cmdPositionals.length > 0) {
      commandOpts = { ...commandOpts, _positionals: cmdPositionals };
    }

    // For message send, handle positional content
    if (metaKey === 'message send') {
      const inlineContent = cmdPositionals.join(' ').trim();
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

    // Handle multipart uploads (e.g. profile avatar)
    if ((req as Record<string, unknown>).multipartUpload) {
      return await handleMultipartUploadFormatted(config, req as CliRequest, io, format, meta.formatText);
    }

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
        out.write(meta.formatText(json, commandOpts, req as Record<string, unknown>));
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (VALUE_OPTIONS.has(argv[i]) && i + 1 < argv.length) {
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
  const migratedKey = matchMigratedCommand(argv);
  if (migratedKey) {
    return handleMigratedCommand(migratedKey, argv, io);
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

/**
 * Handle multipart upload with format-aware output for migrated commands.
 * In text mode, uses the command's formatter instead of raw passthrough.
 */
async function handleMultipartUploadFormatted(
  config: ProxyConfig,
  request: CliRequest,
  io: CliIo,
  format: OutputFormat,
  formatText: (json: unknown, opts?: Record<string, unknown>, request?: Record<string, unknown>) => string,
): Promise<number> {
  const out = io.stdout ?? stdout;
  const err = io.stderr ?? stderr;
  const { existsSync, statSync, readFileSync } = await import('fs');
  const { basename } = await import('path');
  const upload = request.multipartUpload!;

  if (!existsSync(upload.filePath)) {
    err.write(formatError(new CliError(`File does not exist: ${upload.filePath}`, 'MISSING_FILE')));
    return 1;
  }
  const stat = statSync(upload.filePath);
  if (!stat.isFile() || stat.size <= 0) {
    err.write(formatError(new CliError('Invalid file for upload', 'INVALID_FILE')));
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
    return 'application/octet-stream';
  };
  form.append(upload.fieldName, new Blob([buffer], { type: inferMime(filename, buffer, upload.mimeType) }), filename);
  if (upload.mimeType) form.append('mimeType', upload.mimeType);

  const response = await fetch(new URL(request.path, config.proxyUrl), {
    method: request.method,
    headers: { 'Authorization': `Bearer ${config.token}`, 'X-Agent-Id': config.agentId },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    const enriched = enrichProxyFailure(text, response.status);
    err.write(enriched.endsWith('\n') ? enriched : enriched + '\n');
    return 1;
  }

  if (format === 'json') {
    out.write(formatPassthrough(text));
  } else {
    try {
      out.write(formatText(JSON.parse(text)));
    } catch {
      out.write(formatPassthrough(text));
    }
  }
  return 0;
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildFoundationGateReport,
  formatGateSummary,
  parseClaudeContextUsage,
  parseDaemonRuntimeHealth,
  parseRuntimeControlEvidence,
} from './foundation-gate.mjs';
import {
  buildChatGateReport,
  formatChatGateSummary,
  isSlockMessageSendCommand,
} from './chat-gate.mjs';
import {
  buildCollabGateReport,
  COLLAB_GATE_SCENARIOS,
  formatCollabGateSummary,
} from './collab-gate.mjs';
import { CHAT_GATE_SCENARIOS } from './chat-gate.mjs';
import { redactGateReport, writeGateReport } from './report-store.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  failConfiguration('INVALID_ARGUMENT', error);
}

if (args.help) {
  process.stdout.write([
    'Usage: node tools/integration-gate/run.mjs [options]',
    '',
    'Options:',
    '  --mode <mode>            foundation-only (default), chat-reply-channel-base, chat-reply-channel-group, chat-reply-dm, collab-channel-v1, collab-channel-v2, collab-channel-v3',
    '  --api-base <url>          Backend API base (default: http://localhost:8000)',
    '  --frontend-base <url>     Frontend base (default: http://127.0.0.1:3000)',
    '  --public-key <key>        Public API key header (default: NEXT_PUBLIC_API_KEY or sk_public_local)',
    '  --account-token <token>   Browser account/session token for login/session check',
    '  --server-id <id>          Required explicit Server tenant target',
    '  --agent-id <id>           Runtime agent id for chat gate modes',
    '  --channel <name>          Channel name/id for channel chat gate modes',
    '  --channel-id <id>         Durable channel id for channel chat gate modes',
    '  --expected-agent-ids <ids>  Comma-separated expected channel responder agent ids',
    '  --architect-agent-id <id>  Architect role agent id for collaboration modes',
    '  --worker-agent-id <id>     Worker role agent id for collaboration modes',
    '  --reviewer-agent-id <id>   Reviewer role agent id for collaboration V2 modes',
    '  --human-member-id <id>     Human member id for collaboration modes',
    '  --peer <handle>           DM peer handle/display name for chat-reply-dm',
    '  --user-member-id <id>     Explicit human member id for DM evidence',
    '  --trace-id <id>           Explicit trace id for deterministic test runs',
    '  --marker <text>           Explicit marker for deterministic test runs',
    '  --expected-ack <text>     Explicit expected acknowledgement text',
    '  --reply-timeout-ms <n>    Chat reply polling timeout (default: 180000)',
    '  --poll-interval-ms <n>    Chat polling interval (default: 1500)',
    '  --responder-policy <one|all|explicit>  Channel group responder policy (default: one)',
    '  --context-output <path>   File containing Claude Code /context markdown output',
    '  --runtime-control-result <path>  JSON result from daemon runtime_control',
    '  --daemon-rpc-base <url>   Local daemon proxy base for POST /internal/daemon/jsonrpc',
    '  --runtime-agent-id <id>   Agent id whose managed runtime should receive runtime_control',
    '  --runtime-control-timeout-ms <n>  Runtime-control result wait timeout (default: 30000)',
    '  --limit-error <text>      Known provider/context/quota error text to classify',
    '  --result-out <path>       Persist full gate report JSON for control UI consumption',
    '  --result-dir <path>       Atomic gate report store (default: .runtime/integration-gate)',
    '  --json                    Print full machine-readable report',
    '',
  ].join('\n'));
  process.exit(0);
}

const apiBase = args.apiBase ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const frontendBase = args.frontendBase ?? process.env.FRONTEND_BASE ?? 'http://127.0.0.1:3000';
const publicKey = args.publicKey ?? process.env.NEXT_PUBLIC_API_KEY ?? 'sk_public_local';
const accountToken = args.accountToken ?? process.env.SMALLKHOJ_ACCOUNT_TOKEN;
const mode = args.mode ?? 'foundation-only';
const serverId = args.serverId ?? process.env.SMALLKHOJ_SERVER_ID;
const supportedModes = ['foundation-only', ...CHAT_GATE_SCENARIOS, ...COLLAB_GATE_SCENARIOS];
if (!serverId) failConfiguration('SERVER_ID_REQUIRED');
if (!supportedModes.includes(mode)) failConfiguration('UNSUPPORTED_MODE', new Error(mode));
const resultDir = args.resultDir ?? process.env.SMALLKHOJ_GATE_RESULT_DIR ?? resolve('.runtime/integration-gate');
const gateStartedAt = new Date().toISOString();

const [frontendOnline, computersSnapshot] = await Promise.all([
  checkFrontend(frontendBase),
  fetchComputers(apiBase, publicKey, accountToken, serverId),
]);

if (mode.startsWith('chat-reply-')) {
  const chatReport = await runChatReplyGate({
    args,
    mode,
    apiBase,
    publicKey,
    accountToken,
    serverId,
    frontendOnline,
    computersSnapshot,
  });

  const finalChatReport = finalizeReport(chatReport);
  writeGateReport({ report: finalChatReport, resultDir, resultOut: args.resultOut });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(finalChatReport, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatChatGateSummary(finalChatReport)}\n`);
  }

  process.exit(finalChatReport.ok ? 0 : 1);
}

if (mode.startsWith('collab-channel-')) {
  const collabReport = await runCollabGate({
    args,
    mode,
    apiBase,
    publicKey,
    accountToken,
    serverId,
    frontendOnline,
    computersSnapshot,
  });

  const finalCollabReport = finalizeReport(collabReport);
  writeGateReport({ report: finalCollabReport, resultDir, resultOut: args.resultOut });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(finalCollabReport, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatCollabGateSummary(finalCollabReport)}\n`);
  }

  process.exit(finalCollabReport.ok ? 0 : 1);
}

const contextUsage = args.contextOutput
  ? parseClaudeContextUsage(readFileSync(args.contextOutput, 'utf-8'))
  : null;
const runtimeControlEvidence = args.runtimeControlResult
  ? parseRuntimeControlEvidence(JSON.parse(readFileSync(args.runtimeControlResult, 'utf-8')))
  : args.daemonRpcBase
    ? parseRuntimeControlEvidence(await fetchRuntimeControlEvidence({
      daemonRpcBase: args.daemonRpcBase,
      agentId: args.runtimeAgentId ?? selectRuntimeAgentId(computersSnapshot.computers),
      timeoutMs: args.runtimeControlTimeoutMs ?? 30_000,
    }))
    : {};
const runtimeHealth = args.daemonRpcBase
  ? parseDaemonRuntimeHealth(await fetchDaemonLogs(args.daemonRpcBase))
  : null;

const report = buildFoundationGateReport({
  authenticated: Boolean(accountToken),
  frontendOnline,
  backendOnline: computersSnapshot.backendOnline,
  computers: computersSnapshot.computers,
  contextUsage: runtimeControlEvidence.contextUsage ?? contextUsage,
  limitError: args.limitError,
  limitFailure: runtimeControlEvidence.limitFailure,
  runtimeHealth,
});
if (runtimeControlEvidence.action || runtimeControlEvidence.limitFailure || runtimeControlEvidence.contextUsage) {
  report.runtimeControl = runtimeControlEvidence;
}
if (runtimeHealth) {
  report.runtimeHealth = runtimeHealth;
}

const finalReport = finalizeReport(report);
writeGateReport({ report: finalReport, resultDir, resultOut: args.resultOut });

if (args.json) {
  process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
} else {
  process.stdout.write(`${formatGateSummary(finalReport)}\n`);
}

process.exit(finalReport.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--mode') {
      parsed.mode = requiredValue(argv, index += 1, arg);
    } else if (arg === '--api-base') {
      parsed.apiBase = requiredValue(argv, index += 1, arg);
    } else if (arg === '--frontend-base') {
      parsed.frontendBase = requiredValue(argv, index += 1, arg);
    } else if (arg === '--public-key') {
      parsed.publicKey = requiredValue(argv, index += 1, arg);
    } else if (arg === '--account-token') {
      parsed.accountToken = requiredValue(argv, index += 1, arg);
    } else if (arg === '--server-id') {
      parsed.serverId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--agent-id') {
      parsed.agentId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--channel') {
      parsed.channel = requiredValue(argv, index += 1, arg);
    } else if (arg === '--channel-id') {
      parsed.channelId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--expected-agent-ids') {
      parsed.expectedAgentIds = requiredValue(argv, index += 1, arg);
    } else if (arg === '--architect-agent-id') {
      parsed.architectAgentId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--worker-agent-id') {
      parsed.workerAgentId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--reviewer-agent-id') {
      parsed.reviewerAgentId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--human-member-id') {
      parsed.humanMemberId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--peer') {
      parsed.peer = requiredValue(argv, index += 1, arg);
    } else if (arg === '--user-member-id') {
      parsed.userMemberId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--trace-id') {
      parsed.traceId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--marker') {
      parsed.marker = requiredValue(argv, index += 1, arg);
    } else if (arg === '--expected-ack') {
      parsed.expectedAck = requiredValue(argv, index += 1, arg);
    } else if (arg === '--reply-timeout-ms') {
      parsed.replyTimeoutMs = positiveNumberArg(argv, index += 1, arg);
    } else if (arg === '--poll-interval-ms') {
      parsed.pollIntervalMs = positiveNumberArg(argv, index += 1, arg);
    } else if (arg === '--responder-policy') {
      parsed.responderPolicy = requiredValue(argv, index += 1, arg);
    } else if (arg === '--context-output') {
      parsed.contextOutput = requiredValue(argv, index += 1, arg);
    } else if (arg === '--runtime-control-result') {
      parsed.runtimeControlResult = requiredValue(argv, index += 1, arg);
    } else if (arg === '--daemon-rpc-base') {
      parsed.daemonRpcBase = requiredValue(argv, index += 1, arg);
    } else if (arg === '--runtime-agent-id') {
      parsed.runtimeAgentId = requiredValue(argv, index += 1, arg);
    } else if (arg === '--runtime-control-timeout-ms') {
      parsed.runtimeControlTimeoutMs = positiveNumberArg(argv, index += 1, arg);
    } else if (arg === '--limit-error') {
      parsed.limitError = requiredValue(argv, index += 1, arg);
    } else if (arg === '--result-out') {
      parsed.resultOut = requiredValue(argv, index += 1, arg);
    } else if (arg === '--result-dir') {
      parsed.resultDir = requiredValue(argv, index += 1, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function positiveNumberArg(argv, index, flag) {
  const value = Number(requiredValue(argv, index, flag));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${flag}`);
  }
  return value;
}

async function runChatReplyGate({
  args,
  mode,
  apiBase,
  publicKey,
  accountToken,
  serverId,
  frontendOnline,
  computersSnapshot,
}) {
  const startedAt = new Date().toISOString();
  const runId = `chat-gate-${Date.now().toString(36)}`;
  const traceId = args.traceId ?? `chat-gate:${runId}`;
  const marker = args.marker ?? `CHAT-GATE:${Date.now().toString(36)}`;
  const expectedAck = args.expectedAck ?? `ACK ${marker}`;
  const agent = selectRuntimeAgent(computersSnapshot.computers, args.agentId);
  const headers = publicHeaders(publicKey, accountToken, serverId);
  const replyTimeoutMs = args.replyTimeoutMs ?? 180_000;
  const pollIntervalMs = args.pollIntervalMs ?? 1_500;
  let target = await prepareChatTarget({ mode, args, apiBase, headers, agent });
  let sentMessage = null;
  let latestMessages = [];
  let latestActivity = [];
  let sendError = null;

  if (target.readyForSend) {
    try {
      const audienceChannelId = target.channelId;
      const sendResult = await sendChatMarker({
        apiBase,
        headers,
        channelName: target.channelName,
        traceId,
        marker,
        expectedAck,
      });
      sentMessage = sendResult.message;
      const resolvedChannelId = target.channelId ?? sentMessage?.channelId ?? null;
      let resolvedVisibleAgentIds = target.visibleAgentIds;
      if (target.kind === 'channel-group' && resolvedChannelId && resolvedChannelId !== audienceChannelId) {
        const resolvedMembers = await fetchChannelMembers({ apiBase, headers, channelId: resolvedChannelId });
        resolvedVisibleAgentIds = resolvedMembers
          .filter((member) => member.kind === 'agent')
          .map((member) => member.id)
          .filter(Boolean);
      }
      target = {
        ...target,
        channelId: resolvedChannelId,
        visibleAgentIds: resolvedVisibleAgentIds,
        dmId: target.dmId ?? (target.kind === 'dm' ? sentMessage?.channelId ?? null : null),
        userMemberId: target.userMemberId ?? (target.kind === 'dm' ? sentMessage?.senderId ?? null : null),
        replyTarget: target.replyTarget ?? (target.kind === 'dm' && sentMessage?.sender
          ? `dm:${sentMessage.sender}`
          : target.replyTarget),
      };
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
    }
  }

  const deadline = Date.now() + replyTimeoutMs;
  let report = null;
  do {
    if (target.channelName) {
      latestMessages = await fetchChannelMessages({ apiBase, headers, channelName: target.channelName });
    }
    if (agent?.id) {
      latestActivity = await fetchRuntimeActivity({ apiBase, headers, agentId: agent.id });
    }
    report = buildReport();
    if (report.ok) break;
    if (Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  } while (true);

  return report ?? buildReport();

  function buildReport() {
    const runtimeEvidence = reduceRuntimeActivity(latestActivity, { traceId, marker, userMessageId: sentMessage?.id });
    const replies = extractReplies(latestMessages, {
      userMessageId: sentMessage?.id,
      agentId: agent?.id,
      targetId: target.kind === 'dm' ? target.dmId : target.channelId,
    });
    const latency = buildChatLatency({
      sentMessage,
      replies,
      expectedAck,
      marker,
      runtimeEvidence,
    });
    const foundationOk = Boolean(
      accountToken
      && frontendOnline
      && computersSnapshot.backendOnline
      && agent?.id
      && agent?.status === 'running'
      && !sendError
    );

    return buildChatGateReport({
      scenario: mode,
      runId,
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      foundation: { ok: foundationOk },
      agent: agent ? {
        id: agent.id,
        name: agent.name,
        computerId: agent.computerId,
        daemonId: agent.daemonId,
        runtimeProvider: agent.runtimeProvider,
        runtimeModel: agent.runtimeModel,
        runtimeKind: agent.runtimeKind,
        sessionId: agent.sessionId,
      } : null,
      target,
      marker,
      expectedAck,
      messages: {
        userMessageId: sentMessage?.id ?? null,
        replies,
      },
      delivery: {
        eventCommitted: Boolean(sentMessage?.id),
        delivered: runtimeEvidence.delivered,
        providerThinking: runtimeEvidence.providerThinking,
        runtimeIdle: runtimeEvidence.runtimeIdle,
        timeline: runtimeEvidence.timeline,
        error: sendError,
      },
      toolEvidence: runtimeEvidence.toolEvidence,
      usage: runtimeEvidence.usage,
      context: null,
      latency,
      ...(sendError ? { limitError: sendError } : {}),
    });
  }
}

async function runCollabGate({
  args,
  mode,
  apiBase,
  publicKey,
  accountToken,
  serverId,
  frontendOnline,
  computersSnapshot,
}) {
  const startedAt = new Date().toISOString();
  const runId = `collab-gate-${Date.now().toString(36)}`;
  const traceId = args.traceId ?? `collab-gate:${runId}`;
  const marker = args.marker ?? `COLLAB-GATE:${Date.now().toString(36)}`;
  const headers = publicHeaders(publicKey, accountToken, serverId);
  const replyTimeoutMs = args.replyTimeoutMs ?? 180_000;
  const pollIntervalMs = args.pollIntervalMs ?? 1_500;
  const channelName = (args.channel ?? 'gate-lab').replace(/^#/, '');
  const channel = {
    id: args.channelId ?? null,
    name: channelName,
    replyTarget: `#${channelName}`,
  };
  const architect = selectRuntimeAgent(computersSnapshot.computers, args.architectAgentId ?? args.agentId);
  const worker = selectRuntimeAgent(computersSnapshot.computers, args.workerAgentId);
  const reviewer = args.reviewerAgentId
    ? selectRuntimeAgent(computersSnapshot.computers, args.reviewerAgentId)
    : null;
  let audienceChannelId = channel.id;
  const members = channel.id
    ? await fetchChannelMembers({ apiBase, headers, channelId: channel.id })
    : [];
  const visibleAgentIds = members
    .filter((member) => member.kind === 'agent')
    .map((member) => member.id)
    .filter(Boolean);
  const roles = {
    humanMemberId: args.humanMemberId ?? null,
    architectAgentId: args.architectAgentId ?? architect?.id ?? null,
    workerAgentId: args.workerAgentId ?? worker?.id ?? null,
    reviewerAgentId: args.reviewerAgentId ?? reviewer?.id ?? null,
    visibleAgentIds,
    rolePolicy: mode === 'collab-channel-v2'
      ? 'architect-worker-reviewer'
      : mode === 'collab-channel-v3'
        ? 'architect-worker-task'
        : 'architect-delegates-worker',
  };
  let sentMessage = null;
  let sendError = null;
  let latestMessages = [];
  let architectActivity = [];
  let workerActivity = [];
  let reviewerActivity = [];
  let latestTasks = [];

  try {
    const sendResult = await sendCollabMarker({
      apiBase,
      headers,
      channelName,
      traceId,
      marker,
      mode,
      roles,
    });
    sentMessage = sendResult.message;
    channel.id = channel.id ?? sentMessage?.channelId ?? null;
    roles.humanMemberId = roles.humanMemberId ?? sentMessage?.senderId ?? null;
    if (channel.id && channel.id !== audienceChannelId) {
      const resolvedMembers = await fetchChannelMembers({ apiBase, headers, channelId: channel.id });
      roles.visibleAgentIds = resolvedMembers
        .filter((member) => member.kind === 'agent')
        .map((member) => member.id)
        .filter(Boolean);
      audienceChannelId = channel.id;
    }
  } catch (error) {
    sendError = error instanceof Error ? error.message : String(error);
  }

  const deadline = Date.now() + replyTimeoutMs;
  let report = null;
  do {
    latestMessages = await fetchChannelMessages({ apiBase, headers, channelName });
    if (roles.architectAgentId) {
      architectActivity = await fetchRuntimeActivity({ apiBase, headers, agentId: roles.architectAgentId });
    }
    if (roles.workerAgentId) {
      workerActivity = await fetchRuntimeActivity({ apiBase, headers, agentId: roles.workerAgentId });
    }
    if (roles.reviewerAgentId) {
      reviewerActivity = await fetchRuntimeActivity({ apiBase, headers, agentId: roles.reviewerAgentId });
    }
    if (mode === 'collab-channel-v3') {
      latestTasks = await fetchTasks({ apiBase, headers });
    }
    report = buildReport();
    if (report.ok) break;
    if (Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  } while (true);

  return report ?? buildReport();

  function buildReport() {
    const messages = extractCollabMessages(latestMessages, { marker, channelId: channel.id });
    const workerEvidence = reduceCollabWorkerActivity(workerActivity, { marker, workerAgentId: roles.workerAgentId });
    const artifactEvidence = buildArtifactEvidence({
      marker,
      workerAgentId: roles.workerAgentId,
      workerResult: messages.workerResult,
      workerEvidence,
    });
    const reviewEvidence = buildReviewEvidence({
      reviewerAgentId: roles.reviewerAgentId,
      reviewerValidation: messages.reviewerValidation,
    });
    const taskEvidence = buildTaskEvidence({
      tasks: latestTasks,
      workerAgentId: roles.workerAgentId,
      channelId: channel.id,
      humanRequestId: sentMessage?.id ?? messages.humanRequest?.id ?? null,
    });
    const foundationOk = Boolean(
      accountToken
      && frontendOnline
      && computersSnapshot.backendOnline
      && roles.architectAgentId
      && roles.workerAgentId
      && architect?.status === 'running'
      && worker?.status === 'running'
      && (mode !== 'collab-channel-v2' || reviewer?.status === 'running')
      && !sendError
    );

    return buildCollabGateReport({
      scenario: mode,
      runId,
      traceId,
      startedAt,
      completedAt: new Date().toISOString(),
      foundation: { ok: foundationOk },
      marker,
      channel,
      roles,
      messages: {
        ...messages,
        humanRequest: messages.humanRequest ?? normalizeCollabMessage(sentMessage, channel.id),
      },
      delivery: {
        architectDelivered: architectActivity.length > 0 || Boolean(messages.architectDelegation),
        workerDelivered: workerActivity.length > 0 || Boolean(messages.workerResult),
        reviewerDelivered: mode !== 'collab-channel-v2' || reviewerActivity.length > 0 || Boolean(messages.reviewerValidation),
        error: sendError,
      },
      toolEvidence: workerEvidence.toolEvidence,
      artifactEvidence,
      reviewEvidence,
      taskEvidence,
      roleTimeline: buildRoleTimelineFromMessages(messages),
      latency: buildCollabLatency({
        humanRequest: sentMessage ?? messages.humanRequest,
        architectFinal: messages.architectFinal,
      }),
      usage: workerEvidence.usage,
      context: null,
      ...(sendError ? { limitError: sendError } : {}),
    });
  }
}

function publicHeaders(publicKey, accountToken, serverId) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Public-Key': publicKey,
    'X-Server-Id': serverId,
  };
  if (accountToken) headers['X-Account-Token'] = accountToken;
  return headers;
}

function selectRuntimeAgent(computers, requestedAgentId) {
  const candidates = computers.flatMap((computer) => {
    const workspaces = Array.isArray(computer.agentWorkspaces) ? computer.agentWorkspaces : [];
    return workspaces
      .filter((workspace) => !requestedAgentId || workspace.agentId === requestedAgentId)
      .map((workspace) => ({
        id: workspace.agentId,
        name: workspace.agentName,
        status: workspace.status,
        computerId: computer.id,
        daemonId: computer.daemonId,
        runtimeProvider: workspace.runtimeProvider,
        runtimeModel: workspace.runtimeModel,
        runtimeKind: workspace.runtime,
        sessionId: workspace.sessionId,
      }));
  });
  return candidates.find((candidate) => candidate.status === 'running') ?? candidates[0] ?? null;
}

async function prepareChatTarget({ mode, args, apiBase, headers, agent }) {
  if (mode === 'chat-reply-dm') {
    const dm = await createOrGetDmTarget({ apiBase, headers, peer: args.peer ?? agent?.name ?? agent?.id });
    return {
      kind: 'dm',
	      dmId: dm?.id ?? args.channelId ?? null,
	      channelId: dm?.id ?? args.channelId ?? null,
	      channelName: dm?.name ?? args.channel ?? null,
	      userMemberId: args.userMemberId ?? null,
	      agentMemberId: agent?.id ?? null,
	      replyTarget: null,
      resolved: Boolean(dm?.id),
      reusedOrCreated: dm ? 'resolved' : null,
      readyForSend: Boolean(dm?.name),
    };
  }

  const channelName = (args.channel ?? 'general').replace(/^#/, '');
  const members = args.channelId
    ? await fetchChannelMembers({ apiBase, headers, channelId: args.channelId })
    : [];
  const visibleAgentIds = members
    .filter((member) => member.kind === 'agent')
    .map((member) => member.id)
    .filter(Boolean);
  const expectedResponderAgentIds = splitCsv(args.expectedAgentIds)
    ?? (agent?.id ? [agent.id] : []);

  return {
    kind: mode === 'chat-reply-channel-group' ? 'channel-group' : 'channel',
    channelId: args.channelId ?? null,
    channelName,
    replyTarget: `#${channelName}`,
    visibleAgentIds: mode === 'chat-reply-channel-group'
      ? visibleAgentIds
      : uniqueStrings([...visibleAgentIds, ...expectedResponderAgentIds]),
    expectedResponderAgentIds,
    responderPolicy: args.responderPolicy ?? 'one',
    readyForSend: Boolean(channelName),
  };
}

async function createOrGetDmTarget({ apiBase, headers, peer }) {
  if (!peer) return null;
  const response = await fetch(new URL('/api/v1/dm', apiBase), {
    method: 'POST',
    headers,
    body: JSON.stringify({ peer }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.channel ?? null;
}

async function sendChatMarker({ apiBase, headers, channelName, traceId, marker, expectedAck }) {
  const response = await fetch(new URL(`/api/v1/channels/${encodeURIComponent(channelName)}/messages`, apiBase), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      traceId,
      content: [
        `[integration-chat-gate ${marker}]`,
        '请只通过 slock message send 在同一个聊天目标回复以下确认文本：',
        expectedAck,
      ].join('\n'),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`CHAT_MESSAGE_SEND_FAILED HTTP ${response.status}`);
  }
  return response.json();
}

async function sendCollabMarker({ apiBase, headers, channelName, traceId, marker, mode, roles }) {
  const artifact = buildCollabArtifactContract({ mode, marker });
  const response = await fetch(new URL(`/api/v1/channels/${encodeURIComponent(channelName)}/messages`, apiBase), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      traceId,
      content: [
        `[integration-collab-gate ${marker}]`,
        `Scenario: ${mode}`,
        `Architect: ${roles.architectAgentId ?? 'unknown'}`,
        `Worker: ${roles.workerAgentId ?? 'unknown'}`,
        roles.reviewerAgentId ? `Reviewer: ${roles.reviewerAgentId}` : null,
        '请通过同一个频道完成受控协作，并在每个阶段回复对应 [COLLAB:<marker>:...] 标签。',
        `Required tags: [COLLAB:${marker}:ARCHITECT_DELEGATION], [COLLAB:${marker}:WORKER_RESULT], [COLLAB:${marker}:ARCHITECT_FINAL].`,
        `Worker proof contract: proof=${artifact.artifactId} checksum=${artifact.checksum}.`,
        `Worker result format: [COLLAB:${marker}:WORKER_RESULT] proof=${artifact.artifactId} checksum=${artifact.checksum}`,
        `Architect final must cite proof=${artifact.artifactId} checksum=${artifact.checksum}.`,
        mode === 'collab-channel-v2'
          ? `Reviewer validation format: [COLLAB:${marker}:REVIEWER_ACCEPTED] proof=${artifact.artifactId} checksum=${artifact.checksum} accepted`
          : null,
        mode === 'collab-channel-v3'
          ? 'Task workflow evidence must link the task to this channel request before final summary; final must cite the task id/status and the worker proof.'
          : null,
      ].filter(Boolean).join('\n'),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`COLLAB_MESSAGE_SEND_FAILED HTTP ${response.status}`);
  }
  return response.json();
}

function buildCollabArtifactContract({ mode, marker }) {
  const version = mode === 'collab-channel-v2'
    ? 'v2'
    : mode === 'collab-channel-v3'
      ? 'v3'
      : 'v1';
  return {
    artifactId: `artifact-${version}`,
    checksum: `sha256:${createHash('sha256').update(`${mode}:${marker}`).digest('hex').slice(0, 12)}`,
  };
}

async function fetchChannelMessages({ apiBase, headers, channelName }) {
  try {
    const response = await fetch(new URL(`/api/v1/channels/${encodeURIComponent(channelName)}/messages?limit=80&threadMode=roots`, apiBase), {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

async function fetchChannelMembers({ apiBase, headers, channelId }) {
  try {
    const response = await fetch(new URL(`/api/v1/channels/${encodeURIComponent(channelId)}/members`, apiBase), {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.members) ? data.members : [];
  } catch {
    return [];
  }
}

async function fetchRuntimeActivity({ apiBase, headers, agentId }) {
  try {
    const response = await fetch(new URL(`/api/v1/activity?agentId=${encodeURIComponent(agentId)}&limit=80`, apiBase), {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.activity) ? data.activity : [];
  } catch {
    return [];
  }
}

async function fetchTasks({ apiBase, headers }) {
  try {
    const response = await fetch(new URL('/api/v1/tasks', apiBase), {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch {
    return [];
  }
}

function extractCollabMessages(messages, { marker, channelId }) {
  const normalized = messages
    .map((message) => normalizeCollabMessage(message, channelId))
    .filter(Boolean)
    .filter((message) => !marker || message.content.includes(marker));
  const agentMessages = normalized.filter((message) => message.senderType === 'agent');
  return {
    humanRequest: normalized.find((message) => message.content.includes('[integration-collab-gate') || message.content.includes(':HUMAN_REQUEST]')) ?? null,
    architectDelegation: agentMessages.find((message) => hasCollabStageTag(message, marker, 'ARCHITECT_DELEGATION')) ?? null,
    workerResult: agentMessages.find((message) => hasCollabStageTag(message, marker, 'WORKER_RESULT')) ?? null,
    reviewerValidation: agentMessages.find((message) => (
      hasCollabStageTag(message, marker, 'REVIEWER_ACCEPTED')
      || hasCollabStageTag(message, marker, 'REVIEWER_REJECTED')
    )) ?? null,
    architectFinal: agentMessages.find((message) => hasCollabStageTag(message, marker, 'ARCHITECT_FINAL')) ?? null,
  };
}

function hasCollabStageTag(message, marker, stage) {
  const content = String(message?.content ?? '').trimStart();
  if (marker) return content.startsWith(`[COLLAB:${marker}:${stage}]`);
  return new RegExp(`^\\[COLLAB:[^\\]]+:${stage}\\]`).test(content);
}

function normalizeCollabMessage(message, fallbackChannelId) {
  if (!message || typeof message !== 'object') return null;
  return {
    id: message.id ?? null,
    authorId: message.senderId ?? message.authorId ?? null,
    targetId: message.channelId ?? message.targetId ?? fallbackChannelId ?? null,
    content: String(message.content ?? ''),
    createdAt: message.createdAt ?? message.time ?? null,
    senderType: message.senderType ?? message.authorType ?? null,
    visible: true,
    raw: message,
  };
}

function reduceCollabWorkerActivity(activity, { marker, workerAgentId }) {
  const matching = activity
    .filter((item) => {
      const details = item.details ?? {};
      return JSON.stringify(details).includes(marker ?? '');
    })
    .sort((left, right) => activityTimeMs(left) - activityTimeMs(right));
  const toolEvidence = matching
    .filter((item) => (
      item.type === 'runtime_output'
      || item.kind === 'runtime_output'
      || item.type === 'message_sent'
      || item.kind === 'message_sent'
    ))
    .map((item) => {
      const details = item.details ?? {};
      const isMessageSent = item.type === 'message_sent' || item.kind === 'message_sent';
      const content = String(details.content ?? details.messageSnippet ?? '');
      return {
        agentId: workerAgentId,
        toolName: isMessageSent ? 'slock_message_send' : (details.toolName ?? details.name ?? 'runtime_output'),
        commandPreview: isMessageSent ? content : (details.commandPreview ?? details.command ?? details.input ?? ''),
        ok: details.ok !== false,
        artifactId: details.artifactId ?? matchFirst(content, /\b(?:proof|artifact)=([A-Za-z0-9._:-]+)/),
        checksum: details.checksum ?? matchFirst(content, /\bchecksum=([A-Za-z0-9._:-]+)/),
        marker: details.marker,
      };
    });
  const idle = matching.find((item) => item.type === 'runtime_idle' || item.kind === 'runtime_idle');
  return {
    toolEvidence,
    usage: normalizeRuntimeUsage(idle?.details),
  };
}

function buildArtifactEvidence({ marker, workerAgentId, workerResult, workerEvidence }) {
  const tool = workerEvidence.toolEvidence.find((item) => item.artifactId || item.checksum);
  const content = workerResult?.content ?? '';
  const artifactId = tool?.artifactId ?? matchFirst(content, /\b(?:proof|artifact)=([A-Za-z0-9._:-]+)/);
  const checksum = tool?.checksum ?? matchFirst(content, /\bchecksum=([A-Za-z0-9._:-]+)/);
  return {
    ok: Boolean(artifactId && checksum && workerResult?.visible === true),
    artifactId: artifactId ?? null,
    checksum: checksum ?? null,
    marker,
    workerAgentId,
  };
}

function buildReviewEvidence({ reviewerAgentId, reviewerValidation }) {
  if (!reviewerValidation) return null;
  const content = reviewerValidation.content ?? '';
  return {
    accepted: /\b(REVIEWER_ACCEPTED|accepted|pass|通过)\b/i.test(content)
      ? true
      : /\b(REVIEWER_REJECTED|rejected|fail|拒绝)\b/i.test(content)
        ? false
        : null,
    reviewerAgentId,
    messageId: reviewerValidation.id,
  };
}

function buildTaskEvidence({ tasks, workerAgentId, channelId, humanRequestId }) {
  const task = tasks.find((item) => (
    (item.sourceMessageId ?? item.messageId) === humanRequestId
    || (item.sourceChannelId ?? item.channelId) === channelId
  ));
  if (!task) return null;
  const sourceChannelId = task.sourceChannelId ?? task.channelId ?? null;
  const sourceMessageId = task.sourceMessageId ?? task.messageId ?? null;
  const reviewVisible = task.reviewVisible === true || task.data?.reviewVisible === true || ['in_review', 'done'].includes(task.status);
  return {
    ok: Boolean(task.id && task.assigneeId === workerAgentId && sourceChannelId === channelId && sourceMessageId === humanRequestId && reviewVisible),
    taskId: task.id,
    status: task.status,
    assigneeId: task.assigneeId,
    sourceChannelId,
    sourceMessageId,
    reviewVisible,
  };
}

function buildRoleTimelineFromMessages(messages) {
  return [
    ['human', 'request', messages.humanRequest],
    ['architect', 'delegation', messages.architectDelegation],
    ['worker', 'result', messages.workerResult],
    ['reviewer', 'validation', messages.reviewerValidation],
    ['architect', 'final', messages.architectFinal],
  ]
    .filter(([, , message]) => message)
    .map(([role, action, message]) => ({
      role,
      action,
      messageId: message.id,
      agentId: message.authorId,
      at: message.createdAt,
    }));
}

function buildCollabLatency({ humanRequest, architectFinal }) {
  return {
    totalRequestToFinalMs: elapsedMs(humanRequest?.createdAt ?? humanRequest?.time, architectFinal?.createdAt),
  };
}

function matchFirst(text, pattern) {
  const match = String(text ?? '').match(pattern);
  return match?.[1] ?? null;
}

function reduceRuntimeActivity(activity, { traceId, marker, userMessageId }) {
  const sorted = [...activity]
    .sort((left, right) => activityTimeMs(left) - activityTimeMs(right));
  const exactMatching = sorted
    .filter((item) => activityMatchesRun(item, { traceId, marker, userMessageId }));
  const turnWindow = runtimeTurnWindow(exactMatching, sorted);
  const matching = sorted.filter((item) => {
    if (activityMatchesRun(item, { traceId, marker, userMessageId })) return true;
    if (!turnWindow) return false;
    const at = activityTimeMs(item);
    return Number.isFinite(at) && at >= turnWindow.startMs && at <= turnWindow.endMs;
  });
  const hasKind = (kind) => matching.some((item) => item.type === kind || item.kind === kind);
  const toolEvidence = matching
    .filter((item) => item.type === 'runtime_output' || item.kind === 'runtime_output')
    .map((item) => {
      const details = item.details ?? {};
      const commandPreview = details.commandPreview ?? details.command ?? details.input ?? details.text ?? '';
      return {
        toolName: details.toolName ?? details.name ?? 'runtime_output',
        toolId: details.toolId ?? details.id,
        commandPreview,
        isSlockMessageSend: isSlockMessageSendCommand(commandPreview),
        ok: details.ok !== false,
        target: inferTargetFromCommand(commandPreview),
        replyMessageId: details.replyMessageId,
        matchingMethod: details.traceId === traceId ? 'traceId' : 'fallbackWindow',
      };
    });
  const idle = matching.find((item) => item.type === 'runtime_idle' || item.kind === 'runtime_idle');
  return {
    delivered: hasKind('runtime_working'),
    providerThinking: hasKind('runtime_thinking'),
    runtimeIdle: hasKind('runtime_idle'),
    timeline: matching.map((item) => ({
      kind: item.type ?? item.kind,
      at: item.timestamp ?? item.occurredAt ?? null,
      details: item.details ?? {},
    })),
    toolEvidence,
    usage: normalizeRuntimeUsage(idle?.details),
  };
}

function normalizeRuntimeUsage(details) {
  if (!details || typeof details !== 'object') return null;
  if (details.usage && typeof details.usage === 'object') return details.usage;
  if (details.tokenUsage && typeof details.tokenUsage === 'object') return details.tokenUsage;
  const tokens = details.tokens;
  if (!tokens || typeof tokens !== 'object') return null;
  return {
    inputTokens: numberOrNull(tokens.input ?? tokens.inputTokens),
    outputTokens: numberOrNull(tokens.output ?? tokens.outputTokens),
    cacheReadTokens: numberOrNull(tokens.cacheRead ?? tokens.cacheReadTokens ?? tokens.cache_read_input_tokens),
    durationMs: numberOrNull(details.durationMs),
    wallClockMs: numberOrNull(details.wallClockMs),
    usageSource: details.usageSource ?? null,
    runSpecific: true,
  };
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function runtimeTurnWindow(exactMatching, sorted) {
  if (exactMatching.length === 0) return null;
  const startAnchor = exactMatching.find((item) => (item.type ?? item.kind) === 'runtime_working') ?? exactMatching[0];
  const startMs = activityTimeMs(startAnchor);
  if (!Number.isFinite(startMs)) return null;
  const latestExactMs = Math.max(...exactMatching.map(activityTimeMs).filter(Number.isFinite));
  const idle = sorted.find((item) => {
    const kind = item.type ?? item.kind;
    const at = activityTimeMs(item);
    return kind === 'runtime_idle' && Number.isFinite(at) && at >= latestExactMs;
  });
  const endMs = idle ? activityTimeMs(idle) : Date.now();
  return { startMs, endMs };
}

function activityTimeMs(item) {
  const at = Date.parse(item?.timestamp ?? item?.occurredAt ?? '');
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

function activityMatchesRun(item, { traceId, marker, userMessageId }) {
  const details = item?.details ?? {};
  const text = JSON.stringify(details);
  if (traceId && details.traceId === traceId) return true;
  if (userMessageId && details.messageId === userMessageId) return true;
  return Boolean(marker && text.includes(marker));
}

function extractReplies(messages, { userMessageId, agentId, targetId }) {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);
  const afterUser = userIndex >= 0 ? messages.slice(userIndex + 1) : messages;
  return afterUser
    .filter((message) => message.senderType === 'agent' || message.senderId === agentId)
    .map((message) => ({
      id: message.id,
      authorId: message.senderId,
      targetId: message.channelId ?? targetId,
      content: message.content ?? '',
      createdAt: message.createdAt ?? message.time ?? null,
      visible: true,
    }));
}

function buildChatLatency({ sentMessage, replies, expectedAck, marker, runtimeEvidence }) {
  const timeline = Array.isArray(runtimeEvidence?.timeline) ? runtimeEvidence.timeline : [];
  const userPersistedAt = sentMessage?.createdAt ?? sentMessage?.time ?? null;
  const matchingReply = selectMatchingReply(replies, { expectedAck, marker });
  const replyPersistedAt = matchingReply?.createdAt ?? null;
  const runtimeWorkingAt = firstTimelineAt(timeline, 'runtime_working');
  const providerThinkingAt = firstTimelineAt(timeline, 'runtime_thinking');
  const firstToolAt = firstTimelineAt(timeline, 'runtime_output');
  const slockSendAt = firstTimelineAt(timeline, 'runtime_output', (item) => (
    isSlockMessageSendCommand(item?.details?.commandPreview ?? item?.details?.command)
  ));
  const idleAt = firstTimelineAt(timeline, 'runtime_idle');
  return {
    sendToPersistMs: null,
    persistToRuntimeDeliveryMs: elapsedMs(userPersistedAt, runtimeWorkingAt),
    deliveryToThinkingMs: elapsedMs(runtimeWorkingAt, providerThinkingAt),
    thinkingToToolMs: elapsedMs(providerThinkingAt, firstToolAt),
    toolToReplyPersistMs: elapsedMs(slockSendAt ?? firstToolAt, replyPersistedAt),
    replyPersistToVisibleMs: matchingReply?.visible === true ? 0 : null,
    totalSendToVisibleMs: elapsedMs(userPersistedAt, replyPersistedAt),
    runtimeWallClockMs: runtimeEvidence?.usage?.wallClockMs ?? null,
    providerDurationApiMs: runtimeEvidence?.usage?.providerDurationApiMs ?? null,
    runtimeIdleAt: idleAt,
  };
}

function selectMatchingReply(replies, { expectedAck, marker }) {
  const expected = String(expectedAck ?? '');
  const runMarker = String(marker ?? '');
  return replies.find((reply) => {
    const content = String(reply?.content ?? '');
    return Boolean((expected && content.includes(expected)) || (runMarker && content.includes(runMarker)));
  }) ?? replies[0] ?? null;
}

function firstTimelineAt(timeline, kind, predicate = null) {
  const item = timeline.find((entry) => (
    entry?.kind === kind && (!predicate || predicate(entry))
  ));
  return item?.at ?? null;
}

function inferTargetFromCommand(commandPreview) {
  const match = String(commandPreview ?? '').match(/--target\s+("[^"]+"|'[^']+'|\S+)/);
  return match ? match[1].replace(/^['"]|['"]$/g, '') : null;
}

function splitCsv(value) {
  if (!value) return null;
  const items = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : null;
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedMs(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;
}

async function checkFrontend(frontendBase) {
  try {
    const response = await fetch(new URL('/control/integration', frontendBase), {
      redirect: 'manual',
      signal: AbortSignal.timeout(2500),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

async function fetchComputers(apiBase, publicKey, accountToken, serverId) {
  try {
    const headers = { 'X-Public-Key': publicKey, 'X-Server-Id': serverId };
    if (accountToken) headers['X-Account-Token'] = accountToken;
    const response = await fetch(new URL('/api/v1/computers', apiBase), {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return { backendOnline: false, computers: [] };
    const data = await response.json();
    return {
      backendOnline: true,
      computers: Array.isArray(data.computers) ? data.computers : [],
    };
  } catch {
    return { backendOnline: false, computers: [] };
  }
}

function finalizeReport(report) {
  const completedAt = report.completedAt ?? new Date().toISOString();
  const normalizedMode = report.mode ?? report.scenario ?? mode;
  return redactGateReport({
    ...report,
    schemaVersion: 1,
    runId: report.runId ?? `${normalizedMode}-${Date.now().toString(36)}`,
    mode: normalizedMode,
    startedAt: report.startedAt ?? gateStartedAt,
    completedAt,
    target: {
      ...(report.target && typeof report.target === 'object' ? report.target : {}),
      apiBase,
      frontendBase,
      daemonRpcBase: args.daemonRpcBase ?? null,
      serverId,
    },
  });
}

function failConfiguration(code, error = null) {
  const safeDetail = code === 'UNSUPPORTED_MODE' && error instanceof Error
    ? ` mode=${JSON.stringify(error.message)}`
    : '';
  process.stderr.write(`CONFIG_ERROR ${code}${safeDetail}\n`);
  process.exit(2);
}

function selectRuntimeAgentId(computers) {
  const candidates = computers.flatMap((computer) => {
    const workspaces = Array.isArray(computer.agentWorkspaces) ? computer.agentWorkspaces : [];
    return workspaces.filter((workspace) => /claude|minimax/i.test(workspaceRuntimeText(workspace)));
  });
  const running = candidates.find((workspace) => workspace.status === 'running');
  return running?.agentId ?? candidates[0]?.agentId;
}

function workspaceRuntimeText(workspace) {
  return [
    workspace.runtime,
    workspace.runtimeProvider,
    workspace.runtimeModel,
    workspace.runtimeCommand,
  ].filter(Boolean).join(' ');
}

async function fetchRuntimeControlEvidence({ daemonRpcBase, agentId, timeoutMs }) {
  if (!agentId) {
    return {
      action: 'inspect_context',
      accepted: false,
      delivered: false,
      error: 'runtime_control agentId unavailable',
    };
  }

  try {
    const response = await fetch(new URL('/internal/daemon/jsonrpc', daemonRpcBase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'integration-gate.inspect_context',
        method: 'daemon/runtime_control',
        params: {
          action: 'inspect_context',
          agentId,
          waitForResult: true,
          timeoutMs,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs + 1_000),
    });
    if (!response.ok) {
      return {
        action: 'inspect_context',
        accepted: false,
        delivered: false,
        error: `daemon runtime_control HTTP ${response.status}`,
      };
    }

    const message = await response.json();
    if (message?.error) {
      return {
        action: 'inspect_context',
        accepted: false,
        delivered: false,
        error: message.error.message ?? JSON.stringify(message.error),
      };
    }
    return message?.result ?? {
      action: 'inspect_context',
      accepted: false,
      delivered: false,
      error: 'daemon runtime_control response missing result',
    };
  } catch (error) {
    return {
      action: 'inspect_context',
      accepted: false,
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchDaemonLogs(daemonRpcBase) {
  try {
    const response = await fetch(new URL('/internal/daemon/jsonrpc', daemonRpcBase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'integration-gate.daemon_logs',
        method: 'daemon/logs',
        params: { limit: 120 },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const message = await response.json();
    return message?.result ?? null;
  } catch {
    return null;
  }
}

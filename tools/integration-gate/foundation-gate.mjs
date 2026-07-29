const CONTEXT_THRESHOLD_PERCENT = 50;

const FOUNDATION_STEP_IDS = [
  'login-session',
  'frontend-ready',
  'backend-ready',
  'daemon-connect',
  'minimax-runtime-ready',
  'runtime-reuse-candidate',
  'limit-preflight',
  'context-preflight',
  'compact-if-needed',
  'warmup-ready',
  'session-resume',
  'control-plane-sync',
];

export function parseClaudeContextUsage(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const model = text.match(/\*\*Model:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  const tokens = text.match(/\*\*Tokens:\*\*\s*([^/\n]+?)\s*\/\s*([^( \n]+)\s*\((\d+(?:\.\d+)?)%\)/i);
  if (!tokens) return null;
  return {
    source: 'claude_slash_context',
    model,
    usedTokens: tokens[1].trim(),
    totalTokens: tokens[2].trim(),
    percent: Number(tokens[3]),
  };
}

export function parseRuntimeControlEvidence(input) {
  if (!input || typeof input !== 'object') return {};
  const output = typeof input.output === 'string'
    ? input.output
    : typeof input.text === 'string'
      ? input.text
      : '';
  const parsedContext = parseClaudeContextUsage(output);
  const contextUsage = parsedContext
    ? {
      ...parsedContext,
      source: input.action === 'inspect_context'
        ? 'daemon_runtime_control.inspect_context'
        : parsedContext.source,
    }
    : null;
  const errorText = typeof input.error === 'string'
    ? input.error
    : typeof input.message === 'string'
      ? input.message
      : '';
  const limitFailure = errorText ? classifyLimitFailure(errorText) : null;

  return {
    action: typeof input.action === 'string' ? input.action : undefined,
    accepted: input.accepted === true,
    delivered: input.delivered === true,
    slashCommand: typeof input.slashCommand === 'string' ? input.slashCommand : undefined,
    ...(contextUsage ? { contextUsage } : {}),
    ...(limitFailure ? { limitFailure } : {}),
  };
}

export function parseDaemonRuntimeHealth(input) {
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  const messages = entries
    .map((entry) => typeof entry?.message === 'string' ? entry.message : '')
    .filter(Boolean);
  const joined = messages.join('\n');
  if (!joined) return null;

  const tokenBootstrapFailure = /MISSING_TOKEN|TOKEN_[A-Z_]+|proxy token is not injected/i.test(joined);
  const warmupTimeout = /warmup timed out|reason=warmup_timeout/i.test(joined);
  if (!tokenBootstrapFailure && !warmupTimeout) {
    return { ok: true, evidence: { source: 'daemon.logs', entries: messages.length } };
  }

  const code = tokenBootstrapFailure ? 'RUNTIME_WARMUP_TOKEN_MISSING' : 'RUNTIME_WARMUP_TIMEOUT';
  return {
    ok: false,
    failure: { category: 'runtime_bootstrap', code },
    evidence: {
      source: 'daemon.logs',
      reason: tokenBootstrapFailure ? 'MISSING_TOKEN' : 'warmup_timeout',
      warmupTimeout,
      matched: messages
        .filter((message) => /MISSING_TOKEN|TOKEN_[A-Z_]+|proxy token is not injected|warmup timed out|reason=warmup_timeout/i.test(message))
        .map(compactLogMessage)
        .slice(-3),
    },
  };
}

export function classifyLimitFailure(input) {
  const text = String(input ?? '').toLowerCase();
  if (/\b(rate|requests?)\s*limit|too many requests|retry after/.test(text)) {
    return { category: 'rate_limit', code: 'RATE_LIMIT' };
  }
  if (/provider.*quota|quota.*exceed|insufficient quota|credits? exhausted/.test(text)) {
    return { category: 'provider_quota', code: 'PROVIDER_QUOTA' };
  }
  if (/context (length|limit|window)|context.*exceed|maximum context|too many tokens/.test(text)) {
    return { category: 'context_limit', code: 'CONTEXT_LIMIT' };
  }
  if (/token budget|budget exhausted|max.?budget/.test(text)) {
    return { category: 'token_budget', code: 'TOKEN_BUDGET' };
  }
  return { category: 'runtime_limit', code: 'RUNTIME_LIMIT' };
}

export function buildFoundationGateReport(input = {}) {
  const computers = Array.isArray(input.computers) ? input.computers : [];
  const onlineComputers = computers.filter((computer) => isOnline(computer.status));
  const minimaxRuntimeComputers = computers.filter(hasMiniMaxClaudeRuntime);
  const candidates = runtimeCandidates(computers);
  const runningCandidates = candidates.filter(({ workspace }) => workspace.status === 'running');
  const sessionCandidates = runningCandidates.filter(({ workspace }) => typeof workspace.sessionId === 'string' && workspace.sessionId);
  const contextUsage = input.contextUsage ?? null;
  const limitFailure = normalizeLimitFailure(input.limitFailure)
    ?? (input.limitError ? classifyLimitFailure(input.limitError) : null);
  const runtimeHealth = normalizeRuntimeHealth(input.runtimeHealth);

  const steps = [
    step({
      id: 'login-session',
      label: 'Login/session ready',
      ok: input.authenticated === true,
      failure: { category: 'auth', code: 'LOGIN_SESSION_MISSING' },
      evidence: { authenticated: input.authenticated === true },
    }),
    step({
      id: 'frontend-ready',
      label: 'Frontend ready',
      ok: input.frontendOnline === true,
      failure: { category: 'frontend', code: 'FRONTEND_UNAVAILABLE' },
      evidence: { frontendOnline: input.frontendOnline === true },
    }),
    step({
      id: 'backend-ready',
      label: 'Backend ready',
      ok: input.backendOnline === true,
      failure: { category: 'backend', code: 'BACKEND_UNAVAILABLE' },
      evidence: { backendOnline: input.backendOnline === true },
    }),
    step({
      id: 'daemon-connect',
      label: 'Daemon connected',
      ok: onlineComputers.length > 0,
      failure: { category: 'daemon', code: 'DAEMON_NOT_CONNECTED' },
      evidence: { onlineComputers: onlineComputers.length, computers: computers.length },
    }),
    step({
      id: 'minimax-runtime-ready',
      label: 'MiniMax Claude Code runtime available',
      ok: minimaxRuntimeComputers.length > 0 || candidates.some(({ workspace }) => isMiniMaxClaudeRuntime(workspaceRuntimeText(workspace))),
      failure: { category: 'runtime', code: 'MINIMAX_CLAUDE_RUNTIME_MISSING' },
      evidence: { minimaxRuntimeComputers: minimaxRuntimeComputers.length },
    }),
    step({
      id: 'runtime-reuse-candidate',
      label: 'Runtime reuse candidate found',
      ok: candidates.length > 0,
      failure: { category: 'runtime', code: 'RUNTIME_REUSE_CANDIDATE_MISSING' },
      evidence: { candidates: candidates.length },
    }),
    step({
      id: 'limit-preflight',
      label: 'Limit preflight',
      ok: !limitFailure,
      failure: limitFailure,
      evidence: limitFailure ? { message: String(input.limitError ?? input.limitFailure?.code ?? limitFailure.code) } : { source: 'no limit error observed' },
    }),
    step({
      id: 'context-preflight',
      label: 'Context preflight',
      ok: Boolean(contextUsage && Number.isFinite(contextUsage.percent)),
      failure: { category: 'context_limit', code: 'CONTEXT_USAGE_MISSING' },
      evidence: contextUsage ?? { source: 'missing runtime_control.inspect_context evidence' },
    }),
    step({
      id: 'compact-if-needed',
      label: 'Compact if needed',
      ok: Boolean(contextUsage && contextUsage.percent <= CONTEXT_THRESHOLD_PERCENT),
      failure: { category: 'context_limit', code: 'CONTEXT_COMPACT_REQUIRED' },
      evidence: {
        thresholdPercent: CONTEXT_THRESHOLD_PERCENT,
        contextPercent: contextUsage?.percent,
        source: contextUsage?.source,
      },
    }),
    step({
      id: 'warmup-ready',
      label: 'Runtime warmup ready',
      ok: runningCandidates.length > 0 && runtimeHealth?.ok !== false,
      failure: runtimeHealth?.failure ?? { category: 'runtime', code: 'RUNTIME_WARMUP_NOT_READY' },
      evidence: {
        runningCandidates: runningCandidates.length,
        ...(runtimeHealth?.evidence ? { runtimeHealth: runtimeHealth.evidence } : {}),
      },
    }),
    step({
      id: 'session-resume',
      label: 'Session/resume ready',
      ok: sessionCandidates.length > 0,
      failure: { category: 'session', code: 'SESSION_RESUME_EVIDENCE_MISSING' },
      evidence: { sessionCandidates: sessionCandidates.length },
    }),
    step({
      id: 'control-plane-sync',
      label: 'Control plane sync',
      ok: input.backendOnline === true && computers.length > 0,
      failure: { category: 'control_plane', code: 'CONTROL_PLANE_SNAPSHOT_MISSING' },
      evidence: { computers: computers.length },
    }),
  ];

  const failures = steps.filter((item) => item.status === 'fail');
  return {
    mode: 'foundation-only',
    ok: failures.length === 0,
    thresholdPercent: CONTEXT_THRESHOLD_PERCENT,
    steps,
    failures,
    summary: {
      total: steps.length,
      passed: steps.filter((item) => item.status === 'pass').length,
      failed: failures.length,
    },
  };
}

export function formatGateSummary(report) {
  const prefix = `${report.ok ? 'PASS' : 'FAIL'} ${report.mode} ${report.summary.passed}/${report.summary.total}`;
  if (report.ok) return prefix;
  const failures = report.failures
    .map((item) => `${item.failure.category}:${item.id}`)
    .join(' ');
  return `${prefix} ${failures}`;
}

function normalizeRuntimeHealth(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.ok === true) {
    return {
      ok: true,
      evidence: typeof value.evidence === 'object' && value.evidence ? value.evidence : undefined,
    };
  }
  if (value.ok === false) {
    const failure = normalizeLimitFailure(value.failure) ?? {
      category: 'runtime',
      code: 'RUNTIME_HEALTH_FAILED',
    };
    return {
      ok: false,
      failure,
      evidence: typeof value.evidence === 'object' && value.evidence ? value.evidence : undefined,
    };
  }
  return null;
}

function compactLogMessage(message) {
  const text = String(message ?? '');
  const resultMatch = text.match(/"result":"([^"]+)/);
  const summary = resultMatch ? resultMatch[1].replace(/\\n/g, ' ') : text;
  return summary.length > 260 ? `${summary.slice(0, 257)}...` : summary;
}

function normalizeLimitFailure(value) {
  if (!value || typeof value !== 'object') return null;
  const category = typeof value.category === 'string' && value.category.trim() ? value.category : null;
  const code = typeof value.code === 'string' && value.code.trim() ? value.code : null;
  if (!category || !code) return null;
  return {
    category,
    code,
    ...(value.stage ? { stage: value.stage } : {}),
    ...(value.recovery ? { recovery: value.recovery } : {}),
    ...(value.source ? { source: value.source } : {}),
  };
}

function step({ id, label, ok, failure, evidence }) {
  if (!FOUNDATION_STEP_IDS.includes(id)) {
    throw new Error(`Unknown foundation gate step: ${id}`);
  }
  return {
    id,
    label,
    status: ok ? 'pass' : 'fail',
    evidence,
    ...(ok ? {} : { failure }),
  };
}

function isOnline(status) {
  return status === 'online' || status === 'active' || status === 'running';
}

function runtimeText(runtime) {
  if (!runtime) return '';
  return typeof runtime === 'string' ? runtime : JSON.stringify(runtime);
}

function isMiniMaxClaudeRuntime(runtime) {
  const text = runtimeText(runtime).toLowerCase();
  return text.includes('minimax') && (text.includes('claude') || text.includes('anthropic'));
}

function hasMiniMaxClaudeRuntime(computer) {
  return Array.isArray(computer.detectedRuntimes) && computer.detectedRuntimes.some(isMiniMaxClaudeRuntime);
}

function workspaceRuntimeText(workspace) {
  return [
    workspace.runtime,
    workspace.runtimeProvider,
    workspace.runtimeModel,
    workspace.runtimeCommand,
  ].filter(Boolean).join(' ');
}

function runtimeCandidates(computers) {
  return computers.flatMap((computer) => {
    const workspaces = Array.isArray(computer.agentWorkspaces) ? computer.agentWorkspaces : [];
    return workspaces
      .filter((workspace) => /claude|minimax/i.test(workspaceRuntimeText(workspace)))
      .map((workspace) => ({ computer, workspace }));
  });
}

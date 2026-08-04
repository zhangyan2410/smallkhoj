const CONTEXT_THRESHOLD_PERCENT = 50;

export const FOUNDATION_RUNTIME_TARGETS = ['claude_code', 'codex', 'opencode', 'pi'];

const RUNTIME_PROFILES = {
  claude_code: {
    runtime: 'claude_code',
    label: 'Claude Code',
    contextControl: true,
    inspectCommand: '/context',
    compactCommand: '/compact',
    missingCode: 'CLAUDE_CODE_RUNTIME_MISSING',
  },
  codex: {
    runtime: 'codex',
    label: 'Codex',
    contextControl: true,
    inspectCommand: '/status',
    compactCommand: '/compact',
    missingCode: 'CODEX_RUNTIME_MISSING',
  },
  opencode: {
    runtime: 'opencode',
    label: 'OpenCode',
    contextControl: false,
    missingCode: 'OPENCODE_RUNTIME_MISSING',
  },
  pi: {
    runtime: 'pi',
    label: 'Built-in Pi',
    contextControl: false,
    missingCode: 'PI_RUNTIME_MISSING',
  },
};

const FOUNDATION_STEP_IDS = [
  'login-session',
  'frontend-ready',
  'backend-ready',
  'daemon-connect',
  'target-runtime-ready',
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

export function parseRuntimeContextUsage(text) {
  const claudeUsage = parseClaudeContextUsage(text);
  if (claudeUsage) return claudeUsage;
  if (typeof text !== 'string' || !text.trim()) return null;
  const percent = text.match(/\bcontext(?:\s+(?:window|usage))?\b[^\n%]{0,120}?(\d+(?:\.\d+)?)%\s*(?:used|full)?/i)?.[1];
  if (!percent) return null;
  return {
    source: 'runtime_status',
    percent: Number(percent),
  };
}

export function parseRuntimeControlEvidence(input) {
  if (!input || typeof input !== 'object') return {};
  const output = typeof input.output === 'string'
    ? input.output
    : typeof input.text === 'string'
      ? input.text
      : '';
  const parsedContext = parseRuntimeContextUsage(output);
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
    agentId: typeof input.agentId === 'string' && input.agentId.trim() ? input.agentId.trim() : undefined,
    accepted: input.accepted === true,
    delivered: input.delivered === true,
    runtime: normalizeRuntimeIdentifier(input.runtime) || undefined,
    slashCommand: typeof input.slashCommand === 'string' ? input.slashCommand : undefined,
    ...(contextUsage ? { contextUsage } : {}),
    ...(limitFailure ? { limitFailure } : {}),
  };
}

export function correlateRuntimeControlEvidence(evidence, target = {}) {
  if (!evidence || typeof evidence !== 'object') return {};
  const expectedRuntime = foundationRuntimeProfile(target.runtime).runtime;
  const expectedAgentId = typeof target.agentId === 'string' && target.agentId.trim()
    ? target.agentId.trim()
    : null;
  const observedRuntime = normalizeRuntimeIdentifier(evidence.runtime) || null;
  const observedAgentId = typeof evidence.agentId === 'string' && evidence.agentId.trim()
    ? evidence.agentId.trim()
    : null;
  if (observedRuntime === expectedRuntime && expectedAgentId && observedAgentId === expectedAgentId) {
    return evidence;
  }

  const safeEvidence = Object.fromEntries(
    Object.entries(evidence).filter(([key]) => key !== 'contextUsage' && key !== 'limitFailure'),
  );
  return {
    ...safeEvidence,
    identityFailure: {
      category: 'runtime',
      code: 'RUNTIME_CONTROL_TARGET_MISMATCH',
    },
    identity: {
      expectedRuntime,
      expectedAgentId,
      observedRuntime,
      observedAgentId,
    },
  };
}

export function parseDaemonRuntimeHealth(input, target = {}) {
  const entries = Array.isArray(input?.entries) ? input.entries : [];
  const agentId = typeof target.agentId === 'string' && target.agentId.trim()
    ? target.agentId.trim()
    : null;
  if (!agentId) return null;
  const agentPattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(agentId)}(?=$|[^A-Za-z0-9_-])`);
  const messages = entries
    .map((entry) => typeof entry?.message === 'string' ? entry.message : '')
    .filter((message) => message && agentPattern.test(message));
  const joined = messages.join('\n');
  if (!joined) return null;

  const runtime = normalizeRuntimeIdentifier(target.runtime) || undefined;

  const tokenBootstrapFailure = /MISSING_TOKEN|TOKEN_[A-Z_]+|proxy token is not injected/i.test(joined);
  const warmupTimeout = /warmup timed out|reason=warmup_timeout/i.test(joined);
  if (!tokenBootstrapFailure && !warmupTimeout) {
    return {
      ok: true,
      evidence: { source: 'daemon.logs', agentId, ...(runtime ? { runtime } : {}), entries: messages.length },
    };
  }

  const code = tokenBootstrapFailure ? 'RUNTIME_WARMUP_TOKEN_MISSING' : 'RUNTIME_WARMUP_TIMEOUT';
  return {
    ok: false,
    failure: { category: 'runtime_bootstrap', code },
    evidence: {
      source: 'daemon.logs',
      agentId,
      ...(runtime ? { runtime } : {}),
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
  const profile = foundationRuntimeProfile(input.runtime ?? 'claude_code');
  const computers = Array.isArray(input.computers) ? input.computers : [];
  const onlineComputers = computers.filter((computer) => isOnline(computer.status));
  const detectedRuntimeComputers = onlineComputers.filter((computer) => hasRuntime(computer, profile));
  const candidates = runtimeCandidates(onlineComputers, profile);
  const runningCandidates = candidates.filter(({ workspace }) => workspace.status === 'running');
  const sessionCandidates = runningCandidates.filter(({ workspace }) => typeof workspace.sessionId === 'string' && workspace.sessionId);
  const contextUsage = input.contextUsage ?? null;
  const limitFailure = normalizeLimitFailure(input.limitFailure)
    ?? (input.limitError ? classifyLimitFailure(input.limitError) : null);
  const runtimeHealth = normalizeRuntimeHealth(input.runtimeHealth);
  const runtimeControlFailure = normalizeLimitFailure(input.runtimeControlFailure);

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
      id: 'target-runtime-ready',
      label: `${profile.label} runtime available`,
      ok: detectedRuntimeComputers.length > 0 || candidates.length > 0,
      failure: { category: 'runtime', code: profile.missingCode },
      evidence: {
        runtime: profile.runtime,
        detectedRuntimeComputers: detectedRuntimeComputers.length,
        workspaceCandidates: candidates.length,
      },
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
      applicable: profile.contextControl,
      ok: !runtimeControlFailure && Boolean(contextUsage && Number.isFinite(contextUsage.percent)),
      failure: runtimeControlFailure ?? { category: 'context_limit', code: 'CONTEXT_USAGE_MISSING' },
      evidence: runtimeControlFailure
        ? { runtime: profile.runtime, identity: input.runtimeControlIdentity ?? null }
        : profile.contextControl
          ? contextUsage ?? { source: 'missing runtime_control.inspect_context evidence', runtime: profile.runtime }
          : { runtime: profile.runtime, reason: 'runtime_context_control_unsupported' },
    }),
    step({
      id: 'compact-if-needed',
      label: 'Compact if needed',
      applicable: profile.contextControl,
      ok: !runtimeControlFailure && Boolean(contextUsage && contextUsage.percent <= CONTEXT_THRESHOLD_PERCENT),
      failure: runtimeControlFailure ?? { category: 'context_limit', code: 'CONTEXT_COMPACT_REQUIRED' },
      evidence: {
        thresholdPercent: CONTEXT_THRESHOLD_PERCENT,
        contextPercent: contextUsage?.percent,
        source: contextUsage?.source,
        runtime: profile.runtime,
        ...(runtimeControlFailure ? { identity: input.runtimeControlIdentity ?? null } : {}),
        ...(profile.contextControl ? {} : { reason: 'runtime_compact_control_unsupported' }),
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
    runtime: profile.runtime,
    ok: failures.length === 0,
    thresholdPercent: CONTEXT_THRESHOLD_PERCENT,
    steps,
    failures,
    summary: {
      total: steps.length,
      passed: steps.filter((item) => item.status === 'pass').length,
      failed: failures.length,
      skipped: steps.filter((item) => item.status === 'skip').length,
    },
  };
}

export function buildFoundationMatrixReport(runtimeReports) {
  const reports = FOUNDATION_RUNTIME_TARGETS.map((runtime) => {
    const report = runtimeReports.find((item) => item?.runtime === runtime);
    if (!report) throw new Error(`Missing foundation runtime report: ${runtime}`);
    return report;
  });
  const steps = reports.flatMap((report) => report.steps.map((item) => ({
    ...item,
    id: `${report.runtime}:${item.id}`,
    stepId: item.id,
    runtime: report.runtime,
    label: `[${report.runtime}] ${item.label}`,
  })));
  const failures = steps.filter((item) => item.status === 'fail');
  return {
    mode: 'foundation-only',
    runtime: 'all',
    ok: failures.length === 0,
    thresholdPercent: CONTEXT_THRESHOLD_PERCENT,
    steps,
    failures,
    runtimeReports: reports,
    summary: {
      total: steps.length,
      passed: steps.filter((item) => item.status === 'pass').length,
      failed: failures.length,
      skipped: steps.filter((item) => item.status === 'skip').length,
    },
  };
}

export function formatGateSummary(report) {
  const prefix = `${report.ok ? 'PASS' : 'FAIL'} ${report.mode} ${report.summary.passed}/${report.summary.total}`;
  const skipped = report.summary.skipped > 0 ? ` skipped=${report.summary.skipped}` : '';
  if (report.ok) return `${prefix}${skipped}`;
  const failures = report.failures
    .map((item) => `${item.failure.category}:${item.id}`)
    .join(' ');
  return `${prefix}${skipped} ${failures}`;
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function step({ id, label, applicable = true, ok, failure, evidence }) {
  if (!FOUNDATION_STEP_IDS.includes(id)) {
    throw new Error(`Unknown foundation gate step: ${id}`);
  }
  if (!applicable) {
    return {
      id,
      label,
      status: 'skip',
      applicable: false,
      evidence,
    };
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

export function foundationRuntimeProfile(runtime) {
  const normalized = normalizeRuntimeIdentifier(runtime);
  const profile = RUNTIME_PROFILES[normalized];
  if (!profile) throw new Error(`Unsupported foundation runtime: ${runtime}`);
  return profile;
}

export function workspaceMatchesRuntime(workspace, runtime) {
  return normalizeRuntimeIdentifier(workspace?.runtime) === foundationRuntimeProfile(runtime).runtime;
}

export function selectRuntimeAgentIdForTarget(computers, runtime, explicitAgentId) {
  const profile = foundationRuntimeProfile(runtime);
  const onlineComputers = (Array.isArray(computers) ? computers : []).filter((computer) => isOnline(computer.status));
  const candidates = runtimeCandidates(onlineComputers, profile).map(({ workspace }) => workspace);
  if (explicitAgentId) {
    return candidates.find((workspace) => workspace.agentId === explicitAgentId)?.agentId;
  }
  const running = candidates.find((workspace) => workspace.status === 'running');
  return running?.agentId ?? candidates[0]?.agentId;
}

function normalizeRuntimeIdentifier(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'claude_code') return 'claude_code';
  if (normalized === 'codex' || normalized === 'codex_acp' || normalized === 'codex-acp') return 'codex';
  if (normalized === 'opencode' || normalized === 'open_code') return 'opencode';
  if (normalized === 'pi') return 'pi';
  return '';
}

function hasRuntime(computer, profile) {
  return Array.isArray(computer.detectedRuntimes) && computer.detectedRuntimes.some((runtime) => {
    const identity = typeof runtime === 'string' ? runtime : runtime?.type ?? runtime?.runtime;
    return normalizeRuntimeIdentifier(identity) === profile.runtime;
  });
}

function runtimeCandidates(computers, profile) {
  return computers.flatMap((computer) => {
    const workspaces = Array.isArray(computer.agentWorkspaces) ? computer.agentWorkspaces : [];
    return workspaces
      .filter((workspace) => normalizeRuntimeIdentifier(workspace.runtime) === profile.runtime)
      .map((workspace) => ({ computer, workspace }));
  });
}

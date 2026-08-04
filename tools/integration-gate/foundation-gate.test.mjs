import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFoundationGateReport,
  buildFoundationMatrixReport,
  classifyLimitFailure,
  correlateRuntimeControlEvidence,
  formatGateSummary,
  parseClaudeContextUsage,
  parseDaemonRuntimeHealth,
  parseRuntimeContextUsage,
  parseRuntimeControlEvidence,
  selectRuntimeAgentIdForTarget,
} from './foundation-gate.mjs';

test('parseClaudeContextUsage extracts direct slash-command context evidence', () => {
  const usage = parseClaudeContextUsage([
    '## Context Usage',
    '',
    '**Model:** MiniMax-M3',
    '**Tokens:** 35.1k / 200k (18%)',
    '',
    'Free space: 164.9k',
  ].join('\n'));

  assert.deepEqual(usage, {
    source: 'claude_slash_context',
    model: 'MiniMax-M3',
    usedTokens: '35.1k',
    totalTokens: '200k',
    percent: 18,
  });
});

test('parseRuntimeControlEvidence extracts context usage and limit failures from daemon control results', () => {
  const evidence = parseRuntimeControlEvidence({
    action: 'inspect_context',
    agentId: 'agent-claude',
    accepted: true,
    delivered: true,
    runtime: 'claude',
    slashCommand: '/context',
    output: [
      '## Context Usage',
      '**Model:** MiniMax-M3',
      '**Tokens:** 101k / 200k (51%)',
    ].join('\n'),
  });

  assert.equal(evidence.action, 'inspect_context');
  assert.equal(evidence.agentId, 'agent-claude');
  assert.equal(evidence.runtime, 'claude_code');
  assert.equal(evidence.contextUsage.percent, 51);
  assert.equal(evidence.contextUsage.source, 'daemon_runtime_control.inspect_context');

  const limit = parseRuntimeControlEvidence({
    action: 'usage_status',
    accepted: true,
    delivered: true,
    error: 'rate limit reached',
  });
  assert.equal(limit.limitFailure.category, 'rate_limit');
});

test('parseRuntimeContextUsage accepts Codex status percentage evidence', () => {
  assert.deepEqual(parseRuntimeContextUsage('Context window: 41% used'), {
    source: 'runtime_status',
    percent: 41,
  });
});

test('buildFoundationGateReport preserves structured runtime-control limit failure category', () => {
  const report = buildFoundationGateReport({
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers: [],
    limitFailure: { category: 'rate_limit', code: 'RATE_LIMIT' },
  });

  const limitPreflight = report.steps.find((step) => step.id === 'limit-preflight');
  assert.equal(limitPreflight.status, 'fail');
  assert.equal(limitPreflight.failure.category, 'rate_limit');
  assert.equal(limitPreflight.failure.code, 'RATE_LIMIT');
});

test('parseDaemonRuntimeHealth reports warmup token bootstrap failures', () => {
  const health = parseDaemonRuntimeHealth({
    entries: [
      { level: 'debug', message: 'Daemon heartbeat synced to http://127.0.0.1:8010' },
      { level: 'debug', message: 'claude_code runtime agent-1 stderr: `slock server info` failed with `MISSING_TOKEN`' },
      { level: 'warn', message: 'Runtime agent-1 warmup timed out after 60000ms; marking startup failed' },
    ],
  }, { runtime: 'claude_code', agentId: 'agent-1' });

  assert.equal(health.ok, false);
  assert.equal(health.failure.category, 'runtime_bootstrap');
  assert.equal(health.failure.code, 'RUNTIME_WARMUP_TOKEN_MISSING');
  assert.equal(health.evidence.reason, 'MISSING_TOKEN');
});

test('daemon runtime health ignores failures owned by another runtime agent', () => {
  const logs = {
    entries: [
      { level: 'error', message: 'opencode runtime agent-opencode stderr: MISSING_TOKEN' },
      { level: 'warn', message: 'Runtime agent-opencode warmup timed out after 60000ms; degrading to ready' },
      { level: 'info', message: 'codex runtime agent-codex stdout: ready' },
    ],
  };

  const opencodeHealth = parseDaemonRuntimeHealth(logs, {
    runtime: 'opencode',
    agentId: 'agent-opencode',
  });
  assert.equal(opencodeHealth.ok, false);
  assert.equal(opencodeHealth.failure.code, 'RUNTIME_WARMUP_TOKEN_MISSING');

  const codexHealth = parseDaemonRuntimeHealth(logs, {
    runtime: 'codex',
    agentId: 'agent-codex',
  });
  assert.equal(codexHealth.ok, true);
  assert.equal(codexHealth.evidence.agentId, 'agent-codex');
});

test('runtime-control context evidence fails closed when runtime or agent identity mismatches', () => {
  const evidence = parseRuntimeControlEvidence({
    action: 'inspect_context',
    accepted: true,
    delivered: true,
    runtime: 'codex',
    agentId: 'agent-codex',
    output: 'Context window: 18% used',
  });

  const correlated = correlateRuntimeControlEvidence(evidence, {
    runtime: 'claude_code',
    agentId: 'agent-claude',
  });
  assert.equal(correlated.contextUsage, undefined);
  assert.deepEqual(correlated.identityFailure, {
    category: 'runtime',
    code: 'RUNTIME_CONTROL_TARGET_MISMATCH',
  });
  assert.deepEqual(correlated.identity, {
    expectedRuntime: 'claude_code',
    expectedAgentId: 'agent-claude',
    observedRuntime: 'codex',
    observedAgentId: 'agent-codex',
  });
});

test('buildFoundationGateReport fails warmup-ready when daemon logs show warmup failure', () => {
  const report = buildFoundationGateReport({
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers: [{
      id: 'computer-1',
      status: 'online',
      detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
      agentWorkspaces: [{
        id: 'workspace-1',
        agentId: 'agent-1',
        status: 'running',
        runtime: 'claude_code',
        runtimeProvider: 'MiniMax',
        runtimeModel: 'MiniMax-M3',
        sessionId: 'session-1',
      }],
    }],
    contextUsage: {
      source: 'daemon_runtime_control.inspect_context',
      model: 'MiniMax-M3',
      usedTokens: '28.5k',
      totalTokens: '200k',
      percent: 14,
    },
    runtimeHealth: {
      ok: false,
      failure: { category: 'runtime_bootstrap', code: 'RUNTIME_WARMUP_TOKEN_MISSING' },
      evidence: { reason: 'MISSING_TOKEN' },
    },
  });

  const warmup = report.steps.find((step) => step.id === 'warmup-ready');
  assert.equal(report.ok, false);
  assert.equal(warmup.status, 'fail');
  assert.equal(warmup.failure.code, 'RUNTIME_WARMUP_TOKEN_MISSING');
});

test('classifyLimitFailure promotes quota and context failures to first-class categories', () => {
  assert.equal(classifyLimitFailure('Provider quota exceeded for this account').category, 'provider_quota');
  assert.equal(classifyLimitFailure('rate limit reached, retry after 15 minutes').category, 'rate_limit');
  assert.equal(classifyLimitFailure('context length exceeds model window').category, 'context_limit');
  assert.equal(classifyLimitFailure('token budget exhausted').category, 'token_budget');
});

test('buildFoundationGateReport models foundation-only flow without task/chat scenarios', () => {
  const report = buildFoundationGateReport({
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers: [{
      id: 'computer-1',
      name: 'devbox',
      status: 'online',
      detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
      agentWorkspaces: [{
        id: 'workspace-1',
        agentId: 'agent-1',
        agentName: 'aaa',
        status: 'running',
        runtime: 'claude_code',
        runtimeProvider: 'MiniMax',
        runtimeModel: 'MiniMax-M3',
        sessionId: 'session-1',
      }],
    }],
    contextUsage: {
      source: 'claude_slash_context',
      model: 'MiniMax-M3',
      usedTokens: '35.1k',
      totalTokens: '200k',
      percent: 18,
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.mode, 'foundation-only');
  assert.equal(report.steps.some((step) => /task|chat/i.test(step.id)), false);
  assert.equal(report.steps.find((step) => step.id === 'context-preflight')?.status, 'pass');
  assert.equal(report.steps.find((step) => step.id === 'compact-if-needed')?.status, 'pass');
});

test('buildFoundationGateReport requires compact above the 50 percent context threshold', () => {
  const report = buildFoundationGateReport({
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers: [],
    contextUsage: {
      source: 'claude_slash_context',
      model: 'MiniMax-M3',
      usedTokens: '121k',
      totalTokens: '200k',
      percent: 61,
    },
  });

  const compact = report.steps.find((step) => step.id === 'compact-if-needed');
  assert.equal(compact.status, 'fail');
  assert.equal(compact.failure?.category, 'context_limit');
  assert.equal(compact.evidence.contextPercent, 61);
});

test('formatGateSummary stays compact on pass and explains failures on failure', () => {
  const passing = buildFoundationGateReport({
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers: [{
      id: 'computer-1',
      status: 'online',
      detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
      agentWorkspaces: [{
        id: 'workspace-1',
        agentId: 'agent-1',
        status: 'running',
        runtime: 'claude_code',
        runtimeProvider: 'MiniMax',
        runtimeModel: 'MiniMax-M3',
        sessionId: 'session-1',
      }],
    }],
    contextUsage: {
      source: 'claude_slash_context',
      model: 'MiniMax-M3',
      usedTokens: '35.1k',
      totalTokens: '200k',
      percent: 18,
    },
  });
  assert.match(formatGateSummary(passing), /^PASS foundation-only/);

  const failing = buildFoundationGateReport({
    authenticated: false,
    backendOnline: false,
    frontendOnline: true,
    computers: [],
    limitError: 'rate limit reached',
  });
  const output = formatGateSummary(failing);
  assert.match(output, /^FAIL foundation-only/);
  assert.match(output, /auth:login-session/);
  assert.match(output, /rate_limit:limit-preflight/);
});

test('runtime profiles match canonical runtime identity instead of MiniMax/provider metadata', () => {
  const computers = [{
    id: 'computer-1',
    status: 'online',
    detectedRuntimes: [{ type: 'codex', provider: 'MiniMax Claude', model: 'MiniMax-M3' }],
    agentWorkspaces: [{
      id: 'workspace-codex',
      agentId: 'agent-codex',
      status: 'running',
      runtime: 'codex',
      runtimeProvider: 'MiniMax Claude',
      runtimeModel: 'MiniMax-M3',
      sessionId: 'session-codex',
    }],
  }];
  const contextUsage = {
    source: 'daemon_runtime_control.inspect_context',
    percent: 18,
  };

  const claudeReport = buildFoundationGateReport({
    runtime: 'claude_code',
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers,
    contextUsage,
  });
  assert.equal(claudeReport.ok, false);
  assert.equal(claudeReport.steps.find((step) => step.id === 'target-runtime-ready')?.status, 'fail');

  const codexReport = buildFoundationGateReport({
    runtime: 'codex',
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers,
    contextUsage,
  });
  assert.equal(codexReport.ok, true);
  assert.equal(codexReport.runtime, 'codex');
  assert.deepEqual(
    codexReport.steps.find((step) => step.id === 'target-runtime-ready')?.evidence,
    { runtime: 'codex', detectedRuntimeComputers: 1, workspaceCandidates: 1 },
  );
});

test('OpenCode and Pi keep strict runtime/session gates while context controls are explicit skips', () => {
  for (const runtime of ['opencode', 'pi']) {
    const report = buildFoundationGateReport({
      runtime,
      authenticated: true,
      backendOnline: true,
      frontendOnline: true,
      computers: [{
        id: `computer-${runtime}`,
        status: 'online',
        detectedRuntimes: [{ type: runtime, provider: 'MiniMax', model: 'MiniMax-M3' }],
        agentWorkspaces: [{
          id: `workspace-${runtime}`,
          agentId: `agent-${runtime}`,
          status: 'running',
          runtime,
          runtimeProvider: 'MiniMax',
          runtimeModel: 'MiniMax-M3',
          sessionId: `session-${runtime}`,
        }],
      }],
    });

    assert.equal(report.ok, true, runtime);
    assert.equal(report.steps.find((step) => step.id === 'context-preflight')?.status, 'skip');
    assert.equal(report.steps.find((step) => step.id === 'compact-if-needed')?.status, 'skip');
    assert.equal(report.summary.skipped, 2);
    assert.equal(report.summary.failed, 0);
    assert.match(formatGateSummary(report), /skipped=2$/);
  }
});

test('all-runtime matrix aggregates four isolated reports and runtime agent selection stays exact', () => {
  const runtimes = ['claude_code', 'codex', 'opencode', 'pi'];
  const computers = [{
    id: 'computer-all',
    status: 'online',
    detectedRuntimes: runtimes.map((runtime) => ({ type: runtime, provider: 'MiniMax' })),
    agentWorkspaces: runtimes.map((runtime) => ({
      id: `workspace-${runtime}`,
      agentId: `agent-${runtime}`,
      status: 'running',
      runtime,
      runtimeProvider: 'MiniMax',
      sessionId: `session-${runtime}`,
    })),
  }];
  const reports = runtimes.map((runtime) => buildFoundationGateReport({
    runtime,
    authenticated: true,
    backendOnline: true,
    frontendOnline: true,
    computers,
    ...(['claude_code', 'codex'].includes(runtime)
      ? { contextUsage: { source: 'daemon_runtime_control.inspect_context', percent: 17 } }
      : {}),
  }));

  const matrix = buildFoundationMatrixReport(reports);
  assert.equal(matrix.ok, true);
  assert.equal(matrix.runtime, 'all');
  assert.equal(matrix.runtimeReports.length, 4);
  assert.equal(matrix.summary.total, 48);
  assert.equal(matrix.summary.passed, 44);
  assert.equal(matrix.summary.skipped, 4);
  assert.equal(matrix.steps.some((step) => step.id === 'codex:target-runtime-ready'), true);
  assert.equal(selectRuntimeAgentIdForTarget(computers, 'codex'), 'agent-codex');
  assert.equal(selectRuntimeAgentIdForTarget(computers, 'opencode', 'agent-claude_code'), undefined);
});

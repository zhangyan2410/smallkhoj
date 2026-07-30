import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFoundationGateReport,
  classifyLimitFailure,
  formatGateSummary,
  parseClaudeContextUsage,
  parseDaemonRuntimeHealth,
  parseRuntimeControlEvidence,
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
    accepted: true,
    delivered: true,
    slashCommand: '/context',
    output: [
      '## Context Usage',
      '**Model:** MiniMax-M3',
      '**Tokens:** 101k / 200k (51%)',
    ].join('\n'),
  });

  assert.equal(evidence.action, 'inspect_context');
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
      { level: 'debug', message: 'Startup check ran. `slock server info` failed with `MISSING_TOKEN`' },
      { level: 'warn', message: 'Runtime agent-1 warmup timed out after 60000ms; marking startup failed' },
    ],
  });

  assert.equal(health.ok, false);
  assert.equal(health.failure.category, 'runtime_bootstrap');
  assert.equal(health.failure.code, 'RUNTIME_WARMUP_TOKEN_MISSING');
  assert.equal(health.evidence.reason, 'MISSING_TOKEN');
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

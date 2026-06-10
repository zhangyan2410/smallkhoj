#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const DEFAULT_DAEMON = 'http://127.0.0.1:3456';

const defaults = {
  backend: process.env.SMALLKHOJ_BACKEND ?? 'http://127.0.0.1:8000',
  frontend: process.env.SMALLKHOJ_FRONTEND ?? 'http://127.0.0.1:3000',
  daemon: process.env.SMALLKHOJ_DAEMON ?? DEFAULT_DAEMON,
  logDir: process.env.SMALLKHOJ_LOG_DIR ?? join(root, '.dev-logs'),
};

function usage() {
  console.log(`smallkhoj-trace

Usage:
  smallkhoj-trace summary [--json]
  smallkhoj-trace latency [--tail N] [--json]
  smallkhoj-trace logs [--tail N] [--json]
  smallkhoj-trace daemon [--json]
  smallkhoj-trace follow [--tail N]

Purpose:
  Show a single debugging view across backend, frontend, aaa-daemon, and the
  managed Claude runtime traces exposed by the daemon.

Environment:
  SMALLKHOJ_BACKEND   ${defaults.backend}
  SMALLKHOJ_FRONTEND  ${defaults.frontend}
  SMALLKHOJ_DAEMON    ${process.env.SMALLKHOJ_DAEMON ?? `${DEFAULT_DAEMON} (auto-detect when unset)`}
  SMALLKHOJ_LOG_DIR   ${defaults.logDir}
`);
}

function parseArgs(argv) {
  const first = argv[2];
  const args = {
    command: first && !first.startsWith('-') ? first : 'summary',
    json: false,
    tail: 80,
    help: first === '-h' || first === '--help',
  };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--tail') args.tail = Number(argv[++i] ?? args.tail);
    else if (arg === '-h' || arg === '--help') args.help = true;
  }
  if (!Number.isFinite(args.tail) || args.tail < 1) args.tail = 80;
  return args;
}

async function checkHttp(name, url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return {
      source: name,
      url,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      source: name,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}

async function daemonRpcAt(daemonUrl, method, params = undefined, timeoutMs = 3000) {
  const response = await fetch(new URL('/internal/daemon/jsonrpc', daemonUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-${Date.now()}`,
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`daemon RPC HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(body.error.message ?? JSON.stringify(body.error));
  }
  return body.result;
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function parseLocalDaemonPids() {
  const output = commandOutput('ps', ['-axo', 'pid,command']);
  const pids = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = /^(\d+)\s+(.+)$/.exec(trimmed);
    if (!match) continue;
    const [, pid, command] = match;
    const normalized = command.replaceAll('\\', '/');
    if (normalized.includes('dist/cmd/main.js start')) {
      pids.push(pid);
    }
  }
  return pids;
}

function parseListeningPortsForPids(pids) {
  if (!pids.length) return [];
  const wanted = new Set(pids.map(String));
  const output = commandOutput('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
  const ports = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 2 || !wanted.has(columns[1])) continue;
    const match = /:(\d+)\s+\(LISTEN\)$/.exec(line.trim());
    if (match) ports.push(Number(match[1]));
  }
  return [...new Set(ports)].filter(Number.isFinite);
}

async function firstHealthyDaemonUrl(urls) {
  const seen = new Set();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      await daemonRpcAt(url, 'daemon/logs', undefined, 900);
      return url;
    } catch {
      // Keep probing candidates; non-SmallKhoj daemons may require different tokens.
    }
  }
  return null;
}

async function resolveDaemonUrl() {
  if (process.env.SMALLKHOJ_DAEMON) return defaults.daemon;

  const pidPorts = parseListeningPortsForPids(parseLocalDaemonPids());
  const pidUrls = pidPorts.map((port) => `http://127.0.0.1:${port}`);
  const healthyPidUrl = await firstHealthyDaemonUrl(pidUrls);
  if (healthyPidUrl) return healthyPidUrl;

  const fallbackUrls = [
    DEFAULT_DAEMON,
    'http://127.0.0.1:3457',
    ...pidUrls,
  ];
  return (await firstHealthyDaemonUrl(fallbackUrls)) ?? DEFAULT_DAEMON;
}

function readTail(file, lines) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function parseDevLine(service, line, index) {
  const latency = parseLatencyTraceMessage(line);
  if (latency) {
    return {
      at: latency.at ?? null,
      source: service,
      kind: 'latency_trace',
      message: line,
      detail: latency,
      order: index,
    };
  }
  return {
    at: null,
    source: service,
    kind: 'log',
    message: line,
    order: index,
  };
}

function loadDevLogs(tail) {
  const backend = readTail(join(defaults.logDir, 'backend.log'), tail)
    .map((line, index) => parseDevLine('backend', line, index));
  const frontend = readTail(join(defaults.logDir, 'frontend.log'), tail)
    .map((line, index) => parseDevLine('frontend', line, index));
  return [...backend, ...frontend];
}

function normalizeDaemonLog(entry, index) {
  const message = String(entry.message ?? '');
  let kind = 'daemon_log';
  if (message.startsWith('Runtime trace: ')) kind = 'runtime_trace';
  else if (message.startsWith('Latency trace: ')) kind = 'latency_trace';
  else if (message.startsWith('Claude runtime ')) kind = 'runtime_line';
  else if (message.startsWith('Runtime message ')) kind = 'runtime_delivery';
  else if (message.startsWith('Inbox poll ')) kind = 'inbox';

  let detail = undefined;
  if (kind === 'runtime_trace') {
    const raw = message.slice('Runtime trace: '.length);
    try {
      detail = JSON.parse(raw);
    } catch {
      detail = raw;
    }
  } else if (kind === 'latency_trace') {
    detail = parseLatencyTraceMessage(message);
  }

  return {
    at: entry.timestamp ?? null,
    source: kind === 'daemon_log' ? 'daemon' : 'runtime',
    level: entry.level,
    kind,
    message,
    detail,
    order: index,
  };
}

function parseLatencyTraceMessage(message) {
  const prefix = 'Latency trace: ';
  const index = String(message).indexOf(prefix);
  if (index < 0) return null;
  const raw = String(message).slice(index + prefix.length);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.traceId || !parsed.span) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadDaemonState(daemonUrl) {
  const state = { ok: false, logs: [], sessions: [], error: null };
  try {
    const [logs, sessions] = await Promise.all([
      daemonRpcAt(daemonUrl, 'daemon/logs'),
      daemonRpcAt(daemonUrl, 'daemon/session.list'),
    ]);
    state.ok = true;
    state.logs = Array.isArray(logs?.entries) ? logs.entries.map(normalizeDaemonLog) : [];
    state.sessions = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  return state;
}

function sortTimeline(events) {
  return [...events].sort((a, b) => {
    const atA = a.at ? Date.parse(a.at) : Number.POSITIVE_INFINITY;
    const atB = b.at ? Date.parse(b.at) : Number.POSITIVE_INFINITY;
    if (atA !== atB) return atA - atB;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

function printTable(events) {
  for (const event of events) {
    const at = event.at ? new Date(event.at).toISOString().slice(11, 23) : 'no-time     ';
    const level = event.level ? `[${event.level}]` : '      ';
    const source = String(event.source ?? '').padEnd(9).slice(0, 9);
    const kind = String(event.kind ?? '').padEnd(16).slice(0, 16);
    console.log(`${at} ${source} ${level} ${kind} ${event.message}`);
  }
}

async function buildSummary(tail) {
  const daemonUrl = await resolveDaemonUrl();
  const [backend, frontend, daemonEndpoint, daemonState] = await Promise.all([
    checkHttp('backend', new URL('/docs', defaults.backend)),
    checkHttp('frontend', defaults.frontend),
    checkHttp('daemon', new URL('/internal/daemon/jsonrpc', daemonUrl)),
    loadDaemonState(daemonUrl),
  ]);
  const devLogs = loadDevLogs(tail);
  const daemonLogs = daemonState.logs.slice(-tail);
  return {
    services: [backend, frontend, daemonEndpoint],
    daemonUrl,
    daemon: daemonState,
    timeline: sortTimeline([...devLogs, ...daemonLogs]).slice(-tail),
  };
}

async function buildLatency(tail) {
  const daemonUrl = await resolveDaemonUrl();
  const [backend, frontend, daemonEndpoint, daemonState] = await Promise.all([
    checkHttp('backend', new URL('/docs', defaults.backend)),
    checkHttp('frontend', defaults.frontend),
    checkHttp('daemon', new URL('/internal/daemon/jsonrpc', daemonUrl)),
    loadDaemonState(daemonUrl),
  ]);
  const events = sortTimeline([...loadDevLogs(tail), ...daemonState.logs.slice(-tail)])
    .filter((event) => event.kind === 'latency_trace' && event.detail?.traceId);
  const traces = new Map();
  for (const event of events) {
    const traceId = String(event.detail.traceId);
    const list = traces.get(traceId) ?? [];
    list.push(event);
    traces.set(traceId, list);
  }
  return {
    services: [backend, frontend, daemonEndpoint],
    daemonUrl,
    traces: Array.from(traces.entries()).map(([traceId, traceEvents]) => ({
      traceId,
      events: traceEvents,
    })),
  };
}

const args = parseArgs(process.argv);
if (args.help || args.command === 'help') {
  usage();
  process.exit(0);
}

if (!['summary', 'latency', 'logs', 'daemon', 'follow'].includes(args.command)) {
  usage();
  process.exit(2);
}

const render = (data) => {
  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (data.services) {
    console.log('Services');
    for (const service of data.services) {
      const status = service.ok ? `OK ${service.status}` : `FAIL ${service.error ?? service.status ?? ''}`;
      console.log(`  ${service.source.padEnd(8)} ${status} ${service.ms}ms ${service.url}`);
    }
    if (data.daemon.error) console.log(`  daemon-rpc FAIL ${data.daemon.error}`);
    console.log('');
  }
  if (data.daemon?.sessions?.length) {
    console.log('Sessions');
    for (const session of data.daemon.sessions) {
      console.log(`  ${session.status ?? '?'} ${session.sessionId ?? '?'} ${session.command ?? ''} ${session.cwd ?? ''}`);
    }
    console.log('');
  }
  console.log('Timeline');
  printTable(data.timeline ?? data.logs ?? []);
};

const renderLatency = (data) => {
  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!data.traces?.length) {
    console.log('No latency traces found in the selected tail window.');
    return;
  }
  for (const trace of data.traces) {
    console.log(`Trace ${trace.traceId}`);
    const firstAt = firstTimestamp(trace.events);
    for (const event of trace.events) {
      const detail = event.detail ?? {};
      const elapsed = typeof detail.elapsedMs === 'number'
        ? detail.elapsedMs
        : firstAt && detail.at
          ? Date.parse(detail.at) - firstAt
          : null;
      const duration = typeof detail.durationMs === 'number' ? ` (${formatMs(detail.durationMs)})` : '';
      const source = String(event.source ?? '').padEnd(9).slice(0, 9);
      const prefix = elapsed === null ? '  +?      ' : `  +${formatMs(elapsed).padStart(8)}`;
      console.log(`${prefix} ${source} ${detail.span}${duration}`);
    }
    console.log('');
  }
};

function firstTimestamp(events) {
  const values = events
    .map((event) => event.detail?.at ?? event.at)
    .map((value) => value ? Date.parse(value) : NaN)
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return '?ms';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

if (args.command === 'logs') {
  render({ logs: loadDevLogs(args.tail) });
} else if (args.command === 'latency') {
  renderLatency(await buildLatency(args.tail));
} else if (args.command === 'daemon') {
  const daemonUrl = await resolveDaemonUrl();
  const daemon = await loadDaemonState(daemonUrl);
  render({
    daemonUrl,
    daemon,
    timeline: daemon.logs.slice(-args.tail),
  });
} else if (args.command === 'follow') {
  const tick = async () => {
    console.clear();
    render(await buildSummary(args.tail));
  };
  await tick();
  setInterval(() => void tick(), 2000);
} else {
  render(await buildSummary(args.tail));
}

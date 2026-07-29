import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SAFE_FILE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const DEFAULT_MAX_REPORT_BYTES = 1_000_000;

export function redactGateReport(value, options = {}) {
  const maxDepth = options.maxDepth ?? 12;
  const maxArrayItems = options.maxArrayItems ?? 500;
  const maxStringLength = options.maxStringLength ?? 20_000;

  const visit = (current, depth, key = '') => {
    if (isSecretKey(key)) return '[REDACTED]';
    if (depth > maxDepth) return '[TRUNCATED_DEPTH]';
    if (typeof current === 'string') return redactString(current).slice(0, maxStringLength);
    if (current === null || typeof current === 'number' || typeof current === 'boolean') return current;
    if (Array.isArray(current)) {
      return current.slice(0, maxArrayItems).map((item) => visit(item, depth + 1));
    }
    if (current && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current).map(([childKey, childValue]) => [
          childKey,
          visit(childValue, depth + 1, childKey),
        ]),
      );
    }
    return String(current ?? '');
  };

  return visit(value, 0);
}

export function writeGateReport({
  report,
  resultDir = resolve('.runtime/integration-gate'),
  resultOut = null,
  maxBytes = DEFAULT_MAX_REPORT_BYTES,
}) {
  const safeReport = redactGateReport(report);
  const mode = safeFileSegment(safeReport.mode ?? safeReport.scenario, 'mode');
  const runId = safeFileSegment(safeReport.runId, 'runId');
  const serialized = `${JSON.stringify(safeReport, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error(`GATE_REPORT_TOO_LARGE maxBytes=${maxBytes}`);
  }

  const root = resolve(resultDir);
  const runPath = join(root, 'runs', `${runId}.json`);
  const latestPath = join(root, 'latest', `${mode}.json`);
  const indexPath = join(root, 'index.json');
  atomicWrite(runPath, serialized);
  atomicWrite(latestPath, serialized);

  const previousIndex = readJsonObject(indexPath);
  const index = {
    schemaVersion: 1,
    updatedAt: safeReport.completedAt ?? new Date().toISOString(),
    modes: {
      ...(previousIndex.modes && typeof previousIndex.modes === 'object' ? previousIndex.modes : {}),
      [mode]: {
        runId,
        status: safeReport.ok === true ? 'passed' : 'failed',
        completedAt: safeReport.completedAt ?? null,
        latest: `latest/${mode}.json`,
      },
    },
  };
  atomicWrite(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  if (resultOut) atomicWrite(resolve(resultOut), serialized);
  return { root, runPath, latestPath, indexPath, resultOut: resultOut ? resolve(resultOut) : null };
}

function safeFileSegment(value, label) {
  const normalized = String(value ?? '');
  if (!SAFE_FILE_SEGMENT.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`INVALID_GATE_REPORT_${label.toUpperCase()}`);
  }
  return normalized;
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${path.split('/').at(-1)}.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The rename normally consumed the temporary file.
    }
  }
}

function readJsonObject(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function redactString(value) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk_(?:public|account|machine|connect|agent)_[A-Za-z0-9._-]+\b/g, '[REDACTED]')
    .replace(/(?:[A-Za-z]:)?[^\s"']*agent-proxy-tokens[^\s"']*/gi, '[REDACTED_PATH]');
}

function isSecretKey(key) {
  const normalized = String(key).replace(/[-_]/g, '').toLowerCase();
  if (/(?:authorization|cookie|password|secret)/.test(normalized)) return true;
  return [
    'token',
    'accounttoken',
    'sessiontoken',
    'publickey',
    'apikey',
    'machinetoken',
    'connecttoken',
    'agenttoken',
    'proxytoken',
    'authtoken',
  ].includes(normalized);
}

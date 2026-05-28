import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'aaa-claude-e2e-'));
const wrapperDir = join(root, '.slock');
const marker = join(root, 'slock-called.json');

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.on('error', err => resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
    child.stdin.end();
  });
}

mkdirSync(wrapperDir, { recursive: true });

writeFileSync(join(wrapperDir, 'slock.cmd'), [
  '@echo off',
  `echo {"argv":"%*"} > "${marker}"`,
  'echo {"events":[],"source":"fake-slock"}',
  '',
].join('\r\n'), 'utf-8');

writeFileSync(join(wrapperDir, 'slock.ps1'), [
  `$payload = @{ argv = ($args -join ' ') } | ConvertTo-Json -Compress`,
  `Set-Content -Path '${marker.replace(/'/g, "''")}' -Value $payload`,
  'Write-Output \'{"events":[],"source":"fake-slock"}\'',
  '',
].join('\n'), 'utf-8');

writeFileSync(join(wrapperDir, 'slock'), [
  '#!/usr/bin/env bash',
  `printf '{"argv":"%s"}\\n' "$*" > "${marker.replace(/\\/g, '/')}"`,
  'printf \'{"events":[],"source":"fake-slock"}\\n\'',
  '',
].join('\n'), 'utf-8');

const env = {
  ...process.env,
  PATH: `${wrapperDir}${delimiter}${process.env.PATH ?? ''}`,
  FORCE_COLOR: '0',
};

const prompt = [
  'Use the Bash tool exactly once to run this command:',
  '`slock message check --limit 1`',
  'Then answer with the raw command output only.',
].join('\n');

const claudeCommand = process.platform === 'win32'
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  : 'claude';
const result = await run(claudeCommand, [
  '-p',
  '--verbose',
  '--no-session-persistence',
  '--output-format', 'stream-json',
  '--permission-mode', 'bypassPermissions',
  '--dangerously-skip-permissions',
  '--allowedTools', 'Bash(slock message check*)',
  '--max-budget-usd', '0.30',
  '--system-prompt', 'You are testing a local slock wrapper. You must use the slock CLI command requested by the user.',
  prompt,
], { cwd: root, env });

try {
  assert.equal(result.code, 0, `claude exited ${result.code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.equal(existsSync(marker), true, `slock wrapper was not called\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  const markerJson = JSON.parse(readFileSync(marker, 'utf-8'));
  assert.match(markerJson.argv, /message check --limit 1/);
  console.log(JSON.stringify({ ok: true, wrapperDir, marker: markerJson }));
} finally {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.error(`[claude-e2e] cleanup skipped: ${(err).message}`);
  }
}

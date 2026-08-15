import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeAgentInstructionsFile, AGENT_INSTRUCTIONS_FILE } from '../dist/runtime/agent-instructions.js';

// G2 (task 08-15): the Slock system prompt moves from per-turn user-message
// wrapping into <workspacePath>/AGENTS.md. The write must be idempotent
// (restart/runtime switch replaces only our marker block) and must preserve
// AGENTS.md content the agent itself authored.

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), 'aaa-agent-instructions-'));
}

const promptA = 'Slock instructions A — agent one';
const promptB = 'Slock instructions B — agent two (runtime switch)';

test('creates AGENTS.md in the workspace root on first start', () => {
  const workspace = tempWorkspace();
  try {
    const file = writeAgentInstructionsFile({ workspacePath: workspace, systemPrompt: promptA });
    assert.equal(file, join(workspace, AGENT_INSTRUCTIONS_FILE));
    const content = readFileSync(file, 'utf-8');
    assert.match(content, /slock:agent-instructions:start/);
    assert.equal(content.includes(promptA), true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('restart replaces only the marker block and keeps agent-authored content', () => {
  const workspace = tempWorkspace();
  try {
    writeAgentInstructionsFile({ workspacePath: workspace, systemPrompt: promptA });
    const file = join(workspace, AGENT_INSTRUCTIONS_FILE);
    // The agent appends its own notes below our block during its lifetime.
    writeFileSync(file, `${readFileSync(file, 'utf-8')}\n\n## Agent notes\n\nkept across restarts\n`, 'utf-8');

    writeAgentInstructionsFile({ workspacePath: workspace, systemPrompt: promptB });

    const content = readFileSync(file, 'utf-8');
    assert.equal(content.includes(promptA), false);
    assert.equal(content.includes(promptB), true);
    assert.match(content, /## Agent notes/);
    assert.match(content, /kept across restarts/);
    // Exactly one marker block — no accumulation across restarts.
    assert.equal(content.match(/slock:agent-instructions:start/g).length, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('pre-existing agent-authored AGENTS.md is preserved below the injected block', () => {
  const workspace = tempWorkspace();
  try {
    writeFileSync(join(workspace, AGENT_INSTRUCTIONS_FILE), '# Project conventions\n\nwritten by the agent\n', 'utf-8');
    writeAgentInstructionsFile({ workspacePath: workspace, systemPrompt: promptA });
    const content = readFileSync(join(workspace, AGENT_INSTRUCTIONS_FILE), 'utf-8');
    const startMarker = content.indexOf('slock:agent-instructions:start');
    const authored = content.indexOf('# Project conventions');
    assert.ok(startMarker !== -1 && authored !== -1 && startMarker < authored);
    assert.match(content, /written by the agent/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

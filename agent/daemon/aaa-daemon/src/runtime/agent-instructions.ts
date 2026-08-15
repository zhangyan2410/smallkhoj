import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const AGENT_INSTRUCTIONS_FILE = 'AGENTS.md';

const INSTRUCTIONS_START = '<!-- slock:agent-instructions:start -->';
const INSTRUCTIONS_END = '<!-- slock:agent-instructions:end -->';

/**
 * G2 (task 08-15): goose and codex both load a project-level AGENTS.md from
 * the session cwd into their own system-prompt slot. Writing the Slock prompt
 * there replaces the old `buildCodexPrompt` per-turn wrapping, which re-sent
 * ~9k tokens of instructions inside every user message and rolled them into
 * the conversation history (full price on each new session's first call).
 *
 * Keeping the instructions outside the conversation is also the compaction
 * fallback the PRD asks for: goose/codex compaction summarizes conversation
 * turns, while instructions loaded from AGENTS.md stay in the system prompt.
 *
 * The write is marker-scoped and idempotent: restarts (or runtime switches on
 * the same workspace) replace only our own block, and AGENTS.md content the
 * agent itself authored below the block is preserved untouched.
 */
export function writeAgentInstructionsFile(options: { workspacePath: string; systemPrompt: string }): string {
  mkdirSync(options.workspacePath, { recursive: true });
  const instructionsFile = join(options.workspacePath, AGENT_INSTRUCTIONS_FILE);
  const block = `${INSTRUCTIONS_START}\n${options.systemPrompt.trim()}\n${INSTRUCTIONS_END}`;
  let existing = '';
  try {
    existing = existsSync(instructionsFile) ? readFileSync(instructionsFile, 'utf-8') : '';
  } catch {
    existing = '';
  }

  const startIndex = existing.indexOf(INSTRUCTIONS_START);
  const endIndex = existing.indexOf(INSTRUCTIONS_END);
  let next: string;
  if (startIndex !== -1 && endIndex > startIndex) {
    next = existing.slice(0, startIndex) + block + existing.slice(endIndex + INSTRUCTIONS_END.length);
  } else if (existing.trim()) {
    next = `${block}\n\n${existing}`;
  } else {
    next = `${block}\n`;
  }
  writeFileSync(instructionsFile, next, 'utf-8');
  return instructionsFile;
}

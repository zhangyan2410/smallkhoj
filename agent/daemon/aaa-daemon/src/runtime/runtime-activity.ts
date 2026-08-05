export type RuntimeActivityRuntime = 'claude_code' | 'codex' | 'opencode' | 'pi';

export type RuntimeActivityProtocol =
  | 'claude-stream-json'
  | 'codex-acp'
  | 'opencode-sse'
  | 'pi-stream';

export type RuntimeStreamActivitySignal =
  | {
      type: 'thinking';
      protocol: RuntimeActivityProtocol;
      sourceEvent: string;
      text: string;
    }
  | {
      type: 'tool_use';
      protocol: RuntimeActivityProtocol;
      sourceEvent: string;
      toolUseId: string;
      toolName: string;
      commandPreview: string;
    };

/**
 * Translate provider-specific stream events into the small, shared Activity
 * vocabulary consumed by DaemonCore. Provider adapters are responsible for
 * filtering user-authored transcript parts before this seam. The remaining
 * assistant narration follows the established Claude-compatible product
 * semantics: readable Thinking previews and Output only for real tool use.
 */
export function translateRuntimeStreamActivity(
  runtime: RuntimeActivityRuntime,
  event: unknown,
): RuntimeStreamActivitySignal[] {
  if (!isRecord(event)) return [];
  const eventType = stringField(event, 'type');
  if (eventType !== 'assistant' && eventType !== 'user') return [];

  const protocol = runtimeProtocol(runtime);
  const sourceEvent = runtimeSourceEvent(runtime, event);
  const signals: RuntimeStreamActivitySignal[] = [];

  for (const block of contentBlocks(event)) {
    const blockType = stringField(block, 'type');
    if (eventType === 'assistant' && blockType === 'thinking') {
      const thinking = stringField(block, 'thinking');
      if (thinking) {
        signals.push({ type: 'thinking', protocol, sourceEvent, text: thinking });
      }
      continue;
    }

    if (eventType === 'assistant' && blockType === 'text') {
      const text = stringField(block, 'text');
      if (!text) continue;
      signals.push({
        type: 'thinking',
        protocol,
        sourceEvent,
        text,
      });
      continue;
    }

    if (eventType === 'assistant' && blockType === 'tool_use') {
      const toolUseId = stringField(block, 'id');
      if (!toolUseId) continue;
      const input = isRecord(block.input) ? block.input : {};
      signals.push({
        type: 'tool_use',
        protocol,
        sourceEvent,
        toolUseId,
        toolName: stringField(block, 'name') ?? 'tool',
        commandPreview: toolInputPreview(input, stringField(block, 'name') ?? 'tool'),
      });
    }
  }

  return signals;
}

function runtimeProtocol(runtime: RuntimeActivityRuntime): RuntimeActivityProtocol {
  switch (runtime) {
    case 'codex':
      return 'codex-acp';
    case 'opencode':
      return 'opencode-sse';
    case 'pi':
      return 'pi-stream';
    default:
      return 'claude-stream-json';
  }
}

function runtimeSourceEvent(runtime: RuntimeActivityRuntime, event: Record<string, unknown>): string {
  if (runtime === 'codex') {
    return stringField(event, 'acpUpdate') ?? 'codex_stream_event';
  }
  if (runtime === 'opencode') {
    return stringField(event, 'opencodeEvent') ?? 'opencode_stream_event';
  }
  return stringField(event, 'type') === 'assistant' ? 'assistant_text' : 'tool_result';
}

function contentBlocks(event: Record<string, unknown>): Record<string, unknown>[] {
  const message = isRecord(event.message) ? event.message : undefined;
  return Array.isArray(message?.content)
    ? message.content.filter(isRecord)
    : [];
}

function toolInputPreview(input: Record<string, unknown>, fallback: string): string {
  for (const key of ['command', 'cmd', 'script', 'query', 'path', 'file_path', 'url']) {
    const value = stringField(input, key);
    if (value) return value;
  }
  const rawInput = isRecord(input.rawInput) ? input.rawInput : undefined;
  if (rawInput) {
    for (const key of ['command', 'cmd', 'script', 'query', 'path', 'file_path', 'url']) {
      const value = stringField(rawInput, key);
      if (value) return value;
    }
  }
  return fallback;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type LocalRuntimeProviderRuntime = 'claude_code' | 'codex' | 'codex_acp' | 'opencode';

export type LocalRuntimeProviderSource = 'cc-switch' | 'manual' | 'opencode-config';

export interface LocalRuntimeProvider {
  id: string;
  name: string;
  runtime: LocalRuntimeProviderRuntime;
  model?: string;
  agent?: string;
  command?: string;
  commandArgs?: string[];
  opencodeConfig?: Record<string, unknown>;
  source: LocalRuntimeProviderSource;
}

export interface RuntimeProviderInventory {
  ccsClaudeCommand?: string;
  claudeCommand?: string;
  codexCommand?: string;
  opencodeCommand?: string;
  gooseCommand?: string;
  providers: LocalRuntimeProvider[];
}

export interface RuntimeProviderLaunch {
  command?: string;
  commandArgs?: string[];
  model?: string;
  agent?: string;
  runtimeProvider?: string;
  opencodeConfig?: Record<string, unknown>;
  error?: string;
}

export type LocalRuntimeProviderRuntime = 'claude_code' | 'codex' | 'codex_cli' | 'codex_acp';

export type LocalRuntimeProviderSource = 'cc-switch' | 'codex-cli' | 'manual';

export interface LocalRuntimeProvider {
  id: string;
  name: string;
  runtime: LocalRuntimeProviderRuntime;
  model?: string;
  command?: string;
  commandArgs?: string[];
  source: LocalRuntimeProviderSource;
}

export interface RuntimeProviderInventory {
  ccsClaudeCommand?: string;
  claudeCommand?: string;
  codexCommand?: string;
  providers: LocalRuntimeProvider[];
}

export interface RuntimeProviderLaunch {
  command?: string;
  commandArgs?: string[];
  model?: string;
  runtimeProvider?: string;
  error?: string;
}

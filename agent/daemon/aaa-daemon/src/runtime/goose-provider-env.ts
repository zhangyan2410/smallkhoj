// goose speaks to its LLM provider directly via its native config
// (`~/.config/goose/config.yaml`, set up with `goose configure`). The daemon
// does NOT broker goose credentials. This module only sets the platform-enforced
// switches and scrubs env keys left over from core/runtime switching so goose
// never accidentally points at the smallkhoj claude relay.

const GOOSE_USER_AGENT = 'User-Agent=smallkhoj-goose/1.0';

/**
 * Returns a child env derived from `baseEnv` with goose platform switches
 * applied. Mutates a copy, never the caller's env.
 */
export function applyGooseProviderEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  // Scrub credentials/base-urls injected for the claude-code runtime path so a
  // goose configured for the anthropic provider does not pick up a relay token
  // it cannot use.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  // Prevent a stale fast-model override from a previous run.
  delete env.GOOSE_FAST_MODEL;

  // Auto-approve tool calls; the daemon/ACP layer governs permissions.
  env.GOOSE_MODE = 'auto';
  // Credentials live in goose config, never the OS keyring on a daemon host.
  env.GOOSE_DISABLE_KEYRING = '1';
  // Disable two per-call LLM UI niceties (AI tool-call titles, AI session
  // names) that waste tokens and latency.
  env.GOOSE_DISABLE_TOOL_CALL_SUMMARY = '1';
  env.GOOSE_DISABLE_SESSION_NAMING = '1';
  // goose's reqwest client omits User-Agent by default; tag chat requests so
  // providers can identify this daemon. Format is comma-separated Key=Value.
  env.OPENAI_CUSTOM_HEADERS = GOOSE_USER_AGENT;

  return env;
}

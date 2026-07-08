import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AgentProxy, generateProxyToken } from '../proxy/agent-proxy.js';
import { importSlockRuntime } from '../runtime/import-slock-runtime.js';
import { writeSlockWrapper } from '../runtime/slock-wrapper.js';
import { runSlockCli } from '../slock-cli.js';

export interface SmokeOptions {
  importSlockRuntime: string;
  workspace?: string;
}

export async function runReadOnlySmoke(options: SmokeOptions): Promise<number> {
  const imported = importSlockRuntime(options.importSlockRuntime);
  const proxy = new AgentProxy();
  const tempWorkspace = options.workspace ?? mkdtempSync(join(tmpdir(), 'aaa-smoke-'));
  const token = generateProxyToken();
  let stdout = '';
  let stderr = '';

  try {
    await proxy.start(0);
    proxy.register({
      token,
      credential: imported.credential,
      activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
    });

    const wrapper = writeSlockWrapper({
      workspacePath: tempWorkspace,
      proxyUrl: proxy.getProxyUrl(),
      proxyToken: token,
      credential: imported.credential,
      activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
      launchId: `smoke-${process.pid}`,
    });

    const code = await runSlockCli(['server', 'info', '--format', 'json'], {
      env: {
        SLOCK_AGENT_PROXY_URL: proxy.getProxyUrl(),
        SLOCK_AGENT_PROXY_TOKEN_FILE: wrapper.tokenFile,
        SLOCK_AGENT_ID: imported.credential.agentId,
      },
      stdout: { write: (chunk: string | Uint8Array) => { stdout += String(chunk); return true; } },
      stderr: { write: (chunk: string | Uint8Array) => { stderr += String(chunk); return true; } },
    });

    if (code !== 0) {
      console.error(stderr.trim() || 'server info smoke failed');
      return code;
    }

    const data = JSON.parse(stdout);
    const channels = Array.isArray(data.channels) ? data.channels.length : 0;
    const agents = Array.isArray(data.agents) ? data.agents.length : 0;
    const humans = Array.isArray(data.humans) ? data.humans.length : 0;

    console.log(JSON.stringify({
      ok: true,
      source: imported.source,
      agentId: imported.credential.agentId,
      serverUrl: imported.mcpCredential.serverUrl,
      serverId: typeof data.id === 'string' ? data.id : undefined,
      serverName: typeof data.name === 'string' ? data.name : undefined,
      channels,
      agents,
      humans,
    }, null, 2));
    return 0;
  } finally {
    proxy.stop();
    if (!options.workspace) {
      try {
        rmSync(tempWorkspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // Temp cleanup can be retried by the OS on Windows.
      }
    }
  }
}

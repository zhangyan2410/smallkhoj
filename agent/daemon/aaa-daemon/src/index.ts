#!/usr/bin/env node
/**
 * CLI Entry Point
 * Provides commands to start and manage the daemon
 */

import { Command } from 'commander';
import { DaemonCore } from './daemon.js';
import type { DaemonConfig } from './types.js';

const program = new Command();

program
  .name('aaa-daemon')
  .description('Minimal Slock Daemon prototype')
  .version('0.1.0');

program
  .command('daemon')
  .description('Start the daemon')
  .option('-c, --config <path>', 'Config file path')
  .option('-p, --proxy-port <port>', 'Proxy port', '3456')
  .option('-s, --server <url>', 'Slock server URL', 'https://api.slock.io')
  .option('-w, --ws <url>', 'WebSocket URL', 'wss://ws.slock.io')
  .option('--agent-id <id>', 'Agent ID')
  .option('--credential <path>', 'Credential file path')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => {
    const config: DaemonConfig = {
      agentId: options.agentId || process.env.SLOCK_AGENT_ID || 'prototype-agent',
      serverUrl: options.server,
      wsUrl: options.ws,
      credentialPath: options.credential || './credential.json',
      proxyPort: parseInt(options.proxyPort, 10),
      logLevel: options.verbose ? 'debug' : 'info',
    };

    const daemon = new DaemonCore(config);

    try {
      await daemon.start();
    } catch (err) {
      console.error('Failed to start daemon:', err);
      process.exit(1);
    }
  });

program
  .command('send')
  .description('Send a message (demo)')
  .requiredOption('-t, --target <target>', 'Message target')
  .requiredOption('-m, --message <content>', 'Message content')
  .action((options) => {
    console.log(`[Demo] Would send to ${options.target}: ${options.message}`);
    // In a real implementation, this would connect to the running daemon
    // via the HTTP proxy or a local socket
  });

program
  .command('status')
  .description('Check daemon status')
  .action(() => {
    console.log('[Status] Daemon status check not implemented in prototype');
  });

program.parse();

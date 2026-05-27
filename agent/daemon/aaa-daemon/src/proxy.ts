/**
 * HTTP Proxy with Agent Token Injection
 * Acts as a local proxy server that injects auth tokens into requests
 * Also implements freshness check for message synchronization
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { EventEmitter } from 'events';
import type { Credential } from './types.js';

export class AgentProxy extends EventEmitter {
  private server: http.Server | null = null;
  private lastSeq = 0;

  constructor(
    private credential: Credential,
    private port: number
  ) {
    super();
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.port, () => {
      console.log(`[Proxy] Listening on http://localhost:${this.port}`);
    });
  }

  private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const targetUrl = new URL(this.credential.serverUrl);
    const options: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: clientReq.url,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        'Authorization': `Bearer ${this.credential.token}`,
        'X-Agent-ID': this.credential.agentId,
        'X-Client-Version': 'aaa-daemon/0.1.0',
      },
    };

    // Freshness check header
    options.headers!['X-Freshness-Seq'] = String(this.lastSeq);

    const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(options, (proxyRes) => {
      // Check for freshness hold
      const freshnessHold = proxyRes.headers['x-freshness-hold'];
      if (freshnessHold) {
        console.log(`[Proxy] Freshness hold detected: ${freshnessHold}`);
        this.emit('freshness_hold', { seq: this.lastSeq, holdInfo: freshnessHold });
      }

      // Update last seen seq if provided
      const newSeq = proxyRes.headers['x-latest-seq'];
      if (newSeq) {
        this.lastSeq = Math.max(this.lastSeq, parseInt(newSeq as string, 10));
      }

      clientRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on('error', (err) => {
      console.error('[Proxy] Request error:', err.message);
      clientRes.writeHead(502);
      clientRes.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    });

    clientReq.pipe(proxyReq, { end: true });
  }

  updateSeq(seq: number): void {
    if (seq > this.lastSeq) {
      this.lastSeq = seq;
    }
  }

  getProxyUrl(): string {
    return `http://localhost:${this.port}`;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}

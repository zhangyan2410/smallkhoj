import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const versionSource = new URL('../src/version.ts', import.meta.url);
const mainSource = new URL('../src/cmd/main.ts', import.meta.url);
const daemonSource = new URL('../src/daemon/daemon.ts', import.meta.url);
const chatBridgeSource = new URL('../src/chat-bridge.ts', import.meta.url);
const clientHandlerSource = new URL('../src/daemon/client-handler.ts', import.meta.url);

test('daemon CLI and registration use package version source of truth', () => {
  assert.ok(existsSync(versionSource), 'daemon version helper should be the single package-version source');

  const sources = [
    readFileSync(mainSource, 'utf8'),
    readFileSync(daemonSource, 'utf8'),
    readFileSync(chatBridgeSource, 'utf8'),
    readFileSync(clientHandlerSource, 'utf8'),
  ];

  assert.match(sources[0], /DAEMON_VERSION/);
  for (const source of sources) {
    assert.doesNotMatch(source, /['"]0\.2\.0['"]/, 'daemon version must not be hard-coded in runtime source');
  }
});

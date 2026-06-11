# Daemon Packaged Onboarding

## macOS Local Wrapper

The root-level `smallkhoj-daemon` wrapper is the product-facing command for local onboarding:

```bash
/Users/code/project/smallkhoj/smallkhoj-daemon connect --token sk_connect_... --server http://localhost:8000
```

It hides the internal `agent/daemon/aaa-daemon` path and supports:

```bash
/Users/code/project/smallkhoj/smallkhoj-daemon --version
/Users/code/project/smallkhoj/smallkhoj-daemon connect --token sk_connect_...
/Users/code/project/smallkhoj/smallkhoj-daemon start --machine-token sk_machine_...
```

## Security

The browser connect/reconnect flow shows a one-time `sk_connect_...` ticket. It does not show a `sk_machine_...` token. The daemon exchanges the connect ticket with `/internal/agent-api/daemon/connect`.

## Troubleshooting

If the wrapper reports a missing daemon build, run:

```bash
cd /Users/code/project/smallkhoj/agent/daemon/aaa-daemon
npm install
npm run build
```

If the ticket expires, generate a new command from `/computers`.

## Evidence

See `evidence/REAL_daemon_onboarding_20260610T220500Z-notes.md`.

# Evidence directory

Use one marker for one candidate run:

```text
REAL_windows-computer-install-setup-connect_<YYYYMMDDHHMMSS>
```

Store only reviewable, redacted evidence. Suggested files:

```text
<marker>-preflight.txt
<marker>-install.txt
<marker>-setup.txt
<marker>-connect.txt
<marker>-reconnect.txt
<marker>-upgrade-rollback.txt
<marker>-ui.snapshot.txt
<marker>-ui.png
<marker>-summary.md
```

Every summary must name the candidate commit, frontend/API URLs, OS/CPU/PowerShell or macOS/Node versions, command exit codes, and PASS/BLOCKED status. Replace all `sk_connect_` and `sk_machine_` values with `<REDACTED_...>` before copying files here. Do not store browser cookies, database dumps, private keys, or raw server credentials.

For browser evidence, record the exact WebDriver `tabId` and `tabUrl`, use `./twd`, and keep the same marker across DOM checks, screenshots, API reconciliation, and trace output. A stale tab, static screenshot, or typecheck result cannot prove a real-host acceptance gate.

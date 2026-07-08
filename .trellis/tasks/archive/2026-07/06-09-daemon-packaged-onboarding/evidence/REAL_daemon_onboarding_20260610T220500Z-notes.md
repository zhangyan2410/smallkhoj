# REAL_daemon_onboarding_20260610T220500Z

## Verification

* `./smallkhoj-daemon --version` returned `smallkhoj-daemon 0.1.0`.
* `bash -n smallkhoj-daemon` passed.
* `POST /api/v1/computers/connect-command` returned a command using the root wrapper:
  * `/Users/code/project/smallkhoj/smallkhoj-daemon connect --token sk_connect_... --server http://localhost:8000`
* The generated command contains `sk_connect_`.
* The generated command does not contain `sk_machine_`.
* The generated command does not require `cd agent/daemon/aaa-daemon`.
* The response includes `expiresAt`.

## Evidence File

`REAL_daemon_onboarding_20260610T220500Z-connect-command.json`

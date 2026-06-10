# Real Test: Provider Runtime Agent

Marker: `REAL_provider_runtime_20260611010223`

Route verified: `/computers`

Result: PASS

What was verified:

- Daemon detected local CC Switch providers through the `ccs-claude` flow and uploaded provider capability names/models only.
- The created test agent stored `runtimeProvider: Kimi` with `backend: null`.
- The backend sent the provider selection without `runtimeCommand` or `runtimeModel`.
- The daemon launched the runtime through the local Kimi provider and reported the workspace as running.
- Browser-visible control plane state showed the marker agent as `Kimi` and running with a PID.

Evidence files:

- `REAL_provider_runtime_20260611010223-computers-api.json`
- `REAL_provider_runtime_20260611010223-members-api.json`
- `REAL_provider_runtime_20260611010223-trace.json`
- `REAL_provider_runtime_20260611010223-browser.txt`
- `REAL_provider_runtime_20260611010223-computers.png`
- `REAL_provider_runtime_20260611010223-members.png`

Key observed facts:

- API workspace: `runtimeProvider: Kimi`, `status: running`, `runtimeCommand: null`, `runtimeModel: null`.
- API member: `backend: null`, `runtimeProvider: Kimi`, `runtimeDesiredStatus: running`.
- Trace: `CC Switch provider: Kimi`, `Claude model: kimi-for-coding`, and runtime start for agent `8bd77997-acf4-490e-a595-49be7c32c732`.
- Browser snapshot: detected runtimes include `Kimi / available / kimi-for-coding` and `Zhipu GLM / available / glm-5.1`; marker workspace shows `Kimi` and `运行中`.

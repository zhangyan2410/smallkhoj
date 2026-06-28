# Initial release production env template guardrail

## Goal

Add a production env-file guardrail so the first Lighthouse deployment does not fail late because required `.env.prod` values are missing or still set to placeholder text.

The deployment path now has bundle generation, SSH upload/probe, preflight, compose startup, and post-deploy smoke. The next risk is that the server-side `.env.prod` file is handwritten and easy to leave with placeholder values such as `<set-outside-repo>`.

## Requirements

- Provide a no-secret `.env.prod` template generator that can write to stdout or a chosen output path.
- The generator must refuse to overwrite an existing file unless `--force` is provided.
- The template must include required operational keys and optional integration/runtime keys without real secret values.
- Deployment preflight must treat placeholder-shaped values as invalid for required keys.
- Deployment preflight output must not leak image names or secret values when reporting missing/placeholder env keys.
- Include the generator in the no-secret deployment bundle so it can run on the server.
- Update deployment docs and backend deploy spec.

## Acceptance Criteria

- [x] A template generator script exists and is covered by unit tests.
- [x] Env preflight fails when required values are blank or placeholder-shaped.
- [x] Bundle includes the generator script and excludes `.env.prod`.
- [x] Deployment docs explain generating `.env.prod` and running preflight before compose startup.
- [x] Existing deployment script tests pass.

## Notes

- This task is PRD-only because it is a contained script/test/docs/spec update.
- Validation: deployment script suite passed with 31 tests.
- Manual check: generated template preflight returns `RC=1`, reports required placeholder keys by name only, and `rg` found no placeholder values leaked in the JSON output.
- Bundle check: generated tarball includes `scripts/create_prod_env_template.py` and still excludes `.env.prod`.

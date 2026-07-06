Active task: .trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner

Review the selector-driven `./twd` proof runner implementation.

Diff scope to prioritize:

- `tools/twd-guard/twd-inkframe-proof.mjs`
- `tools/twd-guard/twd-inkframe-proof`
- `tools/twd-guard/twd-inkframe-proof.test.mjs`
- `.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/evidence/validation.md`
- generated proof evidence under the same task's `evidence/` directory

Primary risks to check:

1. False pass behavior: the runner must not claim browser/mobile acceptance when
   `./twd` has no connected tab.
2. Failure classification: `./twd --compact tabs` can return the no-tab JSON
   payload while exiting nonzero; this should be classified as
   `blocked_no_tab`, not generic `failed_twd`.
3. Browser safety: the runner must not launch Chrome or use external browser
   automation tooling.
4. Evidence safety: generated JSON/Markdown proof files must stay inside the
   selected task's `evidence/` directory.
5. Selector drift: checks should use stable `data-inkframe-*` contracts and
   cover product shell, chat desktop/mobile, chat unread, task desktop/mobile,
   and material state groups.
6. Route behavior: with a connected tab, route checks should go through the
   existing `tools/twd-guard` auth/open/eval flow rather than inventing a second
   WebDriver path.

Do not commit. Fix small mechanical issues if safe. Report open issues with
file/line references and list verification commands you ran.

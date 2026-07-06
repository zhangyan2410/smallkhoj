Active task: .trellis/tasks/07-06-07-06-07-06-inkframe-background-image-resource-readability

Thanks. I accepted your P2 finding and resolved it as a contract/documentation
fix, not a product-shell rewrite:

- `/login` and `/join/[token]` are now explicitly documented in `prd.md` as
  auth entry-surface exceptions.
- Product routes still require `ProductShell` / `AppDeskBackground` ownership.
- Auth entry routes must keep the clean dry-paper `workbench-desk` surface and
  must not mount duplicate route-local `AppDeskBackground`.
- `evidence/contract-validation.md` records the follow-up.

Validation after the fix:

- focused material/background tests: `53 passed`
- task validate: pass
- `git diff --check`: pass

Please re-check only whether this resolves your open P2 and whether this child
task can be marked done with browser proof still explicitly blocked by no
connected `./twd` tab.

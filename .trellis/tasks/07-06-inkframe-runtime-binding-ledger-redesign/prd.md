# Inkframe Runtime Binding Ledger Redesign

## Goal

Redesign the existing runtime/computer binding presentation as a clear
Inkframe object called `BindingLedger` / `绑定账页`.

This is the one intentionally retained follow-up after the Inkframe product UI
merge. The issue is not backend behavior; it is object-language alignment. The
current runtime binding area reads like a stack of equally strong black-framed
fields. It should instead feel like one ledger sheet that records the relation
between agent, computer, runtime, provider, workspace, and status.

## Requirements

- Treat `Runtime Binding` as a relation object, not as the runtime itself and
  not as the computer itself.
- Use one readable outer ledger boundary. Internal fields should be weaker
  marks/rows, not separate cards with the same visual strength as messages,
  tasks, evidence papers, or member/sidebar entities.
- Preserve the existing runtime binding functionality and data. This task is a
  presentation/object-language refactor, not a runtime API rewrite.
- Align wording and component naming with the existing object-language notes:
  `BindingLedger`, `绑定账页`, `运行绑定账本`, or `工位绑定单`.
- Keep status/availability indicators visible without stamping over avatars or
  competing with member status dots.
- Fit both desktop and mobile layouts without horizontal overflow.
- Reuse the shared Inkframe object/tokens where practical; do not create a
  one-off route-local style that future agents cannot name or modify.

## Acceptance Criteria

- [ ] The member/agent runtime binding UI has a named `BindingLedger` component
      or equivalent clearly named primitive.
- [ ] The ledger exposes stable DOM/source contracts so future agents can target
      it by object class rather than by route-local CSS.
- [ ] The ledger has one object boundary; internal fields are visually weaker
      rows/marks.
- [ ] Existing create/update/display runtime binding behavior still works.
- [ ] Mobile layout remains contained and readable.
- [ ] Tests or source-contract checks cover the object boundary and field
      strength distinction.

## Notes

- Reference:
  `.trellis/tasks/06-30-ink-wash-theme-exploration/object-language-alignment.md`
  section `Runtime Binding`.
- Keep this task open until the actual product UI is changed. Do not close it
  merely because the language has been documented.

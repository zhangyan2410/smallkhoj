# Implementation Plan

1. Add a failing source contract test to `frontend/test/material-surface.test.tsx`.
2. Update `frontend/app/members/members-list.tsx`:
   - import `SidebarEntityItem`;
   - wrap list root with mobile containment role/classes;
   - render each member row as a `SidebarEntityItem`;
   - keep lifecycle controls under the selected agent.
3. Update `frontend/app/computers/page.tsx`:
   - import `SidebarEntityItem`;
   - render list rows through `SidebarEntityItem`;
   - add contained computers-list scroll owner role/classes;
   - keep detail/runtime surfaces using `ComputerInkstone`.
4. Run focused tests for Inkframe/material source contracts.
5. Run type-check, scoped lint, `git diff --check`, and task validation.
6. Attempt `./twd` proof and record blocked/accepted status honestly.
7. Spawn a Trellis check worker; address findings or record self-review if the
   worker cannot start.

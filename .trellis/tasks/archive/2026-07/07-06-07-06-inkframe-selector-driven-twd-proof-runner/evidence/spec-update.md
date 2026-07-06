# Spec Update

Date: 2026-07-06

Updated:

```text
.trellis/spec/frontend/quality-guidelines.md
```

Added the `./twd` no-tab gate classification contract under the Real Browser
Test SOP.

Reason:

- Local evidence showed `./twd --compact tabs` can print a valid no-tab JSON
  payload while exiting nonzero.
- Proof runners must parse the payload before collapsing the result into a
  generic tool failure.
- Browser/mobile acceptance must remain pending when the parsed payload has no
  connected tabs.

The new spec section defines:

- command signature;
- no-tab payload shape;
- blocked/no-tab contract;
- validation and error matrix;
- tests required;
- wrong vs correct implementation sketch.

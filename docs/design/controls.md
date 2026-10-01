# Controls — PARSEC's in-house styles, with Blueprint as the reference

PARSEC's interface is built with `src/lib/dom.ts` (`el`, `btn`, `input`, `toast`). Those helpers emit
**Blueprint's class vocabulary** — `bp5-button`, `bp5-input`, `bp5-callout`, `bp5-intent-*`,
`bp5-large`, `bp5-small`, `bp5-minimal`, `bp5-outlined`, `bp5-fill`, `bp5-control`, `bp5-icon-*` —
because [Blueprint](https://blueprintjs.com/docs/) is the design system the interface was modelled
on. Blueprint remains the **reference** for how a control should look and behave: its Core docs
(Button, InputGroup, Callout, Checkbox, Switch, Icon) are where to look when adding one.

PARSEC does **not** load Blueprint. Since 2026-10-01 the vocabulary is styled in-house:

| File | What it styles |
|---|---|
| `src/styles/components/_controls.scss` | The base: buttons (sizes, intents, minimal, outlined, fill), inputs, selects, text areas, callouts, muted text, checkboxes and switches (native control, gold), and icons as text glyphs |
| `src/styles/vendors/_blueprint-overrides.scss` | Long-standing per-control refinements; loads after the base |
| `src/styles/themes/_dark.scss` | The `--bp-*` colour variables — PARSEC's own, kept under their original names |
| `src/styles/wallet/*` | Screen-specific rules |

Why it was dropped: the installed package was Blueprint **v6**, whose CSS uses `bp6-*` classes, so
none of its 3,768 rules ever matched PARSEC's `bp5-*` markup — the interface was already unstyled by
Blueprint, and its icon font never showed. Removing it takes a dependency (and React, its peer) out
of the build, in line with [cypherpunk4096](../cypherpunk4096.md)'s zero-dependency commitment.

Adding a control: keep the Blueprint class name if Blueprint has the control (so the reference
stays useful), and give it its rules in `_controls.scss` from the brand tokens (`--px-*` /
`$px-*`). Adding an icon: add its name and a text glyph to the `@each` map at the end of
`_controls.scss`.

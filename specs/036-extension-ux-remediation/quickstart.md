# Quickstart: validating One UI Floor for Every Extension

**Feature**: `036-extension-ux-remediation` | **Date**: 2026-09-05

How to prove each user story actually works. Every scenario here runs against the **built
app**, because the defects this feature fixes are invisible to unit tests that assert on mocked
collaborators or class names (FR-042).

---

## Prerequisites

```bash
nvm use                      # Node 22, per .nvmrc
npm ci
npm run build                # REQUIRED — e2e drives out/, not src/
```

> Rebuild after every source change before re-running any e2e scenario. A stale `out/` is the
> most common way to "verify" a fix that is not actually loaded.

Reference commands used below:

| Command                                | Purpose                                          |
| -------------------------------------- | ------------------------------------------------ |
| `npx playwright test tests/e2e/<spec>` | One end-to-end scenario                          |
| `npm run test`                         | Full unit suite with coverage (CI's command)     |
| `npm run lint`                         | ESLint, including the vocabulary and layer rules |
| `npm run check-patch-coverage`         | 80% patch-coverage gate on staged files          |

---

## US1 — Escape never destroys work (P1)

**The regression this replaces.** Against the current build, this sequence closes the extension
and discards the text:

1. Open SpecKit Pilot.
2. Click into the "Search docs & briefs…" field and type anything.
3. Press Escape twice within 500 ms.

Observed today: the extension closes, focus lands on the host sidebar, the text is gone.

**Expected after this feature**: the extension is still open and the text is unchanged.

```bash
npx playwright test tests/e2e/extension-escape.spec.ts
```

Assert all five, in the real app:

| Focus                                    | Escape ×2 | Expected                                            |
| ---------------------------------------- | --------- | --------------------------------------------------- |
| Text field in an extension               | —         | Extension stays open, text intact                   |
| Terminal inside an extension surface     | —         | Key reaches the terminal, no exit                   |
| Dialog open                              | —         | First press closes the dialog, second does not exit |
| Dialog open                              | Escape ×1 | Dialog closes, focus returns to the opener          |
| Nothing claimed it, focus not in a field | —         | Extension exits (existing behaviour preserved)      |

---

## US2 — One dialog, inherited by the whole product (P1)

```bash
npx playwright test tests/e2e/extension-dialogs.spec.ts
```

The spec walks every dismissible surface in the product — the 19 extension surfaces plus the
core's own dialogs — and asserts all five behaviours on each. It is the audit's matrix, run as
a test.

**Expected**: every surface passes all five. Baseline for comparison, measured on `main`:

| Check                   | Before | After |
| ----------------------- | ------ | ----- |
| Escape closes           | 6 / 19 | all   |
| `role="dialog"`         | 5 / 19 | all   |
| `aria-modal`            | 3 / 19 | all   |
| Focus managed           | 7 / 19 | all   |
| Click-outside dismisses | 4 / 19 | all   |

Then the isolation and duplication checks:

```bash
# No extension imports core renderer source at runtime (FR-008).
# Type-only imports of the contract are permitted and excluded.
grep -rn "from '.*src/renderer/" extensions/*/src --include="*.ts" --include="*.tsx" \
  | grep -v "import type"
# Expected: no output.

# Exactly one implementation of each primitive (SC-002a).
grep -rlnE "\.pr-dialog|\.keep-both-modal|\.pr-review-submit-overlay|\.sk-modal|\.cal-drawer" \
  extensions/*/src
# Expected: no output.

# No raw stacking values in extension CSS (FR-003, SC-005).
grep -rnE "z-index:\s*[0-9]" extensions/*/src
# Expected: no output.
```

**Isolation gate** (SC-004) — deleting any extension must leave the core building:

```bash
mv extensions/task-vault /tmp/ && npm run build && mv /tmp/task-vault extensions/
# Expected: build succeeds.
```

---

## US3 — Remote Control says whether it is on, where, and who (P2)

Manual, because it needs a real tunnel. Open **Remote Control** and confirm, without navigating
anywhere else:

- [ ] It states whether it is on or off.
- [ ] While on: address with a copy control, a scannable code, and the consequence line.
- [ ] The credential is **concealed** — revealing and copying each take a deliberate action.
- [ ] Scanning the code from a phone connects **without** the credential ever being displayed.
- [ ] Connected devices are listed and can be disconnected individually.
- [ ] Disconnecting one removes it from the list without a manual refresh.

Then force each failure and confirm a named state with a way forward:

```bash
# Occupy the port, then turn Remote Control on.
nc -l 7681
# Expected: "Port 7681 is already in use", with an action offered — not a silent failure.
```

Also check: turn it on with **no credential supplied**. The local address must be offered and
the public one must be plainly absent, not shown as broken.

---

## US4 — A SpecKit card says where the work has got to (P2)

Open **SpecKit** with cards at several phases:

- [ ] Each card names its current phase and the next step; no bare numbered circles.
- [ ] No card shows raw markup — the string `# Summary` appears nowhere.
- [ ] No card repeats its column's name, and no label reads identically on every card.
- [ ] Every column is reachable; none renders clipped without a scroll affordance.
- [ ] With nothing running, the supervision strip offers an action or takes no vertical space.
- [ ] Editing a card's title and closing the drawer warns before discarding.

**Chrome measurement (SC-014)** — with the board open:

```js
// in the extension view's devtools
document.querySelector('.sk-board__cols').getBoundingClientRect().top
// Expected: <= 100. Baseline on main: ~250.
```

Run the same measurement on the Code Reviews queue against its first row.

---

## US5 — Task Vault invites one action (P3)

Open **Task Vault** on a day with no entries:

- [ ] Exactly one empty state in the main column, carrying heading, explanation and an action.
- [ ] The side rail shows something the main column does not.
- [ ] The date is at least as prominent as the day name.

Then open **Weekly Review** and walk all six steps:

- [ ] All six steps are identifiable; position stated once, not four times.
- [ ] On every step the filled primary button **advances**; skip is present but subordinate.
- [ ] The calendar conveys each day's relative load.

---

## US6 — Reviewing a pull request starts by reading it (P3)

Open **Code Reviews** with a populated queue:

- [ ] Summary states a real count and reading time; no tile row, no `20+`.
- [ ] Each row states risk once, in words, needing no legend.
- [ ] The row's primary action opens the diff.
- [ ] Approving is reachable **only** from the row's overflow menu, and looks identical on
      every row regardless of risk.
- [ ] Scrolling to the end confirms the summary count was true.

Open the **Git Changes** panel with an untracked file:

- [ ] Status reads "New", not `?`.
- [ ] Exactly one primary action; when unavailable, it states what would enable it.

---

## US7 — One house style, enforced (P4)

```bash
npm run lint
```

Then prove the rule bites — add a forbidden term to a user-facing string and confirm the build
rejects it:

```bash
# e.g. add  <span>ngrok auth token</span>  to any extension component
npm run lint
# Expected: fails, naming the file, line and offending string.
git checkout -- <that file>
```

- [ ] Section labels, buttons and empty states follow the written rules across all five.
- [ ] Every empty state carries a heading, an explanation and at least one action.

---

## US8 — Both themes verified, not assumed (P4)

```bash
npx playwright test tests/e2e/extension-themes.spec.ts
```

Renders every extension surface in both themes and measures **computed** text and background
colour, then asserts WCAG AA. It must not read stylesheet text — the 739 raw `rgba()` values
and every `color-mix()` only resolve once rendered (research R5).

```bash
# No literal colours where a token exists (FR-040).
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\([0-9]" extensions/*/src/**/*.css | wc -l
# Baseline on main: 320 hex + 739 rgba. Expected after: only values with no token equivalent,
# each justified in review.
```

---

## Full gate before calling any story done

Per the project's standing checklist — all four must pass, from the worktree:

```bash
npm run format
npm run lint                  # 0 errors
npm run test                  # all pass, >=80% coverage
echo "exit=$?"                # must be 0 — the pass count alone is not the signal
npx playwright test           # full e2e
```

Check the **exit code**, not the printed pass count: vitest can print thousands passing and
still exit non-zero on an unhandled error.

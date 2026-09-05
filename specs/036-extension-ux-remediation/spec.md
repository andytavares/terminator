# Feature Specification: One UI Floor for Every Extension

**Feature Branch**: `036-extension-ux-remediation`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "using the specs in ~/Desktop/terminator-extension-ux/ write a spec for doing all this work" — three briefs produced by a UX audit of the five bundled extensions (`brief-1-platform.md`, `brief-2-mainviews.md`, `brief-3-housestyle.md`), covering 32 findings.

## Context

A UX audit of the five bundled extensions — Git Integration, Notepad, Remote Control, SpecKit Pilot, Task Vault — opened every screen, enumerated every modal in source, and drove the built app under Playwright. It produced 32 findings. They are not five separate styling problems; they trace to one gap.

**The Extension API publishes a design system's colours and none of its components.** `ExtensionAPI` exposes `db`, `log`, `settings`, `sidebar`, `workspace`, `topBar`, `shell` and `globalShortcut`, and nothing for the interface — there is no `ui` namespace. Extensions receive 31 `--tm-*` colour tokens and are then left to invent every behaviour those colours are painted on. Measured consequences:

- **The same primitive exists five times under five names**: `.pr-dialog`, `.keep-both-modal`, `.pr-review-submit-overlay`, `.notepad-overlay-backdrop`, `.sk-modal`/`.sk-drawer`, `.cal-drawer`.
- **Across the 19 modal and overlay surfaces the extensions ship**: Escape closes 6, `role="dialog"` is set on 5, `aria-modal` on 3, focus is managed in 7, click-outside dismisses 4. Only two surfaces are correct on all five counts; both are Notepad's. Notepad's own ExportDialog fails three of them — so even the extension that gets this right cannot do it consistently by hand.
- **There is no shared layer scale**, so extension CSS carries 14 unmanaged `z-index` values from 1 to 9999 and stacking is decided by whoever picked the larger number.
- **Extensions reach into core internals to fill the gap.** Notepad imports the core app's `ConfirmDialog` from `src/renderer/components/ConfirmDialog`; `GitSidebarPanel`, `NotepadView` and `TaskVaultView` import core's `useExtensionRegistry`; `ProjectsBrowser` imports core's `workspace.store`. Five runtime imports of core renderer source, which Constitution Principle II forbids. They are symptoms of the missing contract, not carelessness.

**The worst consequence is silent data loss, and it reproduces end to end.** The host window's double-Escape detector deliberately stands down inside a terminal, inside a text field, and while a modal is open. The copy of that detector that runs inside every extension (`src/main/preload-webview.ts`) has none of those three guards — it fires on any two Escapes within 500 ms whatever has focus. Typing `my unsaved draft` into SpecKit Pilot's search field and pressing Escape twice closes the extension and discards the draft. Because 13 of the 19 surfaces ignore Escape entirely, the user's second and harder press — the one made when the first appears to do nothing — is the one that ejects them. There is no confirmation and no undo.

Downstream of the same gap, **four of the five main views do not answer the question a person opens them to ask**:

- **Remote Control** promises access to your terminals from a browser and shows a settings form. It cannot state the address, whether the server is running, who is connected, or how to stop it. The required field is ordered last. The primary action is a bare checkbox. Nothing says that enabling it exposes a shell to the public internet — the codebase has a default-deny channel allowlist and per-IP failed-auth rate limiting, and none of it reaches the screen, including the password that protects the tunnel.
- **SpecKit Pilot** tracks a ten-phase lifecycle and draws it as ten identical grey circles numbered 1–10 with a `0/10` fraction. The phase names appear nowhere. The same card carries a type chip reading `FEATURE` on every card, a status chip reading `Backlog` while sitting in the column headed Backlog, and the literal text `# Summary` where the description belongs. Four stacked bands of chrome cost ~250 px before the first card, one of them a full-width band reading "Nothing is running."; the Done column overflows with no scroll affordance and truncates to folder names.
- **Task Vault** opens an empty day with three stacked treatments of nothing in one column plus a fourth in the right rail. Its Weekly Review styles the skip action as the filled primary on every step of a six-step wizard, states position four times over, and never shows what the six steps are. Its month calendar shows no task data.
- **Git Integration**'s Code Reviews opens on four big-number tiles, two reading `0`; `20+` is a count that gave up; two labels carry instructions in caps. Risk is encoded three times per row — six unlabelled dots, a `MED`/`LOW` chip, a coloured edge — and every row carries an Approve button tinted by risk, so approving unread is always one click away. Its sidebar panel shows git's raw porcelain `?` as a file status and offers three near-equal buttons of which two are disabled and indistinguishable.

Underneath all five, **there is no written house style**: section labels are caps in three extensions and sentence case in two; button labels appear in title case, sentence case, lowercase and as a full sentence, one dialog using two conventions at once; empty states range from Notepad's heading-plus-explanation-plus-two-actions to bare grey italic offering nothing. Extensions speak the implementation's language ("ngrok auth token", "saved to vault", "Artifacts", "Stalls", `?`) where the core app has an ESLint rule forbidding "project" in user-facing strings. And beneath 2,325 `--tm-*` references sit 320 hardcoded hex values and 739 raw `rgba()` literals that the light theme cannot reach; nothing currently verifies any extension renders correctly in light mode.

Notepad is the counter-example throughout and the model to standardise on: its two compliant overlays and its empty state are already the target pattern, and they already live in this codebase.

This feature builds the missing floor, moves every extension onto it, redesigns the four main views, and writes the house rules down with enforcement. It changes no underlying data model. The published extension contribution contract is extended, never broken.

## Clarifications

### Session 2026-09-05

- Q: When a dialog opens inside an extension, should the extension's own content stay visible and dimmed behind it, or is it acceptable for that content to disappear while the dialog is open? → A: Stay visible and dimmed — the platform ships the dialog component but it renders inside the extension's own view, and modal depth is reported to the host.
- Q: Should approving a pull request straight from the queue row, without opening its diff, be removed entirely, moved somewhere less prominent, or left exactly as it is? → A: Kept, but moved into the row's overflow menu rather than the primary slot, and no longer coloured by risk; the row's primary action becomes Review.
- Q: When Remote Control is running, should the access password sit in plain text on the screen, or be hidden until you ask to see it? → A: Masked by default with an explicit reveal control and a copy action; the scannable code carries the credential so the everyday path never displays it.
- Q: Should the core app's own dialogs and toasts move onto the same shared pieces the extensions get, or should the shared pieces be for extensions only? → A: The core app adopts them too and publishes them outward — one implementation for the whole product, with the core's existing dialogs migrated.
- Q: How much of the vertical space above the first card or pull request should the redesign actually win back? → A: No more than 100px of chrome above the first item on both screens, matching the benchmark the sidebar already meets (down from approximately 250px).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Escape never destroys work (Priority: P1)

A person typing a commit message, a note, or a card brief inside any extension presses Escape — once, then again when nothing seems to happen. Their text survives and they stay where they are. Escape dismisses whatever claimed it; only when nothing has claimed it, and focus is not in a text field or a terminal, does a deliberate double-press return them to their terminal.

**Why this priority**: It is the only finding in the audit that destroys user data, it has no workaround, and it is reachable from every extension by the most-pressed key in the app. It is also the smallest slice here — one shared detector with three guards — so it can ship before anything else is built.

**Independent Test**: Open any extension, focus a text input, type a value, press Escape twice within 500 ms. Confirm the extension is still showing and the text is intact. Repeat with focus in a terminal, and with a dialog open.

**Acceptance Scenarios**:

1. **Given** focus is in a text field inside an extension, **When** the user presses Escape twice in quick succession, **Then** the extension stays open and the typed text is unchanged.
2. **Given** a dialog is open inside an extension, **When** the user presses Escape once, **Then** the dialog closes and the extension stays open.
3. **Given** a dialog is open inside an extension, **When** the user presses Escape twice, **Then** the first press closes the dialog, the second does not exit the extension, and focus returns to the control that opened the dialog.
4. **Given** focus is inside a terminal rendered within an extension surface, **When** the user presses Escape twice, **Then** the key is delivered to the terminal and the extension is not exited.
5. **Given** no dialog is open and focus is not in a text field or terminal, **When** the user presses Escape twice in quick succession, **Then** the extension is exited and focus returns to the active terminal — the existing behaviour, preserved.

---

### User Story 2 - One dialog, inherited by the whole product (Priority: P1)

Anyone building a surface — in the core application or in an extension — asks the platform for a dialog, a confirmation, a toast or an empty state and receives one that already behaves correctly. Every dismissible surface in the product closes on Escape, traps focus while open, returns focus on close, announces itself to assistive technology, dims what is behind it, and dismisses on an outside click — without anyone implementing those behaviours again.

**Why this priority**: It is the structural fix. Seventeen of the nineteen failing behaviour checks close here without any extension changing its own layout, it removes the reason the five illegal core imports exist, it retires the unmanaged z-index values, and it deletes a large share of the bespoke overlay code that Stories 3–6 would otherwise have to redesign. Every later story is cheaper once this exists.

**Independent Test**: Migrate the 19 extension surfaces and the core's own dialogs, then re-run the behaviour matrix. All five checks pass on every surface. Search the product for a second implementation of a dialog, confirm or toast and find none. Delete an extension's directory and confirm the core application still builds and runs.

**Acceptance Scenarios**:

1. **Given** any dismissible surface anywhere in the product, in the core application or in any of the five extensions, **When** it is open, **Then** it closes on Escape, closes on an outside click, exposes a dialog role and modal state to assistive technology, and visually dims the content behind it.
2. **Given** a dialog is opened from a control, **When** the dialog closes by any route, **Then** keyboard focus returns to that control.
3. **Given** a dialog is open, **When** the user cycles focus with the keyboard, **Then** focus stays within the dialog.
4. **Given** an extension surface stacks a picker over a dialog over a panel, **When** all three are open, **Then** each renders above the one it was opened from, with ordering determined by named layers rather than per-extension numbers.
5. **Given** any of the five extension directories is deleted, **When** the core application is built and launched, **Then** it builds and runs without modification.
6. **Given** an icon-only control in any extension, **When** it is reached by keyboard or read by assistive technology, **Then** it has an accessible name.

---

### User Story 3 - Remote Control says whether it is on, where, and who is connected (Priority: P2)

A person opens Remote Control to reach a terminal from their phone. The screen tells them immediately whether it is running, the address to open, the password that protects it, what that access permits, which devices are connected right now, and how to stop it. Configuration is present but out of the way until wanted.

**Why this priority**: The largest gain per hour in the audit — one screen that currently answers none of the three questions it exists for — and the only extension whose interface omits a security consequence the codebase already defends against.

**Independent Test**: Enable Remote Control and confirm the view states its running state, address, password and connected devices, and offers a stop control, without navigating elsewhere. Occupy its port and confirm the failure is named on screen with a way forward.

**Acceptance Scenarios**:

1. **Given** Remote Control is off, **When** the user opens the view, **Then** it states that it is off and offers a single obvious control to turn it on.
2. **Given** Remote Control is on, **When** the user opens the view, **Then** it shows the reachable address with a copy action, a scannable form for phones, one plain-language line stating what a holder of the address and credential can do, and a control to turn it off.
3. **Given** Remote Control is on, **When** the user opens the view, **Then** the access credential is concealed, and revealing or copying it each require a deliberate action.
4. **Given** a person scans the code with a phone, **When** they connect, **Then** they are admitted without the credential having been displayed on screen.
5. **Given** browsers are connected, **When** the user opens the view, **Then** each connected device is listed with what it is viewing and can be individually disconnected.
6. **Given** the configured port is already in use, **When** the user turns Remote Control on, **Then** the view states what happened in plain language and offers a way to resolve it.
7. **Given** the user has not yet supplied the credential required for a public address, **When** they open the view, **Then** that requirement is presented before optional settings, not after them.

---

### User Story 4 - A SpecKit card says where the work has got to (Priority: P2)

A person scanning the SpecKit board can read, from the card alone, which phase each piece of work has reached and what happens next, without having memorised a phase numbering. Cards carry only facts that vary between them. The board's columns are all reachable.

**Why this priority**: The ten unnamed numbered circles are the least readable element in the app and defeat the board's only purpose. The card drawer's missing dismissal behaviour is inherited from Story 2, so the remaining work here is presentational and self-contained.

**Independent Test**: Open the board with cards at several phases. Confirm each card names its phase and its next step, shows no repeated or invariant chips, renders no raw markup, and that every column including the last is fully reachable.

**Acceptance Scenarios**:

1. **Given** a card at any phase, **When** the user looks at it, **Then** the phase is identified by name and the next step is stated, without requiring knowledge of a numbering scheme.
2. **Given** a card whose brief is stored as markup, **When** it is displayed, **Then** the reader sees rendered or plain prose, never raw markup syntax.
3. **Given** a card sitting in a column, **When** the user looks at it, **Then** it does not repeat the column's own name, and does not carry a label whose value is identical on every card.
4. **Given** more columns than fit the window, **When** the user views the board, **Then** every column is reachable and no column renders clipped without an affordance indicating more content.
5. **Given** the board has nothing running, **When** the user views it, **Then** the supervision area either offers the action that starts something or occupies no vertical space, rather than reporting an absence in a full-width band.
6. **Given** a card with unsaved edits in its detail view, **When** the user attempts to close it, **Then** they are told there are unsaved changes before the edits are discarded.

---

### User Story 5 - Task Vault invites one action instead of reporting nothing four times (Priority: P3)

A person opening an empty day sees one invitation with a clear next action, in the same shape Notepad already uses. The surrounding panels show information the main column does not. Their Weekly Review shows what the six steps are, and the loudest button always moves them forward.

**Why this priority**: The extension is heavily used and its first screen is its weakest, but nothing here loses data or blocks a task. It also benefits most from Story 2, which removes seven bespoke pickers and drawers before this work restyles them.

**Independent Test**: Open Task Vault on a day with no entries and confirm exactly one empty state appears in the main column and that the side rail shows something other than the same day. Walk all six Weekly Review steps and confirm the filled primary always advances.

**Acceptance Scenarios**:

1. **Given** a day with no entries, **When** the user opens Task Vault, **Then** the main column presents a single empty state carrying a heading, a one-line explanation and at least one action, and no other statement of emptiness appears in that column.
2. **Given** the main column is showing a given day, **When** the user looks at the side rail, **Then** the rail shows information the main column does not.
3. **Given** the Weekly Review is open at any step, **When** the user looks at the screen, **Then** all six steps are identifiable and the current position is stated once.
4. **Given** any Weekly Review step, **When** the user looks at the controls, **Then** the most visually prominent action advances the review and the option to skip is available but subordinate.
5. **Given** days that carry differing amounts of work, **When** the user views the calendar, **Then** the relative load of each day is visible without opening it.

---

### User Story 6 - Reviewing a pull request starts by reading it (Priority: P3)

A person triaging pull requests sees, in one line, how many wait on them and how much reading that is, then a queue in which each row states its risk once, in words, and whose action opens the diff.

**Why this priority**: The queue is the extension's core loop and the risk encoding is genuinely unreadable, but the current screen is usable; the approve-without-reading affordance is the part that matters most and is a small change.

**Independent Test**: Open Code Reviews with a populated queue. Confirm risk appears once per row in words, that the primary row action opens the diff, and that summary counts state a real number.

**Acceptance Scenarios**:

1. **Given** a populated queue, **When** the user opens Code Reviews, **Then** the summary states how many pull requests await them and the estimated total reading time, without a row of tiles whose values are zero.
2. **Given** any queue row, **When** the user reads it, **Then** its risk is stated once in words that need no legend.
3. **Given** any queue row, **When** the user activates its primary action, **Then** the pull request's diff opens.
4. **Given** any queue row, **When** the user looks for a way to approve without reading, **Then** it is present only in that row's overflow menu and looks the same on every row.
5. **Given** a queue longer than one screen, **When** the user reaches the end, **Then** the count shown in the summary is the true count.
6. **Given** a changed file in the git panel, **When** the user reads its status, **Then** the status is stated in a word rather than a version-control status code.
7. **Given** the git panel's commit controls when committing is not currently possible, **When** the user looks at them, **Then** exactly one action is presented as primary and the reason it is unavailable is stated.

---

### User Story 7 - One house style, enforced (Priority: P4)

Every extension writes labels, buttons and empty states the same way, in the product's language rather than the implementation's, and the rules are enforced automatically rather than remembered.

**Why this priority**: Real but cosmetic, and cheapest last — Stories 2 through 6 rewrite much of the text this would otherwise sweep twice.

**Independent Test**: Review every extension surface against the written rules. Introduce a user-facing string containing an implementation term and confirm the build rejects it.

**Acceptance Scenarios**:

1. **Given** the written style rules, **When** any extension surface is reviewed, **Then** section labels, button labels and empty states follow them.
2. **Given** a user-facing string containing a forbidden implementation term, **When** the project's checks run, **Then** they fail and name the offending string.
3. **Given** any empty state in any extension, **When** it is shown, **Then** it carries a heading, an explanation and at least one action.

---

### User Story 8 - Both themes verified, not assumed (Priority: P4)

Every extension surface is legible in light mode and dark mode, and that is proven by a check that renders rather than by inspection.

**Why this priority**: Light mode is currently unverified rather than known-broken, so this protects a shipped promise; it runs last because the earlier stories delete much of the CSS involved.

**Independent Test**: Render every extension surface in both themes and measure text contrast and computed background colour.

**Acceptance Scenarios**:

1. **Given** any extension surface, **When** it is rendered in light mode, **Then** all text meets the project's contrast requirement against its actual composited background.
2. **Given** any extension surface, **When** it is rendered in dark mode, **Then** the same holds.
3. **Given** a colour value in extension styling for which a published token exists, **When** the styling is reviewed, **Then** the token is used rather than a literal.

---

### Edge Cases

- A dialog is open inside an extension when the extension is closed by another route (the sidebar toggle, a shortcut, the window closing). The dialog must not survive, leak a scrim, or leave focus stranded.
- Two surfaces stack — a date picker opened from inside a task detail panel, a confirmation opened from inside a settings dialog. The inner surface must sit above the outer, and Escape must close only the innermost.
- A toast arrives while a modal is open. It must remain visible and must not steal focus from the modal.
- A dialog is opened inside a pop-out window rather than the docked panel. All behaviours must hold in both.
- Remote Control's tunnel drops while devices are connected; the view must move to a named failure state rather than continuing to display a dead address.
- Remote Control is turned on with no credential supplied — the local address is available but the public one is not, and the view must distinguish those.
- The Remote Control view is on screen while the window is being shared or screenshotted; nothing that grants access may be legible without a deliberate reveal.
- A SpecKit card carries no brief at all, or a brief that is entirely headings with no prose.
- A SpecKit board is opened at a narrow window width where no column fits at its minimum.
- Task Vault's calendar is asked to show load for a month with no entries at all.
- The Code Reviews queue cannot reach the review host, so counts and risk are unavailable; rows must degrade to something readable rather than showing zeros presented as facts.
- A person using only a keyboard, and a person using a screen reader, must be able to complete every acceptance scenario above.
- A person with reduced-motion preferences set must not receive scrim or dialog animation.

## Requirements _(mandatory)_

### Functional Requirements

**The shared UI layer**

- **FR-001**: Dialog, confirmation, toast and empty-state primitives MUST exist as a single implementation used by the core application and published outward through the extension contract, so that both the core app and every extension obtain them rather than build them.
- **FR-002**: Every surface obtained from those primitives MUST close on Escape, trap keyboard focus while open, return focus to the invoking control on close, expose a dialog role and modal state to assistive technology, render a scrim over the content behind it, and dismiss on an outside click.
- **FR-002a**: Those surfaces MUST render within the extension's own view, so that the content they were opened from remains visible behind the scrim rather than being hidden while the surface is open. An extension MUST retain full control over what a dialog contains.
- **FR-003**: The contract MUST publish a named layer ordering for panels, overlays, modals and toasts, and extension styling MUST NOT declare its own stacking values.
- **FR-004**: The platform MUST track how many modal surfaces are currently open, including those opened inside an extension view, and that count MUST be readable by the gesture that exits an extension regardless of which view holds the surface.
- **FR-005**: The contract MUST publish an icon-control primitive that cannot be used without an accessible name.
- **FR-006**: The extension contract MUST remain backwards compatible: an extension written against the previous contract MUST continue to load and run.
- **FR-007**: All 19 existing modal and overlay surfaces across the five extensions MUST be migrated onto the primitives, and the superseded bespoke implementations MUST be removed.
- **FR-007a**: The core application's own existing modal and confirmation surfaces MUST be migrated onto the same primitives, so that no second implementation of them remains anywhere in the product.
- **FR-008**: No extension MAY retain a runtime import of core application source. Type-only imports of the published contract remain permitted.

**The Escape gesture**

- **FR-009**: The exit gesture MUST behave identically whether focus is in the host window or inside an extension view; the two surfaces MUST NOT be able to diverge in the conditions under which they suppress it.
- **FR-010**: That detector MUST NOT trigger an extension exit when focus is inside a text entry control, inside a terminal, or while any modal surface is open.
- **FR-011**: A single Escape MUST dismiss the innermost open surface and MUST NOT exit the extension.

**Remote Control**

- **FR-012**: The main view MUST state whether remote access is currently running.
- **FR-013**: While running, the view MUST show the reachable address with a copy action and a form scannable by a phone. The credential that protects access MUST be concealed by default, revealed only by an explicit action, and offered as a copy action; the scannable form MUST carry the credential so that scanning never requires revealing it on screen.
- **FR-014**: The view MUST state, in plain language, what a holder of the address and credential is able to do.
- **FR-015**: The view MUST list currently connected devices and allow each to be disconnected individually.
- **FR-016**: The view MUST offer a single prominent control to start and to stop remote access.
- **FR-017**: The view MUST present a named state for each way remote access can fail, each stating what happened and offering a way forward.
- **FR-018**: Settings MUST be ordered so that anything required for the feature to work at all precedes optional settings, and MUST NOT occupy the view's primary space.

**SpecKit Pilot**

- **FR-019**: A board card MUST identify its current phase by name and state the next step.
- **FR-020**: A board card MUST NOT display raw markup.
- **FR-021**: A board card MUST NOT display a label that duplicates its column, nor one whose value is identical on every card.
- **FR-022**: Every board column MUST be reachable, with an affordance indicating content beyond the viewport edge, and a minimum column width below which the board scrolls.
- **FR-023**: Cards MUST be named by one consistent rule across all columns.
- **FR-024**: When nothing is running, the supervision area MUST either offer the action that starts something or occupy no vertical space.
- **FR-025**: Closing a card detail view with unsaved edits MUST warn before discarding them.

**Task Vault**

- **FR-026**: A region with no content MUST present at most one empty state, carrying a heading, an explanation and at least one action.
- **FR-027**: A side rail MUST NOT duplicate what the adjacent main column already shows.
- **FR-028**: A dated view MUST give the date at least as much visual weight as the day name.
- **FR-029**: The Weekly Review MUST identify all of its steps and state the current position once.
- **FR-030**: On every Weekly Review step, the most prominent action MUST advance the review; skipping MUST remain available and subordinate.
- **FR-031**: The calendar MUST convey each day's relative load.

**Git Integration**

- **FR-032**: The review queue summary MUST state a true count and MUST NOT present a row of tiles whose values are zero.
- **FR-033**: Each queue row MUST state its risk once, in words requiring no legend.
- **FR-034**: The primary action on a queue row MUST open the pull request's diff.
- **FR-034a**: Approving from a queue row MUST remain available from that row's overflow menu, MUST NOT occupy the row's primary action slot, and MUST NOT vary in appearance with the row's risk.
- **FR-035**: Filter controls MUST NOT duplicate groupings the list already applies.
- **FR-036**: File status MUST be stated in words rather than version-control status codes.
- **FR-037**: The commit controls MUST present exactly one primary action, and when it is unavailable MUST state what would make it available.

**House style and theming**

- **FR-038**: A written style rule set MUST exist covering label case, button voice, empty-state shape and forbidden implementation vocabulary.
- **FR-039**: The project's automated checks MUST fail a user-facing string containing a forbidden implementation term, in the manner the existing rule for "project" already works.
- **FR-040**: Extension styling MUST use published tokens wherever one exists for the value.
- **FR-041**: Every extension surface MUST meet the project's text contrast requirement in both light and dark themes.

**Verification**

- **FR-042**: The Escape behaviour, the modal behaviours, and the theme contrast requirement MUST each be verified by tests that render and drive the running application, not by assertions against mocked collaborators or class names.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Typing into any field in any extension and pressing Escape twice never closes the extension and never discards the typed text — verified across all five extensions.
- **SC-002**: All 19 modal and overlay surfaces pass all five behaviour checks — closes on Escape, dialog role, modal state announced, focus managed, dismissible from outside — up from 6, 5, 3, 7 and 4 respectively.
- **SC-002a**: Exactly one implementation of each of dialog, confirmation, toast and empty state exists in the product, counting the core application and all five extensions together.
- **SC-003**: A person can complete every acceptance scenario in this specification using only a keyboard.
- **SC-004**: Deleting any extension directory leaves the core application building and running unmodified.
- **SC-005**: Extension styling declares zero stacking values of its own, down from 14 distinct values.
- **SC-006**: A person opening Remote Control can state, without navigating elsewhere, whether it is on, at what address, and how many devices are connected.
- **SC-007**: Every way Remote Control can fail produces a named on-screen state with a stated next step.
- **SC-008**: A person unfamiliar with the phase numbering can name the current phase of any SpecKit card from the card alone.
- **SC-009**: No extension surface displays raw markup, a version-control status code, or a label identical on every instance.
- **SC-010**: No region of any extension presents more than one statement of emptiness, and every empty state offers an action.
- **SC-011**: No queue row presents approval as its primary action, and an approval control's appearance is identical on every row regardless of risk.
- **SC-012**: Every extension surface meets the project's text contrast requirement in both themes, verified by measurement rather than inspection.
- **SC-013**: Introducing a user-facing string containing a forbidden implementation term fails the project's checks.
- **SC-014**: No more than 100px sits above the first card on the SpecKit board, and above the first pull request in the Code Reviews queue, at the default window size — down from approximately 250px on both, and matching the benchmark the sidebar already meets.

## Assumptions

- **Scope is the five bundled extensions plus the core application's own modal surfaces.** The shared primitives are built once and published outward, so the core migrates onto them as well (see Clarifications). Any third-party extension continues to work unchanged; the contract is extended additively and nothing is removed from it.
- **The four view redesigns preserve existing capability.** Nothing a person can do today is removed except where this specification says so explicitly (see the next assumption).
- **Approving a pull request from the queue row is retained, but demoted.** The audit's objection was to it being the row's default action, tinted by risk so that approving unread is most inviting on the rows where the habit is cheapest to form. It moves into the row's overflow menu and stops varying in appearance by risk. No capability is removed by this feature.
- **A scannable code for phones implies a new production dependency.** Constitution IV requires justification and an actively maintained package; selection is left to planning, and generating the code without a dependency is acceptable if practical.
- **The connected-device list updates as devices join and leave**, rather than only when the view is opened, since it is a security surface and a stale list is misleading about who currently has access.
- **"The project's contrast requirement" means WCAG AA**, consistent with the existing token documentation and contrast specs.
- **Delivery is phased by the priority order.** P1 alone is a shippable release that stops the data loss and fixes the behaviour matrix; each subsequent story is independently shippable.
- **Notepad's existing empty state and its two compliant overlays are the reference pattern** for FR-002 and FR-026 rather than a new design.
- **MergeFlow's conflict resolver and the PR review diff pane were audited from source only** — they need populated git state that was not set up. Both are in scope for the migration in FR-007, but neither has been reviewed visually, and planning should include a pass with a real conflict and a real pull request open.

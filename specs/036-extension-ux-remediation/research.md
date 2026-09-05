# Phase 0 Research: One UI Floor for Every Extension

**Feature**: `036-extension-ux-remediation` | **Date**: 2026-09-05

All unknowns from Technical Context are resolved below. Each decision is grounded in the
current codebase or in vendor documentation retrieved during this phase (Constitution I).

---

## R1. Where the shared primitives live

**Decision**: A new runtime workspace package, `packages/extension-ui`, holding the React
components and the layer scale. `packages/extension-sdk` stays types-only and re-exports the
new package's types. `packages/*` is added to the root `workspaces` array. Both the core
renderer and each extension declare `@terminator/extension-ui` as a dependency in their own
`package.json`.

**Rationale**:

- `packages/extension-sdk` exists but is **types-only** — its `package.json` declares only
  `types`, has no `main`, no build, and no runtime code. Shipping React components from it
  would change what that package is, and it is the published contract third parties install.
- Constitution II requires that "all npm packages an extension needs MUST be declared in that
  extension's own `package.json`", and forbids adding extension-only packages to the root
  manifest. A workspace package satisfies both: each extension declares it, npm workspaces
  hoist it, Vite resolves it.
- Root `workspaces` is currently `["extensions/*"]`, so `packages/*` must be added or the
  extensions cannot resolve the dependency locally.
- All five extensions pin `react@18.3.1` and none externalises React in its Vite config, so
  each bundles its own copy. Because a dialog renders inside its own extension's React tree
  (per the spec's clarification), no cross-bundle React identity is required. `react` and
  `react-dom` are declared as **peer** dependencies of `extension-ui`.

**Alternatives considered**:

- _Components injected through the preload bridge_ — rejected. `preload-webview.ts` exposes
  `window.electronAPI` via `contextBridge`, which serialises across the boundary. React
  components are functions and cannot cross it.
- _Extensions import from `src/renderer/`_ — rejected, this is the Principle II violation the
  feature exists to remove.
- _Add runtime code to `extension-sdk`_ — rejected; it changes the published types-only
  contract and would force a build step onto a package third parties consume for types alone.

---

## R2. How modal depth reaches the Escape detector

**Decision**: Depth is tracked per view — no IPC, no main-process round trip — but it does
cross the **context** boundary via the bridge `preload-webview.ts` already exposes. The
`extension-ui` registry reports each change to `window.electronAPI.ui.setModalDepth(n)`; the
preload holds the count in its own world, beside the listener that honours it.

**Rationale**:

- The spec's clarification puts dialogs inside the extension's own view, and the extension-side
  detector runs in that same view, so the count never needs to travel between processes.
- **Corrected during implementation.** This decision originally said the registry would publish
  the count on its own `window` and the preload would read it there. That is wrong: extension
  views are created with `contextIsolation: true` (`extension-view-host.ts:242`), so the
  preload's `window` is a different object from the page's and cannot see what the page writes.
  The first end-to-end run failed on exactly this. The bridge is the only route, and it is
  cheap — a synchronous call on an object the preload already exposes.
- The registry still publishes the count on the host object as well. That is what the core
  renderer and the unit tests read, where there is no bridge and no isolation.
- Avoiding IPC still matters: a synchronous keypress decision must not depend on an
  asynchronous round trip, or a dialog that opens and closes faster than the message travels
  leaves the count wrong and silently disables the exit gesture.

**Alternatives considered**:

- _Report depth to main over IPC, main gates the exit_ — rejected; asynchronous state for a
  synchronous decision.
- _Publish on the page's `window` and read it from the preload_ — **attempted and rejected**:
  impossible under context isolation, as the first e2e run demonstrated.

---

## R3. QR code generation (Constitution IV)

**Decision**: `qrcode.react`, pinned exact, declared in **`extensions/remote-control/package.json`
only**. Use the `QRCodeSVG` export.

**Rationale** (verified against vendor documentation this phase):

- Renders inline SVG — no `<canvas>`, no network fetch, no image loading unless
  `imageSettings` is supplied, which this feature does not use. Suits a sandboxed extension
  view with no outbound network.
- `fgColor` / `bgColor` accept any valid CSS colour, so the code takes the app's published
  theme tokens and works in both themes.
- Exposes a `title` prop explicitly for accessibility.
- Community health: High source reputation, benchmark 96.92, 281 documented snippets;
  maintained under `zpao`. It is the most widely used React QR component.
- Constitution II forbids putting an extension-only package in the root manifest, so it is
  declared in Remote Control's own manifest.
- A QR code is a data matrix, not an icon, so Principle XII (lucide-only) does not apply. This
  is recorded here so a reviewer does not read it as a violation.

**Alternatives considered**:

- _`node-qrcode`_ — rejected: Low source reputation in the registry lookup, and canvas-first.
- _`qrcode.js` (davidshimjs)_ — rejected: no React binding, DOM-table rendering, effectively
  unmaintained.
- _Hand-rolled_ — rejected under Constitution IV's stdlib test: QR encoding needs Reed–Solomon
  error correction; the standard library does not cover it and writing it is not justified.

---

## R4. Focus trapping

**Decision**: Hand-rolled inside `extension-ui`, roughly 40 lines: capture the previously
focused element, focus the first tabbable node on open, cycle Tab/Shift+Tab within the
dialog, restore focus on close.

**Rationale**: Constitution IV requires the standard library be used when it suffices and
forbids adding a dependency when it does. The behaviour is small, well understood, and needed
in exactly one component. ADR 027 already rejected `dnd-kit`/`react-dnd` on the same grounds —
"a new production dependency to replace ~20 lines of native HTML5 drag that already works" —
so this follows established precedent in this repository.

**Alternatives considered**: `focus-trap-react` — rejected; a production dependency for a
single component's worth of behaviour.

---

## R5. Verifying contrast in both themes (FR-041)

**Decision**: A rendering harness. Mount each extension surface in headless Chromium against
the real stylesheets, read `getComputedStyle` for text and its composited background, and
assert the WCAG AA ratio. The existing pure contrast maths is reused; the _source of colours_
changes.

**Rationale**:

- The existing specs (`design-tokens-contrast.spec.ts`, `diff-syntax-contrast.spec.ts`) read
  `styles.css` as **text** and parse hex literals out of it. That works for tokens declared as
  literals and cannot work for the extension surfaces, whose colours arrive through
  `color-mix()`, layered `rgba()` tints and composited scrims — jsdom does not compute
  `color-mix`, so a parsing approach silently passes.
- This is the same trap FR-042 exists to avoid: a test that asserts on source text rather than
  on what renders.

**Alternatives considered**:

- _Extend the existing text-parsing specs_ — rejected; cannot resolve `color-mix` or
  composited alpha, which is precisely where the 739 raw `rgba()` values live.
- _Manual review in both themes_ — rejected; not repeatable, and Constitution VI requires the
  requirement be pinned by a test.

---

## R6. Enforcing the vocabulary rules (FR-039)

**Decision**: Extend the existing ESLint `no-restricted-syntax` override in `.eslintrc.json`
to cover `extensions/*/src/**/*.tsx`, with the same three selectors already used for the word
"project" — JSX text, `label` properties, and `placeholder`/`title`/`aria-label` attributes.

**Rationale**: The mechanism already exists and is proven. The current override is scoped to
`src/renderer/components/**/*.tsx` only, which is exactly why extensions drifted. Widening the
`files` glob and adding the forbidden terms is a configuration change, not new tooling.

**Alternatives considered**: A custom ESLint plugin — rejected as premature; the built-in
selector syntax already expresses these rules.

---

## R7. Toasts

**Decision**: `extension-ui` owns the toast component and its queue. The core's existing
`toast.store.ts` (`useToastStore`, with `info | success | warning | error`) is migrated onto
it, keeping its current type vocabulary. Task Vault's `ExtensionToastContainer` is deleted.

**Rationale**: The core store already models exactly what is needed and is in use; the feature
is consolidating rather than redesigning. Keeping the four-tone vocabulary avoids a
gratuitous API change for core callers.

---

## R8. Liveness of the connected-device list (FR-015)

**Decision**: Push. The remote-control server already holds live websocket connections per
viewer; it emits a connect/disconnect event that the view subscribes to, with a full list
fetched once on mount as the baseline.

**Rationale**: The spec records that a stale list is misleading about who currently has shell
access. The server is authoritative and already knows, because it is the thing accepting and
closing those sockets — polling would add latency and a second source of truth for state it
already owns.

**Alternatives considered**: Interval polling — rejected; strictly worse than an event the
server can already raise.

---

## R9. Pre-existing Principle XII debt in the surfaces being touched

**Finding, not a decision.** Principle XII (NON-NEGOTIABLE) requires lucide icons sized by CSS
rather than the `size` prop, and forbids unicode characters as visual elements. Measured:

| Area            | `size={n}` occurrences |
| --------------- | ---------------------- |
| task-vault      | 120                    |
| speckit-pilot   | 38                     |
| notepad         | 25                     |
| git-integration | 2                      |
| remote-control  | 0                      |
| **core `src/`** | **2**                  |

Three git-integration files additionally use unicode characters as visual elements
(`CompletionScreen.tsx`, `ConflictHub.tsx`, `FullFileList.tsx`).

This is pre-existing and outside the spec's requirements, but the feature edits most of these
files. The plan's position: **do not perpetuate it** — any component this feature rewrites
adopts CSS-controlled sizing, and the remainder is recorded as follow-up rather than swept
silently, so the diff stays reviewable (Constitution V: every changed line traces to the
request).

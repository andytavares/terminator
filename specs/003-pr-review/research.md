# Research: UX Improvement PRD

**Branch**: `bugfix-various-small-issues` | **Date**: 2026-05-10  
**Source PRD**: `docs/ux-improvement-prd.md`

---

## 1. `:focus-visible` in Electron + xterm.js

**Decision**: Global `:focus-visible` rule in `styles.css`; xterm.js canvas is exempt via selector specificity.

**Rationale**:
The `:focus-visible` CSS pseudo-class is natively supported in all Chromium versions that ship in Electron 30+. It fires only for keyboard-initiated focus (Tab, arrow keys), not mouse clicks — making it safe to apply globally without adding unwanted rings to click-targeted elements.

xterm.js renders into a `<canvas>` element wrapped in a `.xterm` container div. The canvas does not receive DOM focus in the conventional sense; the `.xterm-helper-textarea` receives focus for keyboard capture. These elements are scoped to the `TerminalSession` component and will not match any component-level `:focus-visible` rules we add to sidebar/dialog elements. No collision exists.

No new dependency is needed — this is pure CSS.

**Alternatives considered**:

- `focus-trap-react` package: Overkill for global focus ring; relevant only for modal trapping.
- `what-input` polyfill: Unnecessary — `:focus-visible` is natively supported in the target Chromium runtime.

---

## 2. ConfirmDialog Component

**Decision**: Build a project-local `ConfirmDialog` React component reusing existing `Dialog.css` + `dialog-in` keyframe. No new library.

**Rationale**:
`Dialog.css` already contains `.dialog`, `.dialog__title`, `.dialog__actions`, `.dialog__btn-primary`, `.dialog__btn-secondary`, and a `dialog-in` entrance animation. A `ConfirmDialog` is a thin wrapper that accepts `{ title, description, confirmLabel, danger, onConfirm, onClose }` props and renders this existing markup pattern.

The `--danger` CSS token is already defined (`#E05C5C`). The `onConfirm` callback is invoked on button click; focus is trapped inside the dialog using a simple `useEffect` + `ref.focus()` approach (first focusable child auto-focused, Escape closes).

No new packages. Zero dependency cost.

**Alternatives considered**:

- `@radix-ui/react-alert-dialog`: 30k+ stars, accessible. Rejected because the constitution (§IV) requires std-lib preference and the existing Dialog infrastructure fully covers the need.
- Electron native dialog (`dialog.showMessageBox`): Rejected — renders off-thread, not styleable, inconsistent with in-app UX.

---

## 3. CSS Token Namespace Unification

**Decision**: Add a `--tm-*` alias layer in `styles.css` that maps every core token to a canonical extension-facing name. Migrate git-integration CSS to use `--tm-*`. Deprecate `--color-*` fallbacks in the extension.

**Rationale**:
The core app already has a working dark-mode token set (`--bg-*`, `--text-*`, `--border-*`). The git-integration extension was written with its own `--color-*` namespace because no published contract existed. The cleanest migration is an alias layer — no renames of core variables (to avoid breaking other consumers), new `--tm-*` names become the stable public API:

```css
/* styles.css — published contract for extensions */
:root {
  --tm-bg-base: var(--bg-base);
  --tm-bg-surface: var(--bg-surface);
  --tm-bg-elevated: var(--bg-elevated);
  --tm-bg-card: var(--bg-card);
  --tm-text-primary: var(--text-primary);
  --tm-text-secondary: var(--text-secondary);
  --tm-text-muted: var(--text-muted);
  --tm-border: var(--border);
  --tm-border-strong: var(--border-strong);
  --tm-accent: var(--accent);
  --tm-accent-dim: var(--accent-dim);
  --tm-danger: var(--danger);
  --tm-success: #4ade80;
  --tm-warning: #facc15;
  --tm-radius-sm: var(--radius-sm);
  --tm-radius-md: var(--radius-md);
  --tm-radius-lg: var(--radius-lg);
  --tm-font-mono: var(--font-mono);
  --tm-font-ui: var(--font-ui);
}
```

The git-integration CSS then replaces `var(--color-bg, #1a1a1a)` with `var(--tm-bg-surface)`, etc. The fallback hex values are removed; the extension relies on the host injecting tokens.

This change also formalizes the token contract in `docs/EXTENSION-DEVELOPMENT.md`.

**Alternatives considered**:

- Rename core variables to `--tm-*` directly: Too disruptive; breaks all existing CSS in the core app.
- Keep dual namespaces, do a mapping in extension CSS: Same as chosen approach but without the alias layer in the host — extension would lose any future token changes unless manually updated.

---

## 4. Font: IBM Plex Sans for UI Chrome

**Decision**: Add `IBM Plex Sans` (weights 400, 500, 600) as `--font-ui`. Source via self-hosted font files or @import from Google Fonts CDN (network-permitting in Electron).

**Rationale**:
IBM Plex Sans is the proportional companion typeface to IBM Plex Mono, both published by IBM under OFL license. Using Plex Sans for sidebar/dialog chrome and Plex Mono for code/terminal content is the intended pairing from the type foundry. The visual rhythm is coherent because metrics (x-height, optical sizing) are harmonized across the family.

For Electron (offline-capable desktop app), self-hosted fonts are preferred. The `@fontsource/ibm-plex-sans` npm package (5k+ GitHub stars, maintained by `fontsource` org with 10+ contributors, published on npm) provides self-hosted font files importable as CSS. This avoids a network dependency.

```
npm install @fontsource/ibm-plex-sans
```

Import in `renderer/index.tsx`:

```ts
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
```

Then in `styles.css`:

```css
--font-ui: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Alternatives considered**:

- System font stack only (`-apple-system, BlinkMacSystemFont`): Acceptable fallback but loses cross-platform visual consistency.
- Inter: Generic, overused in developer tools — PRD explicitly calls out avoiding Inter.
- Google Fonts CDN import: Rejected — Electron apps may run offline; network font dependency is fragile.

---

## 5. Skeleton Loading (No New Library)

**Decision**: Pure CSS shimmer animation using `@keyframes` + `background: linear-gradient`. No new library.

**Rationale**:
Skeleton UIs are implementable with ~15 lines of CSS: a base `background-color` on the placeholder element, an animated gradient overlay for the shimmer effect, and `animation: shimmer 1.5s infinite`. This is entirely sufficient for the 3–4 affected surfaces (git sidebar, branch switcher, PR queue, settings).

No library is needed; this falls squarely in the "standard library covers the need" category per constitution §IV.

```css
.skeleton {
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  position: relative;
  overflow: hidden;
}
.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.06) 50%,
    transparent 100%
  );
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
```

**Alternatives considered**:

- `react-loading-skeleton`: Popular (8k stars), but adds a dependency for ~3 CSS rules. Rejected per constitution §IV.

---

## 6. Command Palette (P3 — Deferred)

**Decision**: Use `cmdk` when this P3 item is implemented. Deferred from current scope.

**Rationale** (for future reference):
`cmdk` (28k+ GitHub stars, maintained by Radix/Vercel team, 10+ contributors, actively released) is the canonical headless command menu primitive for React. It integrates with Zustand stores directly — the data layer (projects, workspaces, registered actions) feeds into `cmdk`'s Command component as items. The component is unstyled by default, making it fully compatible with the existing CSS token system.

```
npm install cmdk   # when P3 is scheduled
```

This item is excluded from the current implementation scope and should be planned as a separate task batch.

---

## 7. Resizable Panels (P3 — Deferred)

**Decision**: Use `react-resizable-panels` when P3 is implemented.

**Rationale** (for future reference):
`react-resizable-panels` (6k+ stars, Bryan Vaughn, active maintenance, no dependencies) provides accessible resize handles for panel-based layouts. It works natively with flexbox and CSS, requiring no wrapper DOM restructuring.

For now, the panel width (248px) is a fixed CSS variable. Persisting the user-set width can be done via `settings.store`.

---

## 8. Summary of Dependencies Required for Current Scope (P0–P2)

| Package                     | Purpose             | New?    |
| --------------------------- | ------------------- | ------- |
| `@fontsource/ibm-plex-sans` | Self-hosted UI font | **NEW** |

All other P0–P2 changes are pure CSS and React refactors — no new packages needed.

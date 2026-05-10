# Contract: Extension CSS Token API

**Version**: 1.0  
**Date**: 2026-05-10  
**Status**: Proposed

---

## Overview

This document defines the canonical CSS custom property (variable) contract that the Terminator host application guarantees to inject into the document for use by all extensions. Extensions MUST use only `--tm-*` tokens in their CSS. Using core-internal tokens (`--bg-*`, `--text-*`, `--border-*`) or hardcoded hex values is a contract violation.

---

## Guaranteed Tokens

The host guarantees these tokens are set on `:root` before any extension CSS is applied:

### Surface Backgrounds

| Token                | Default Value | Usage                          |
| -------------------- | ------------- | ------------------------------ |
| `--tm-bg-base`       | `#0C0C0F`     | Deepest application background |
| `--tm-bg-surface`    | `#111116`     | Panel and sidebar backgrounds  |
| `--tm-bg-elevated`   | `#18181F`     | Modals, dropdowns, tooltips    |
| `--tm-bg-card`       | `#1C1C25`     | Card and list item backgrounds |
| `--tm-bg-card-hover` | `#22222E`     | Hovered card/list backgrounds  |
| `--tm-bg-input`      | `#16161C`     | Form input backgrounds         |

### Text

| Token                 | Default Value | Usage                         |
| --------------------- | ------------- | ----------------------------- |
| `--tm-text-primary`   | `#E2E2EE`     | Primary readable text         |
| `--tm-text-secondary` | `#7070A0`     | Secondary / metadata text     |
| `--tm-text-muted`     | `#3A3A5A`     | Hints, placeholders, disabled |

### Borders

| Token                | Default Value            | Usage                 |
| -------------------- | ------------------------ | --------------------- |
| `--tm-border`        | `rgba(255,255,255,0.06)` | Subtle separators     |
| `--tm-border-strong` | `rgba(255,255,255,0.12)` | High-contrast borders |

### Semantic Colors

| Token              | Default Value           | Usage                                     |
| ------------------ | ----------------------- | ----------------------------------------- |
| `--tm-accent`      | `#5C6BC0`               | Primary accent — overridden per-workspace |
| `--tm-accent-dim`  | `rgba(92,107,192,0.18)` | Tinted accent background                  |
| `--tm-accent-glow` | `rgba(92,107,192,0.35)` | Glow effects                              |
| `--tm-danger`      | `#E05C5C`               | Error / destructive actions               |
| `--tm-success`     | `#4ade80`               | Success states                            |
| `--tm-warning`     | `#facc15`               | Warning states                            |

### Spacing / Shape

| Token            | Default Value | Usage                                 |
| ---------------- | ------------- | ------------------------------------- |
| `--tm-radius-sm` | `6px`         | Small radius (buttons, inputs, chips) |
| `--tm-radius-md` | `10px`        | Medium radius (cards, tiles)          |
| `--tm-radius-lg` | `16px`        | Large radius (modals, panels)         |

### Typography

| Token            | Usage                                              |
| ---------------- | -------------------------------------------------- |
| `--tm-font-ui`   | IBM Plex Sans — sidebar chrome, labels, dialogs    |
| `--tm-font-mono` | IBM Plex Mono — terminals, code, file paths, diffs |

---

## Migration from `--color-*`

Extensions previously used `--color-*` variables with hardcoded fallbacks. The following migration table is definitive:

| Deprecated                           | Use instead              |
| ------------------------------------ | ------------------------ |
| `var(--color-bg, #161b22)`           | `var(--tm-bg-surface)`   |
| `var(--color-bg-secondary, #1a1a1a)` | `var(--tm-bg-base)`      |
| `var(--color-text, #e6edf3)`         | `var(--tm-text-primary)` |
| `var(--color-text-muted, #8b949e)`   | `var(--tm-text-muted)`   |
| `var(--color-border, #333)`          | `var(--tm-border)`       |
| `var(--color-accent, #58a6ff)`       | `var(--tm-accent)`       |

Hardcoded hex values (e.g., `#98c379`, `#e06c75`, `#d19a66`) that approximate semantic colors should migrate to `--tm-success`, `--tm-danger`, `--tm-warning` respectively.

---

## Enforcement

1. Extensions submitted for inclusion in the official extension registry MUST pass a CSS audit verifying no `--color-*` or hardcoded hex color values in their CSS.
2. The `docs/EXTENSION-DEVELOPMENT.md` MUST document this contract and include the table above.
3. Any new token added to this contract requires a MINOR version bump to this document and a corresponding entry in `EXTENSION-DEVELOPMENT.md`.

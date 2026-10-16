# ADR 116: Extensions can add a home section

**Status**: Accepted

**Date**: 2026-10-16

**Relates to**: [ADR 033](033-one-app-band.md), [ADR 114](114-extension-views-are-frames-in-the-window.md)

## Context

Home is the launch view: every session, where it lives, what it is for. An extension with something to say before the user picks a session — open pull requests, today's captures — had no surface for it. The existing contribution points all replace or flank the terminal (`globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`, ADR 033); none lives on Home itself, and an extension cannot register a surface except through `contributes`.

## Decision

A manifest may declare `contributes.homeSection: { label, view? }` (default view `home`). Home renders one `<section aria-label={label}>` per registration at the top of the scrolling `home__body`, above the sessions list, so the user scrolls past it. The section is the extension's view in a frame ([ADR 114](114-extension-views-are-frames-in-the-window.md)) whose height follows its content.

That height follows a new mode of the frame shim. `ExtensionPanelPortal` takes `fitContent`: the frame's src gains `fit=content`, and the shim, seeing that param, observes `document.documentElement` with a `ResizeObserver` and posts `{ type: 'terminator:frame-height', height }` to `window.parent` at the embedding origin (read from `document.referrer`, never `*`). The portal sets its wrapper to the last reported height, accepting only messages whose `source` is its own frame's `contentWindow`. A window message rather than the frame's MessagePort: the port speaks to main, and the height is a layout fact the renderer needs directly — relaying it through main's FrameBridge would add a hop for a value only the portal consumes.

## Consequences

- A home section mounts its frame whenever Home shows; an extension whose section is heavy pays that on every Home visit.
- The section never pushes Home's own states off the screen: it scrolls with them.
- A frame that posts no height (an old build of the shim, a page that errors) renders zero pixels tall — invisible rather than a wrong-sized hole.
- `terminator:frame-height` is a second window-message type between host and frame, beside `terminator:frame-port`; both authenticate by source, not origin string.
- Home exists only in the desktop app, so a section's channels are local-only: `github:contributions` is deliberately not in `REMOTE_READ_CHANNELS` (`extensions/git-integration/src/remote-access.ts`).

# ADR 116: Extensions can add a home section

**Status**: Accepted. Superseded in part by [ADR 117](117-extensions-send-home-data-core-draws-it.md): sections now render on Home's Insights view, under `contributes.insightsSection`.

**Date**: 2026-10-16

**Relates to**: [ADR 033](033-one-app-band.md), [ADR 114](114-extension-views-are-frames-in-the-window.md)

## Context

Home is the launch view: every session, where it lives, what it is for. An extension with something to say before the user picks a session — open pull requests, today's captures — had no surface for it. The existing contribution points all replace or flank the terminal (`globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`, ADR 033); none lives on Home itself, and an extension cannot register a surface except through `contributes`.

## Decision

A manifest may declare `contributes.homeSection: { label, view? }` (default view `home`). Home renders one `<section aria-label={label}>` per registration at the top of the scrolling `home__body`, above the sessions list, so the user scrolls past it. The section is the extension's view in a frame ([ADR 114](114-extension-views-are-frames-in-the-window.md)) whose height follows its content.

That height follows a new mode of the frame shim. `ExtensionPanelPortal` takes `fitContent`: the frame's src gains `fit=content`, and the shim, seeing that param, observes `document.documentElement` with a `ResizeObserver` and posts `{ type: 'terminator:frame-height', height }` to `window.parent` at the embedding origin (read from `document.referrer`; `*` when there is none, as in a packaged app, whose page is `file://` and has no origin to name). The shim also sets the page's `html` and `body` to `height: auto` and reports `getBoundingClientRect().height`: the base CSS makes both 100% of the frame, which starts 0px tall, so the page would never outgrow it, and `scrollHeight` never reports less than the frame, so a section that empties would never shrink. The portal sets its wrapper to the last reported height, accepting only messages whose `source` is its own frame's `contentWindow`. The page's first report is its empty layout, before the extension has drawn (Git Integration's is 0px while it reads its setting, then 425px), so the section would push the sessions under it down after Home showed them, and a click aimed at the Ledger would land on the section. Two rules stop that, in `fit-content-height.ts`. The frame starts at the height it settled on last time, kept in `localStorage` under `terminator.frame-height.<extension id>.<view>`, and only follows the page once the page reports a height above 0 or 1 second passes. Home keeps everything below its sections at `visibility: hidden` until each section either has a remembered height or has settled, so a first launch holds the Ledger back for the time the section takes to draw (about 40ms on a laptop). The sections themselves stay visible, because Chromium stops rendering a hidden frame and it would never report a height. A window message rather than the frame's MessagePort: the port speaks to main, and the height is a layout fact the renderer needs directly — relaying it through main's FrameBridge would add a hop for a value only the portal consumes.

## Consequences

- A home section mounts its frame whenever Home shows; an extension whose section is heavy pays that on every Home visit.
- The section never pushes Home's own states off the screen: it scrolls with them.
- A frame that posts no height (an old build of the shim, a page that errors) renders zero pixels tall — invisible rather than a wrong-sized hole.
- `terminator:frame-height` is a second window-message type between host and frame, beside `terminator:frame-port`; both authenticate by source, not origin string.
- Home exists only in the desktop app, so a section's channels are local-only: `github:contributions` is deliberately not in `REMOTE_READ_CHANNELS` (`extensions/git-integration/src/remote-access.ts`).

# ADR 116: Extensions can add a home section

**Status**: Accepted. Superseded in part by [ADR 117](117-extensions-send-home-data-core-draws-it.md): sections now render on Home's Insights view, under `contributes.insightsSection`.

**Date**: 2026-10-16

**Relates to**: [ADR 033](033-one-app-band.md), [ADR 114](114-extension-views-are-frames-in-the-window.md)

## Context

Home is the launch view: every session, where it lives, what it is for. An extension can have something to say before the user picks a session, such as open pull requests or today's captures. It had no surface for this. The existing contribution points all replace or flank the terminal (`globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`, ADR 033). None lives on Home itself. An extension can register a surface only through `contributes`.

## Decision

A manifest can declare `contributes.homeSection: { label, view? }` (default view `home`). Home renders one `<section aria-label={label}>` per registration. The sections sit at the top of the scrolling `home__body`, above the sessions list, so the user scrolls past them. The section is the view of the extension in a frame ([ADR 114](114-extension-views-are-frames-in-the-window.md)). The height of the frame follows its content.

A new mode of the frame shim makes the height follow the content. `ExtensionPanelPortal` takes `fitContent`, and the src of the frame gains `fit=content`. When the shim sees that param, it observes `document.documentElement` with a `ResizeObserver`. It posts `{ type: 'terminator:frame-height', height }` to `window.parent` at the embedding origin. The shim reads the origin from `document.referrer`. It uses `*` when there is no referrer, as in a packaged app, whose page is `file://` and has no origin to name.

The shim also sets the `html` and `body` of the page to `height: auto`, and reports `getBoundingClientRect().height`. The base CSS makes both 100% of the frame, and the frame starts 0px tall. So the page would never outgrow the frame. `scrollHeight` never reports less than the frame, so a section that empties would never shrink. The portal sets its wrapper to the last reported height. It accepts only messages whose `source` is the `contentWindow` of its own frame.

The first report of the page is its empty layout, before the extension has drawn. For Git Integration, the first report is 0px while it reads its setting, and then 425px. So the section would push the sessions under it down after Home showed them, and a click aimed at the Ledger would land on the section. Two rules in `fit-content-height.ts` stop that:

- The frame starts at the height it settled on last time. The app keeps that height in `localStorage` under `terminator.frame-height.<extension id>.<view>`. The frame follows the page only once the page reports a height above 0, or 1 second passes.
- Home keeps everything below its sections at `visibility: hidden` until each section has a remembered height or has settled. So a first launch holds the Ledger back for the time the section takes to draw (about 40ms on a laptop). The sections themselves stay visible, because Chromium stops rendering a hidden frame, and the frame would never report a height.

The height travels as a window message, not on the `MessagePort` of the frame. The port speaks to main. The height is a layout fact that the renderer needs directly. Relaying it through the FrameBridge of main would add a hop for a value that only the portal uses.

## Consequences

- A home section mounts its frame whenever Home shows. An extension with a heavy section pays that cost on every Home visit.
- The section never pushes the own states of Home off the screen. It scrolls with them.
- A frame that posts no height (an old build of the shim, a page that errors) renders zero pixels tall. It is invisible, not a hole of the wrong size.
- `terminator:frame-height` is a second window-message type between host and frame, beside `terminator:frame-port`. Both authenticate by source, not by origin string.
- Home exists only in the desktop app, so the channels of a section are local-only: `github:contributions` is deliberately not in `REMOTE_READ_CHANNELS` (`extensions/git-integration/src/remote-access.ts`).

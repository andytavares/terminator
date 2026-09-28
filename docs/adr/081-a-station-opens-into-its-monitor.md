# ADR 081: A station opens into its monitor

**Status**: Accepted

**Date**: 2026-09-28

Amends ADR 079 (a station shows its own work).

## Context

Clicking a station in the factory hall opened `.fdry-hall-inspector`, a flat
dark side panel that read as app chrome laid over a pixel-art scene. It read
the agent's transcript once, when it opened, and never again, so a working
agent's panel stayed frozen until it was closed and reopened.

## Decision

- A station opens into `StationMonitor`, a beige CRT drawn as pixel art.
  - The case is painted on a canvas by `drawMonitorCase`, at the panel's size
    divided by 3, or by 2 in a hall narrower than 260px. The bevels are always
    one art pixel wide and never stretch.
  - The screen is ordinary HTML text in green phosphor, with scanlines and
    glass, so it stays selectable and readable by assistive tech.
- The screen font is VT323, vendored at
  `extensions/foundry/assets/VT323-Regular.woff2` with its SIL Open Font
  License (`assets/OFL.txt`). It is declared once in `foundry.css` and falls
  back to `--tm-font-mono`. It is an asset, not an npm dependency.
- While a station is open, its transcript is re-read every `ACTIVITY_POLL_MS`
  with a limit of 40 lines. The log sticks to the bottom unless you have
  scrolled up.
- `TranscriptLine` gains `kind: 'text' | 'tool'`, one line per content block.
  - The monitor draws tool calls dim with a `>` prompt, the agent's words
    bright, and your messages with a `$` prompt.
  - The Floor folds the lines back into one row per message.
- The power LED and the alert line use the same inputs as the station lamp.
  The LED is green while working, blinking amber while it needs you, and red
  once it has failed. When there is no agent, the LED is off and the screen
  reads NO CARRIER.
- The tube powers on when a station opens and collapses when it closes. None
  of the motion runs under `prefers-reduced-motion`.

## Consequences

- The transcript `limit` now counts content blocks, not messages, so a limit
  of 40 covers fewer messages than it did.
- The monitor is read-only. Attach is still the way into the agent's terminal.

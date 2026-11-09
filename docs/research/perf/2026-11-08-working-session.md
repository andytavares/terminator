# Memory and idle CPU in a working session (2026-11-08)

The goal was to cut the physical footprint and the idle CPU of the app by 70%, on Electron and with the current process model. This note records one measurement before and one after, the changes, and what is left.

## Method

`node scripts/perf/app-metrics.mjs --scenario=working-session --runs=3` on a Mac (Darwin 27, Apple silicon, window 1280×768 at 2×), against the output of `npm run build`. Each run starts the app on a fresh profile and builds a working session:

- 4 terminal tabs opened through the MCP tool `open_terminal`, each printing `ls -la /usr/bin | head -200; seq 1 2000`.
- 1 agent tab on the e2e stub agent (`tests/e2e/fixtures/acp-stub-agent.mjs`, seeded as `claude`), opened with `start_agent`.
- 2 MCP relays held open: the `mcp-relay.cjs` the app writes, started as Claude Code starts it.
- Every bundled extension on.

`--view=overview` shows the Overview for the sample; without it the tab opened last stays on screen. After a 9 s settle and an idle wait, the script samples for 60 s: `footprint -p <pid>` every 5 s (averaged) and CPU time from `ps` at the start and end (mean %). The figures are medians of 3 runs. In every run the window had focus (`focusedRuns: 3`).

"Other child" is the 4 login shells (`/bin/zsh -l`, about 6 MB each). Raw output: [`2026-11-08-working-session-before.json`](2026-11-08-working-session-before.json) and [`2026-11-08-working-session-after.json`](2026-11-08-working-session-after.json) (terminal view). The Overview runs are in the tables only.

## Before and after

The after build had both changes below; the snapshot tiles were then removed because they saved nothing. Footprint in MB, CPU in % of one core, medians of 3 runs:

| Process        | Terminal view before |   after | Overview before |   after |
| -------------- | -------------------: | ------: | --------------: | ------: |
| GPU            |                  673 |     663 |             225 |     223 |
| Renderer (Tab) |                   96 |      97 |              99 |      98 |
| Main (Browser) |                   87 |      87 |              88 |      88 |
| Extension Host |                   39 |      40 |              40 |      39 |
| Agent (stub)   |                   31 |      31 |              31 |      32 |
| MCP relays (2) |                   26 |      26 |              26 |      26 |
| Shells (4)     |                   24 |      25 |              24 |      24 |
| Other utility  |                    8 |       8 |               8 |       8 |
| **Total**      |              **985** | **975** |         **541** | **540** |
| **CPU total**  |              **2.2** | **1.7** |         **1.6** | **2.1** |

The differences are within run-to-run noise: no change moved the footprint, and idle CPU is already about 2% of one core with the window focused.

## Changes

- **Overview tiles as text snapshots (removed).** A tile showed `readVisibleRows()` as text every 2 s instead of the live xterm element. The Overview went from 541 to 540 MB: live tiles already use xterm's DOM renderer and no WebGL context, so there was nothing to save. The change was removed.
- **Animations pause while the window is hidden or out of focus.** `installAnimationPause` (`packages/core-renderer/src/lib/pause-animations.ts`) sets `data-window-idle` on the root; one rule in `styles.css` pauses every animation under it. The scenario keeps the window focused, so the table does not show this change.
- **WebGL release on a tab switch** was already covered by two unit specs: `TerminalPane.spec.tsx` (the hidden tab's instance is unmounted) and `TerminalSession.spec.tsx` ("releases the WebGL context when the terminal is hidden"). No spec was added.

## Where the GPU footprint comes from

A one-off probe (the scenario's launch code, `footprint -p <gpu pid>` 8 s after each step) shows the cause. It is not growth over time: the first terminal on screen costs it at once.

| Step                    | GPU footprint | "Owned physical footprint (unmapped) (graphics)" | IOSurface |
| ----------------------- | ------------: | -----------------------------------------------: | --------: |
| Home, nothing open      |         51 MB |                                             6 MB |     16 MB |
| 1 terminal on screen    |        568 MB |                                           451 MB |     72 MB |
| Overview (before build) |         71 MB |                                            12 MB |     22 MB |

With WebGL refused in the page (`HTMLCanvasElement.prototype.getContext` returns `null` for `webgl*`, so xterm uses its DOM renderer), 1 terminal on screen costs 309 MB, of which 236 MB is the same graphics category. `--electron-arg=--disable-webgl` does not reach Chromium in this harness: `getContext('webgl2')` still succeeds.

So a terminal on screen holds about 450 MB of GPU memory with the WebGL renderer and about 235 MB with the DOM renderer, at this window size. The memory is freed as soon as no terminal is on screen. Each further terminal tab adds about 40 MB of IOSurface while it lives, even when hidden. The 636 MB seen in the installed app after 5 h matches this fixed cost, not a leak.

## Relay

`footprint` of one idle relay holding a socket open, 3 runs, identical each time:

| Relay                                                | Footprint |
| ---------------------------------------------------- | --------: |
| Electron as node (`mcp-relay.cjs`, today)            |     13 MB |
| `/bin/sh` + `cat` + `/usr/bin/nc -U` (hello in `sh`) |    4.6 MB |

The `sh` relay is three processes (`sh` 1.6 MB, `cat` 1.3 MB, `nc` 1.7 MB). The server received the same hello line from both.

## What is left

The total fell by 1% (985 → 975 MB in the terminal view), against a target of 70%. The gap is about 680 MB.

- **GPU, 663 MB, two thirds of the total.** About 450 MB is the fixed cost of a terminal on screen with the WebGL renderer. The DOM renderer halves it (about 235 MB) but costs CPU on heavy output; it was not changed here. The next step is to find which allocation in xterm's WebGL renderer (texture atlas pages, or Chromium's buffers for the canvas) holds the 450 MB, for example with Instruments' Metal allocations, and to cap it.
- **Hidden terminal tabs**: about 40 MB of IOSurface each in the GPU process while they live.
- **Relays**: the `sh` + `nc` relay saves about 8 MB per relay (16 MB for this scenario). It needs a change in `relay-script.ts` and `registration.ts`, and `nc -U` must end the session when stdin closes, which was not tested.
- **Renderer, main, extension host, agent and shells**: about 300 MB together, unchanged. The 2026-10-12 note covers the host.

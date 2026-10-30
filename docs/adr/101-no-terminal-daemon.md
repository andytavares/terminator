# ADR-101: No Native Terminal Daemon

**Status**: Accepted
**Date**: 2026-10-12

## Decision

Terminals stay in the Electron main process (ADR-001). ADR-093 held back a native Rust daemon "only if measurements taken after that work still show a need". The team does not build the daemon, because the measurements below show no need.

## Context

ADR-093 kept Electron and TypeScript and fixed the measured costs in that stack:

- `node:sqlite` replaced PGlite (ADR-099).
- The app creates the window first.
- Extension backends moved to the extension host (ADR-094).
- The app batches terminal output.

ADR-093 made a terminal daemon conditional on measuring again afterwards.

The measurements ran with `scripts/perf/app-metrics.mjs --runs=5 --throughput --electron-arg=--no-sandbox` under `xvfb-run -a`. They ran on the same Linux x86_64 machine (4 CPUs), one build after the other: `main` at `92b7ad9` and this branch. The values are medians of five runs. Each run uses a fresh profile. Raw output: [`docs/research/perf/2026-10-12-main.json`](../research/perf/2026-10-12-main.json) and [`2026-10-12-head.json`](../research/perf/2026-10-12-head.json).

| Measure                                     | `main` | After ADR-093's work | Change  |
| ------------------------------------------- | -----: | -------------------: | ------- |
| Launch to window (ms)                       |  3,373 |                  490 | −85%    |
| Launch to sidebar drawn (ms)                |  4,246 |                  706 | −83%    |
| Memory after settling, all processes (MB)   |    743 |                  640 | −103 MB |
| — main process (`Browser`)                  |    401 |                  179 | −222 MB |
| — utility processes (extension host)        |     79 |                  203 | +124 MB |
| 50 MB through the terminal, drawn (ms)      |  2,710 |                2,625 | −3%     |
| 50 MB through the terminal, shell done (ms) |  1,679 |                2,614 | +56%    |

Read the last two rows together. On `main` the shell finished a second before the screen did. Now the screen keeps up with the shell. The output path pauses the PTY while the renderer is behind (`src/main/terminal/flow-control.ts`). So the shell takes longer, and the user sees all of the output slightly sooner. The CPU spent on the throughput run is unchanged (renderer 3.10 s → 3.35 s, main 1.55 s → 1.62 s).

A daemon would move the PTYs out of the main process. None of the remaining costs is there. The main process is now 179 MB. The end-to-end time of the terminal is bound by drawing, which stays in the renderer whatever owns the PTY. The largest new cost is the 124 MB of the extension host. That cost is JavaScript, which a Rust daemon would not replace.

## Consequences

- `node-pty` stays in main. ADR-001 stands.
- The next cost to measure is the memory of the extension host, per extension, before anyone changes anything.
- The team considers a daemon again only from a new measurement with `scripts/perf/app-metrics.mjs` that points at the main process or the PTY path.

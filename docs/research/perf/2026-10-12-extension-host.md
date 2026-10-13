# Extension host memory, per extension (2026-10-12)

ADR-101 left one thing to measure next: the extension host's memory, extension by extension, before changing anything. This note records that measurement and the two changes it led to.

## Method

`scripts/perf/app-metrics.mjs --runs=5 --electron-arg=--no-sandbox --extensions=each` under `xvfb-run -a`, on a Linux x86_64 machine with 4 CPUs, against `npm run build` output. Each scenario is five launches with fresh profiles, and the figures are medians:

- **none**: every extension disabled, so no host process starts;
- **perf.probe**: a probe extension that loads nothing and writes the host's `process.memoryUsage()` every 0.5 s. On its own it measures what the host costs before any extension code loads;
- **one extension**: one bundled extension enabled, with the probe beside it;
- **all**: every bundled extension and the probe.

"Host" is the working set of the `Extension Host` utility process from `app.getAppMetrics()`. "Heap" is `heapUsed` as the probe saw it from inside the host. Raw output: [`2026-10-12-extension-host-before.json`](2026-10-12-extension-host-before.json) and [`2026-10-12-extension-host-after.json`](2026-10-12-extension-host-after.json).

## Before

| Scenario         | Host (MB) | Over the probe | Heap (MB) |
| ---------------- | --------: | -------------: | --------: |
| perf.probe alone |        99 |              — |       3.3 |
| task-vault       |       104 |             +5 |       4.7 |
| notepad          |       103 |             +4 |       4.6 |
| foundry          |       109 |            +10 |       7.0 |
| git-integration  |       112 |            +13 |       6.8 |
| remote-control   |       116 |            +17 |       8.7 |
| all              |       127 |            +28 |      15.5 |

Most of the host's cost, 99 MB, is the utilityProcess itself: the V8 isolate and Node runtime that start with any backend. The probe's own heap is 3.3 MB. JavaScript in this repository cannot reduce that part. The only way to avoid it is to start no host at all, which already happens when every extension is disabled.

The cost beyond the probe follows what each bundle `require`s at load. That cost was measured in plain Node by requiring the bundle once `zod` was loaded:

| Required at activation                             | RSS (MB) | Used by                                    |
| -------------------------------------------------- | -------: | ------------------------------------------ |
| `fastify`, `@fastify/static`, `@fastify/websocket` |     24.8 | Remote Control, only while the server runs |
| `electron-store`                                   |     17.0 | git-integration, only when a store is read |
| `web-tree-sitter`                                  |      0.5 | git-integration                            |

Remote Control is off by default, yet its activation loaded fastify. git-integration loaded electron-store at activation, before any channel had used a store.

## Changes

- **Remote Control** imports `./server/remote-server.js` (and fastify with it) inside `startServer`, the first time the server is turned on. `PortInUseError` moved to `src/server/port-in-use-error.ts` so that `activate` can recognise the error without loading the server. `tests/unit/lazy-server.spec.ts` covers this.
- **git-integration** imports `electron-store` inside `namedStore`, which now returns a promise. Its callers in `github.ipc.ts`, `merge-flow.ipc.ts` and `review-agent.ipc.ts` await it. `tests/unit/lazy-store.spec.ts` covers this.

## After

| Scenario        | Host before | Host after | Change | Heap before → after |
| --------------- | ----------: | ---------: | -----: | ------------------: |
| remote-control  |         116 |        102 | −14 MB |           8.7 → 4.1 |
| git-integration |         112 |        104 |  −8 MB |           6.8 → 5.8 |
| foundry         |         109 |        108 |      — |           7.0 → 7.0 |
| notepad         |         103 |        103 |      — |           4.6 → 4.6 |
| task-vault      |         104 |        104 |      — |           4.7 → 4.8 |
| all             |         127 |        115 | −12 MB |         15.5 → 10.4 |

Turning Remote Control on, or opening the first store, still loads those modules, at the same cost as before. The 12 MB saving is what a user keeps while Remote Control is off and no review or merge session has been read yet.

## What is left

The remaining extension code, 3 to 9 MB above the probe per extension, is mostly each bundle's own code and `zod` schemas. Foundry is the largest of these, at 657 KB of bundle. None of it is a dependency that loads before it is needed. The host's 99 MB floor is the process itself. Lowering it would mean running backends somewhere other than a separate process, and ADR-094 chose a separate process deliberately.

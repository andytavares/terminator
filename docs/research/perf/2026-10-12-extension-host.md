# Extension host memory, per extension (2026-10-12)

ADR-101 left one item to measure next: the memory of the extension host, extension by extension, before any change. This note records the measurement and the two changes it led to.

## Method

`scripts/perf/app-metrics.mjs --runs=5 --electron-arg=--no-sandbox --extensions=each` under `xvfb-run -a`, on a Linux x86_64 machine with 4 CPUs, against the output of `npm run build`. Each scenario is five launches with fresh profiles. The figures are medians:

- **none**: every extension is disabled, so no host process starts.
- **perf.probe**: a probe extension that loads nothing and writes `process.memoryUsage()` of the host every 0.5 s. Alone, it measures the cost of the host before any extension code loads.
- **one extension**: one bundled extension is enabled, with the probe beside it.
- **all**: every bundled extension and the probe are enabled.

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

Most of the cost of the host, 99 MB, is the utilityProcess itself: the V8 isolate and Node runtime that start with any backend. The heap of the probe is 3.3 MB. JavaScript in this repository cannot reduce the 99 MB. The only way to avoid it is to start no host. That already happens when every extension is disabled.

The cost beyond the probe follows what each bundle `require`s at load. We measured this cost in plain Node, by requiring the bundle once `zod` was loaded:

| Required at activation                             | RSS (MB) | Used by                                    |
| -------------------------------------------------- | -------: | ------------------------------------------ |
| `fastify`, `@fastify/static`, `@fastify/websocket` |     24.8 | Remote Control, only while the server runs |
| `electron-store`                                   |     17.0 | git-integration, only when a store is read |
| `web-tree-sitter`                                  |      0.5 | git-integration                            |

Remote Control is off by default, but its activation loaded fastify. git-integration loaded electron-store at activation, before any channel used a store.

## Changes

- **Remote Control** imports `./server/remote-server.js` (and fastify with it) inside `startServer`, the first time the server starts. `PortInUseError` moved to `src/server/port-in-use-error.ts`, so that `activate` can recognise the error without loading the server. `tests/unit/lazy-server.spec.ts` covers this.
- **git-integration** imports `electron-store` inside `namedStore`, which now returns a promise. The callers in `github.ipc.ts`, `merge-flow.ipc.ts` and `review-agent.ipc.ts` await the promise. `tests/unit/lazy-store.spec.ts` covers this.

## After

| Scenario        | Host before | Host after | Change | Heap before → after |
| --------------- | ----------: | ---------: | -----: | ------------------: |
| remote-control  |         116 |        102 | −14 MB |           8.7 → 4.1 |
| git-integration |         112 |        104 |  −8 MB |           6.8 → 5.8 |
| foundry         |         109 |        108 |      — |           7.0 → 7.0 |
| notepad         |         103 |        103 |      — |           4.6 → 4.6 |
| task-vault      |         104 |        104 |      — |           4.7 → 4.8 |
| all             |         127 |        115 | −12 MB |         15.5 → 10.4 |

Turning Remote Control on, or opening the first store, still loads those modules at the same cost as before. A user keeps the 12 MB saving while Remote Control is off and no review or merge session has been read.

## What is left

The remaining extension code is 3 to 9 MB above the probe per extension. It is mostly the code of each bundle and `zod` schemas. Foundry is the largest, at 657 KB of bundle. No dependency in this code loads before it is needed. The 99 MB floor of the host is the process itself. To lower it, we must run backends somewhere other than a separate process, and ADR-094 chose a separate process deliberately.

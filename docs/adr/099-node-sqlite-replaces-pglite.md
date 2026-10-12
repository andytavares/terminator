# ADR 099: `node:sqlite` replaces PGlite and sql.js

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: ADR-015, ADR-019

## Decision

The app database moves from PGlite to Node's built-in [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html). notepad and task-vault rewrite their Postgres-only SQL (`jsonb` operators, `STRING_AGG`, `ILIKE`). Existing data is exported from `app.pglite` once, one release before PGlite is removed, and `app.pglite` is kept as a backup. `sql.js` and the legacy import it served are removed now; that import window is closed.

## Context

One PGlite instance adds about 250 MB to the main process and about 0.6 s to every start, for create, read, update and delete in two extensions. The core has no tables. Electron 44 ships Node 24.21 (`DEPS` at `v44.7.0`), which includes `node:sqlite`; a 1,000-row test added about 2 MB.

## Accepted risk

`node:sqlite` is at stability 1.2, release candidate, in Node 24 ([changelog in the docs](https://github.com/nodejs/node/blob/v24.x/doc/api/sqlite.md): "SQLite is now a release candidate", v24.15.0). Node describes that stage as hopefully ready to become stable with no further breaking changes anticipated, but they may still occur ([stability index](https://nodejs.org/docs/latest-v24.x/api/documentation.html#stability-index)). The database code sits behind one module per extension so a breaking change is contained.

## Alternatives considered

| Alternative            | Why rejected                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Keep PGlite, load lazy | Defers the 250 MB instead of removing it; both extensions open at start            |
| A native SQLite add-on | A dependency the runtime already provides; a native rebuild on every Electron bump |

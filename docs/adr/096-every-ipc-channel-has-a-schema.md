# ADR 096: Every IPC channel is registered with a zod schema

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: ADR-023, ADR-083

## Decision

Every invoke channel, core and extension, is registered through the schema table in `src/main/ipc/invoke-table.ts`. The zod schema is a required field there. A channel without a schema does not compile. The 54 core handlers that register directly with `handleChannel` move onto the table. The extension API offers only the table form.

Tests check payload rejection once, in two tests:

- One test covers the shared parse step.
- One test checks that every remote-accessible channel in the registry has a schema and rejects a malformed payload.

The per-channel rejection cases are deleted.

## Context

The remote bridge (`extensions/remote-control/src/server/routes/bridge.route.ts`) passes raw JSON from a WebSocket to the same handlers that the desktop renderer calls. TypeScript types do not exist at run time. So the typed calls of the desktop renderer say nothing about what a ticket holder can send. The security checklist of Electron requires validating IPC input in the main process ([#17](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)). The handlers were validating, but by hand in some places and by schema in others. That is why about 160 test cases each re-tested a rejection.

## Consequences

- Whether zod rejects bad input is a concern of zod. This repository tests that each channel has a schema. It does not test the rules of each schema.
- The payload type of a handler comes from its schema, so the two cannot disagree.

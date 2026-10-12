# ADR 096: Every IPC channel is registered with a zod schema

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: ADR-023, ADR-083

## Decision

Every invoke channel, core and extension, is registered through the schema table in `src/main/ipc/invoke-table.ts`, where the zod schema is a required field. A channel without a schema does not compile. The 54 core handlers registered directly with `handleChannel` move onto the table, and the extension API offers only the table form.

Payload rejection is tested once: one test of the shared parse step, and one test that every remote-accessible channel in the registry has a schema and rejects a malformed payload. The per-channel rejection cases are deleted.

## Context

The remote bridge (`extensions/remote-control/src/server/routes/bridge.route.ts`) passes raw JSON from a WebSocket to the same handlers the desktop renderer calls. TypeScript types do not exist at run time, so the desktop renderer's typed calls say nothing about what a ticket holder can send. Electron's security checklist requires IPC input to be validated in the main process ([#17](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)). The handlers were validating, but by hand in some places and by schema in others, which is why about 160 test cases each re-tested a rejection.

## Consequences

- Whether zod rejects bad input is zod's own concern; this repository tests that each channel has a schema, not each schema's rules.
- A handler's payload type comes from its schema, so the two cannot disagree.

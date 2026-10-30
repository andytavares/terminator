# ADR 138: A research order opens no pull request

**Status**: Accepted

**Date**: 2026-10-30

**Amends**: [ADR 086](086-six-shapes-and-a-document-hand-back.md) (the `checkout` hand-back), [ADR 119](119-research-ends-in-a-claude-artifact.md)

## Context

Order `WO-1030-4b9` (TAV-20, a research order) wrote its answer to `docs/research/pr-overview-redesign.html` in the checkout and handed it back as `checkout`. A `checkout` document shipped as a pull request, so the final check climbed over it. `npm run format:check` failed on the HTML. **Send back** gave the failure to the author. But the author has no shell and cannot run Prettier. Each round failed the same way.

The product of a research order is a document for a person to read, not a change to the repository.

## Decision

- `recipes/research.yaml` ends at the fresh verifier. It has no `integrate` join and no `ready-for-review` gate.
- `roles/author.yaml` writes only `document`. The author cannot edit the checkout. It writes to the outputs folder of the order and publishes a Claude artifact.
- A rung output refuses a `checkout` document (`src/line/rung-output.ts`). The contract of the author offers only `outputs` and `published`.
- The run tail ends a document shape on its document when every node finished and no gate is open. Before, it did so only when the run would open a pull request (`endedOnDocument` in `src/line/execute-run.ts`).
- `DOCUMENT_LOCATIONS` keeps `checkout`, so orders written before this ADR still load and finish as they started.

## Consequences

- A research order never runs the final check, so the format, lint or test failures of a repository cannot hold it.
- An order that asks for a document in the repository uses a code shape, where the scribe or the builder writes the document.

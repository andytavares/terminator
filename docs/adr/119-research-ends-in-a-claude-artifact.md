# ADR 119: A research order ends in a Claude artifact

**Status**: Accepted

**Date**: 2026-10-20

**Relates to**: [ADR 086](086-six-shapes-and-a-document-hand-back.md), [ADR 117](117-extensions-send-home-data-core-draws-it.md)

## Context

Foundry's `research` shape ends on the author's document. When the author published it as a Claude artifact, the link went nowhere. No surface showed it once the run ended. The order stayed `running`, so Home listed it as Building and the ticket never moved. The real order WO-1014-e51 sat that way for six days. The verifier was never told where the document was, so it judged an empty diff.

## Decision

- The author publishes unattended. Its session gets the order's outputs folder through `--add-dir`, so Claude Code reads the page without asking. It also gets `CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0`, so no browser tab opens. `publishDocumentRule` (`runtime/tool-decision.ts`) allows a document role's `Artifact` call on a file in its outputs folder or worktree, at every autonomy setting.
- A `published` hand-back carries its link. That link must appear in an `Artifact` result (`Published <path> at <url>`) in the author's own transcript, or the rung is refused (`runtime/artifact-publishes.ts`).
- The verifier's brief names the document under review.
- A run that ends on a ready document saves `status: shipped`, the same status a draft pull request gives an order. The ticket moves to In Review and gets the link as a comment. A new `delivered` status was rejected: every reader of "done" already keys on `shipped`.
- Every surface that names an order links its document: the order list, the Floor, the gate cards, the factory hall and the factory site.
- Home's thread facets gain an optional `links` field (SDK 5.1.0), drawn as buttons on the thread's drawer. The field is generic. Foundry is one publisher of it.

## Consequences

- An artifact is private to the account that published it, which is the operator's: Foundry runs `claude` under it.
- A session not signed in to claude.ai cannot publish. Its author hands back `outputs`, and the order still ships with "Open document".
- The link check depends on the wording of the Artifact tool's result line. `tests/runtime/artifact-publishes.spec.ts` pins it.

# ADR 119: A research order ends in a Claude artifact

**Status**: Accepted

**Date**: 2026-10-20

**Relates to**: [ADR 086](086-six-shapes-and-a-document-hand-back.md), [ADR 117](117-extensions-send-home-data-core-draws-it.md)

## Context

The `research` shape of Foundry ends on the document of the author. When the author published the document as a Claude artifact, the link went nowhere. No surface showed the link once the run ended. The order stayed `running`, so Home listed it as Building and the ticket never moved. The real order WO-1014-e51 stayed that way for six days. Nobody told the verifier where the document was, so it judged an empty diff.

## Decision

- The author publishes unattended. Its session gets the outputs folder of the order through `--add-dir`, so Claude Code reads the page without asking. It also gets `CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0`, so no browser tab opens. `publishDocumentRule` (`runtime/tool-decision.ts`) allows an `Artifact` call of a document role on a file in its outputs folder or worktree, at every autonomy setting.
- A `published` hand-back carries its link. That link must appear in an `Artifact` result (`Published <path> at <url>`) in the own transcript of the author. Otherwise the rung is refused (`runtime/artifact-publishes.ts`).
- The brief of the verifier names the document under review.
- A run that ends on a ready document saves `status: shipped`, the same status that a draft pull request gives an order. The ticket moves to In Review and gets the link as a comment. The team rejected a new `delivered` status, because every reader of "done" already keys on `shipped`.
- Every surface that names an order links its document: the order list, the Floor, the gate cards, the factory hall and the factory site.
- The thread facets of Home gain an optional `links` field (SDK 5.1.0). Home draws the links as buttons on the drawer of the thread. The field is generic. Foundry is one publisher of it.

## Consequences

- An artifact is private to the account that published it. That account is the operator's, because Foundry runs `claude` under it.
- A session that is not signed in to claude.ai cannot publish. Its author hands back `outputs`, and the order still ships with "Open document".
- The link check depends on the wording of the result line of the Artifact tool. `tests/runtime/artifact-publishes.spec.ts` pins the wording.

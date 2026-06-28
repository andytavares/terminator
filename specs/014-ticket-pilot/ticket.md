# Feature seed for /speckit-specify

Revamp the SpecKit Pilot extension so I can dispatch a Linear or Jira ticket to an
autonomous agent that owns the work end to end — design, planning, testing, and
implementation — and opens a seat pull request for me to review.

Use Spec Kit as the orchestration layer: each run drives the existing SDD cycle
(specify → clarify → plan → checklist → tasks → analyze → implement) plus two new tail
phases, Self-Review and Open PR. An agent runner drives each spec-kit command headless;
I review the artifact each phase produces at a human gate and can approve, request
changes (fed back into a re-run), comment, edit, reject, or revoke. For large tickets,
Implement runs in task batches by tasks.md section and checks in at each boundary.

Self-Review runs format, lint, vitest --coverage (≥80%), and /google-review and shows
the real numbers; it and Open PR are always gated and can never be auto-approved. Open
PR runs gh pr create, links the PR to the ticket and the generating spec.md/plan.md, and
writes the PR URL back to the tracker, then hands off to the existing Code Reviews tab.

Replace the existing SpecKit Pilot UI entirely with the new layout (ticket inbox →
dispatch → 10-phase run dashboard → gates → tasks board → self-review → PR), on the
SpecKit project tab. Tracker credentials stay in the main process only. Linear/Jira SDKs
go in the extension's own package.json. Follow the project constitution (TDD, ≥80%
coverage, lint, /google-review, docs in the same change).

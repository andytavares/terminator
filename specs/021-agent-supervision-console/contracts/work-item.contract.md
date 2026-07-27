# Contract: Work Item Publication

**Feature**: `021-agent-supervision-console` | **Status**: Draft | **Contract version**: `1`

This is a **published contract**. Once shipped, changing it breaks producers. It is versioned accordingly.

## Direction of dependency

```
producer  --writes-->  publication directory  --read only-->  console
console   --invokes-->  Extension API commands  -------------> producer
```

The console **never** reads, writes, or watches any path inside a producer's own directory (FR-072). The console **never** writes a contract file (FR-073). Every console→producer action goes through a registered Extension API command (FR-077), documented in [extension-api.contract.md](./extension-api.contract.md).

## Location

```
<userData>/supervision/workitems/<producer-id>/<work-item-id>.json
```

- `<userData>` is Electron's per-user application data path.
- `<producer-id>` is the publishing extension's id, which namespaces producers so two can publish concurrently without collision (FR-074).
- The console creates and owns this tree. Producers create their own subdirectory and write only their own files.

## Schema (`contract_version: 1`)

```jsonc
{
  "contract_version": 1, // REQUIRED. Integer major version.
  "id": "FLU-220", // REQUIRED. Unique within a producer.
  "source": "linear", // REQUIRED. "linear" | "github" | "local"
  "source_url": "https://…", // optional
  "title": "Unify session identity", // REQUIRED
  "created_at": "2026-07-27T09:04:11Z", // REQUIRED. ISO 8601 UTC.

  "phase": "implement", // REQUIRED. See phases below.

  "artifacts": {
    // optional; absolute or repo-relative paths
    "spec": "specs/012-session-identity/spec.md",
    "plan": "specs/012-session-identity/plan.md",
    "tasks": "specs/012-session-identity/tasks.md",
  },

  "gates": {
    // optional; absent gate == not approved
    "spec_approved_by_human": { "ok": true, "at": "2026-07-27T09:12:40Z" },
    "plan_approved_by_human": { "ok": true, "at": "2026-07-27T09:31:02Z" },
    "clarify_clean": { "ok": true, "open_questions": 0 },
    "analyze_clean": { "ok": false, "findings": 2 },
  },

  "contract": {
    // optional; multi-repo only
    "summary": "SessionId = ULID, emitted by fluent, consumed downstream",
    "shared_files": ["proto/session.proto"],
  },

  "lanes": [
    // REQUIRED, minimum 1 (FR-089)
    {
      "ord": 1, // REQUIRED. Merge position, 1-based.
      "repo": "fluent", // REQUIRED. Repository identifier.
      "role": "producer", // REQUIRED. "producer" | "consumer"
      "branch": "feat/session-ulid", // REQUIRED
      "task_ids": ["T001", "T002"], // optional
      "blocks": [2, 3], // optional, ords
      "blocked_by": [], // optional, ords
    },
  ],
}
```

**`session_id` is deliberately absent from `lanes[]`.** The PRD placed it there, which would require the console to write into producer state. It lives in console-owned LaneBinding storage instead (FR-075). This is the single most important difference between this contract and the PRD's draft.

## Phases

`intake → specify → clarify → plan → tasks → implement → review → merged`, with a send-back loop from any phase to `specify` or `plan`.

The console renders phase; it does not advance it. Advancing is a producer action invoked through a registered command.

## Validation and failure behaviour

Validated with Zod on read. All failures are **per-item** — one bad file never affects another item or any surface (FR-085).

| Condition                            | Console behaviour                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Valid, known `contract_version`      | Rendered normally                                                                         |
| Unknown **major** `contract_version` | Item `unreadable`, reason: "published under contract version N, this build understands 1" |
| Missing `contract_version`           | Item `unreadable`, reason: "no contract version"                                          |
| Schema violation                     | Item `unreadable`, reason names the failing field                                         |
| Partial/truncated write              | Item `unreadable`; re-read on next change event                                           |
| Same `id` from two producers         | **Both** shown as conflicted, naming both producers. Never a silent pick (FR-074).        |
| Zero lanes                           | Schema violation → `unreadable`                                                           |
| No producer, or empty directory      | No work items; sessions supervised as ad-hoc (FR-081). Not an error state.                |

**Write atomicity**: producers SHOULD write to a temporary file in the same directory and rename into place. The console tolerates a torn read either way, but a rename makes it a non-event.

## Versioning policy

- **Major** bump (`contract_version: 2`) for any removed or semantically-changed required field. The console rejects unknown majors outright rather than guessing.
- Additive optional fields do **not** bump the major. The console ignores fields it does not recognise, so a newer producer degrades gracefully against an older console.
- The console MUST accept at least the current major and MAY accept older ones.

## Requirements covered

FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-080, FR-082, FR-085, FR-086, FR-087, FR-088, FR-089

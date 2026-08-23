# Phase 0 Research: Tracker issues attached to projects

**Feature**: 031-linear-project-integration · **Date**: 2026-08-22

Every decision below is grounded in vendor documentation or in the current source, per
Constitution I. Where a fact could not be verified from documentation it is labelled
**UNVERIFIED** and carries a task to verify it against the live API before the code depending
on it is considered done. Nothing here is inferred from examples alone.

---

## R1. Where the service lives

**Decision**: A single core module `src/main/integrations/`, provider-shaped, with Linear and
Jira as two providers behind one facade. Renderer reaches it through the channel manifest;
extensions reach it through a new `api.issues` namespace.

**Rationale**: Constitution II forbids core depending on an extension, and today both tracker
clients and both credentials live inside `extensions/speckit-pilot`. No core surface — sidebar,
settings, project dialogs — can legally use them. FR-027 requires one connection behind every
surface, which is only possible if the connection is core-owned. `api.shell`, `api.db` and
`api.pty` already establish the pattern for a core capability offered to extensions.

**Alternatives considered**:

| Alternative                                                     | Rejected because                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Leave the clients in speckit-pilot; core calls its IPC channels | Direct violation of Constitution II's test — deleting the extension would break core.                                                      |
| A new "integrations" extension owning both trackers             | Same problem one level removed: core's own sidebar and settings would depend on an extension.                                              |
| Two independent core services, one per tracker                  | Duplicates the cache, the link store, the error taxonomy and the context builder. FR-035 requires one issue shape reaching every consumer. |

## R2. Credential storage and migration

**Decision**: `safeStorage`-encrypted values in a single JSON file under `app.getPath('userData')`,
written atomically (tmp + rename). On first run, adopt Linear **and** Jira credentials from
`speckit-pilot-creds.json`, then rename that file `.bak` so the migration is idempotent.

**Rationale**: `safeStorage` + atomic write is the pattern the extension already uses
(`extensions/speckit-pilot/src/api/credentials.ts`) and is proven on this platform in this app.
Renaming rather than deleting means a failed migration is recoverable by hand. FR-004 requires
the operator never re-enters a credential they have already given.

**Alternatives considered**: `electron-store` (used by the workspace store) — rejected because
it stores plaintext JSON and these are credentials. The OS keychain directly via a native module
— rejected under Constitution IV as a new native dependency where `safeStorage`, which is
Electron's own keychain wrapper, already satisfies the need.

**Note**: the workspace store's `electron-store` is pinned `^8.2.0` (a caret range) while
Constitution IV requires pinned versions. Pre-existing; not this feature's to fix, but flagged.

## R3. Linear provider

**Decision**: `@linear/sdk` pinned at `91.0.0` in the **root** `package.json`, since this is now
core code. speckit-pilot drops its own `@linear/sdk` entry.

Verified against Linear's published API/SDK documentation:

- `client.issues({ filter, first, after, orderBy })` for assigned issues, with
  `pageInfo.hasNextPage` / `endCursor` pagination.
- `client.searchIssues({ term, filter, first })` for the picker's full-text search.
- `issue(id:)` and `issueUpdate(id:)` accept **either** a UUID **or** the shorthand key
  (`TAV-42`) — documented explicitly.
- `RatelimitedLinearError` carries `retryAfter` (seconds) plus request and complexity budget
  fields; backoff is driven from it rather than from a guess.
- `issue.branchName` is Linear's own suggested VCS branch name — already relied on by the
  extension's ticket import.

**Comment addressing — decided**: Linear issues are addressed by **UUID, always**. The shorthand
key is documented for `issue()` and `issueUpdate()` and says nothing either way about comment
creation; rather than find out, the provider resolves key → UUID and uses that everywhere, which
Linear documents as working for every operation. One addressing mechanism, one thing to be right
about. The old code passed the key inside `.catch(() => {})`, so a rejection was invisible — that
silent catch is gone regardless (FR-034a, Constitution X).

**Version jump**: the extension pins `27.0.0`; current is `91.0.0` (published 2026-08-21). This
is a fresh integration behind a facade, so the jump is absorbed once here rather than migrated
through the extension's two call sites.

## R4. Jira provider

**Decision**: Jira Cloud REST **v3**, Basic auth (`email:apiToken`), reusing the shape of the
existing client but on the current endpoint.

Verified against Atlassian's Jira Cloud Platform REST v3 documentation:

- **`GET /rest/api/3/search` is documented as "currently being deprecated and removed."** The
  replacement is `GET|POST /rest/api/3/search/jql`, paginated by `nextPageToken`, with an
  optional `reconcileIssues` for read-after-write consistency.
  **The existing extension code calls the deprecated endpoint.** Moving to `/search/jql` is
  therefore part of this feature, not an optional cleanup.
- **v3 uses Atlassian Document Format (ADF)** — a JSON document — for descriptions, comments,
  environments and multi-line custom fields. Jira issue content is _not_ markdown.
- `POST /rest/api/3/issue/{issueIdOrKey}/comment` accepts the **issue key** in the path, so
  Jira comment addressing needs no key→id resolution (unlike Linear, R3).
- Jira has **no equivalent of Linear's `branchName`**; branch prefill falls back to key + title
  (spec Assumptions).

**Dead code**: `transitionStatus()` in the extension's Jira client changes issue state. FR-034
forbids state changes and nothing calls it. It is deleted rather than carried over
(Constitution X).

## R5. Normalising issue content — the ADF problem

FR-014 requires one rendering of markdown; Jira supplies ADF. Three routes exist.

**Decision**: convert ADF → markdown in the main process with a small in-house pure mapper
covering exactly the node set FR-014 names (heading, paragraph, bulletList, orderedList,
taskList, table, blockquote, codeBlock, rule, hardBreak, text with strong/em/code/strike/link
marks), and pass markdown to a single renderer for both trackers. Unknown node types degrade to
their text content rather than disappearing or throwing.

**Rationale**: it keeps one renderer, one sanitisation story, and one agent-context builder for
both trackers. ADF is a documented, versioned JSON schema, and the mapper is pure and fully
unit-testable per Constitution XI. FR-014's node list bounds the work — this is not an
open-ended ADF implementation, and YAGNI (Constitution VII) forbids making it one.

**Alternatives considered**:

| Alternative                                                                         | Rejected because                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expand=renderedFields` → Jira's HTML, render HTML for Jira and markdown for Linear | Two render paths, and the HTML one needs its own sanitiser. Directly contradicts FR-014/FR-015 having one answer. It is also what the current code does, and is why `Ticket.bodyFormat` exists as `'markdown' \| 'html'`. |
| `adf-to-md` (npm)                                                                   | **Single maintainer**, last published 2024-11. Constitution IV: "A package maintained by a single individual MUST NOT be adopted, regardless of fit."                                                                     |
| `@atlaskit/editor-markdown-transformer`                                             | Atlassian-official and actively published, but it is a slice of the Atlaskit editor and drags a large dependency tree into the main process for one conversion. Rejected on weight under Constitution V.                  |

**Consequence to accept**: an ADF document using a node type outside the mapped set renders as
its text content. That is a visible, bounded degradation, and it is stated in the ADR rather
than discovered.

## R6. Rendering issue content safely

**Decision**: `react-markdown@10.1.0` + `remark-gfm@4.0.1` in the renderer, configured with:

- `skipHtml` — raw HTML in issue content is removed, not escaped-and-shown;
- **no** `rehype-raw`;
- a `urlTransform` that returns `null` for `src`, so no image in an issue can cause a network
  fetch (a remote image in an issue body is a tracking pixel aimed at the operator);
- a custom `a` component that calls `shell.openExternal` rather than navigating.

Verified from react-markdown's documentation: raw HTML is **not** rendered by default (it is
escaped; `skipHtml` removes it), and `defaultUrlTransform` already blocks `javascript:` while
allowing http/https/mailto and relative paths.

**Rationale**: this is exactly FR-015 and FR-016 — issue content is untrusted remote text that
must render but never act. Both packages are the remark/unified ecosystem with three
maintainers each; `react-markdown` is already used by `extensions/git-integration` (pinned
`9.0.1`), so the choice is battle-tested in this codebase. Core pins the current `10.1.0`; the
extension's pin is left alone rather than dragged into this feature's scope.

**Alternatives considered**: `marked` + `dompurify` — `marked` is already a dependency of two
extensions, but it produces an HTML string, which means `dangerouslySetInnerHTML` plus a
sanitiser (`dompurify` is single-maintainer) to get back to where react-markdown starts.
Rejected on both security shape and Constitution IV.

**Open**: `shell.openExternal` is exposed on `window.electronAPI` and is already used by the
terminal's link handling, so no new channel is needed for FR-016.

## R7. Feeding an agent session

**Decision**: a `SessionStart` hook, registered in an owned block inside the project directory's
`.claude/settings.local.json`, invoking a Terminator-written script that prints
`hookSpecificOutput.additionalContext` and exits 0.

Verified from Claude Code's documentation:

- `SessionStart` supports JSON stdout with `hookSpecificOutput.additionalContext` (added to the
  model's context at session start) and `sessionTitle`.
- **Hook output fields are capped at 10,000 characters**; beyond that the runtime spills to a
  file and substitutes a preview and path. This is the number FR-022 and FR-023 budget against.
- `.claude/settings.local.json` is the highest-precedence filesystem settings file, is
  gitignored by convention, and hooks from all levels merge rather than replace.

Verified in this codebase (ADR-026): `hookEventName` is **required** inside `hookSpecificOutput`
or the whole object is ignored, silently. The same discipline applies here.

**Mechanism**: the hook command is
`ELECTRON_RUN_AS_NODE=1 <process.execPath> <hookScript> <contextFile>` — the same
"Electron as node" invocation ADR-026 uses, so the hook needs neither a `node` on `PATH` nor
whatever the login shell happens to export. The script source is carried as a string constant
and written to disk at startup, matching `extensions/speckit-pilot/src/runtime/hook-script.ts`
and for the same reason: a loose script beside the bundle survives development and vanishes from
the packaged app.

**Why not the alternatives**:

| Alternative                                                | Rejected because                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude --settings <file>` at launch                       | Only covers sessions the application launches. FR-020 requires a session the operator starts by hand in that directory to get the same context. |
| A `CLAUDE.md` or `ticket.md` in the repository             | Pollutes the working tree and appears in diffs. (SpecKit's own `ticket.md` is a phase input and stays as it is.)                                |
| An environment variable pointing Claude at a settings file | **No such variable is documented.** Checked against the environment-variables reference.                                                        |

**Accepted cost**: the application writes one file inside the project directory. Bounded by:
merge-only edits within a marked owned block; never touching `.claude/settings.json`; complete
removal on unlink (FR-025); a loud failure if the directory is not writable (FR-026).

**Also**: `pty-manager.spawnSession` currently passes `process.env` straight through. Adding
`TERMINATOR_ISSUE_KEY` / `TERMINATOR_ISSUE_URL` means composing the child env from
`process.env` plus per-session additions — a small, contained change to one call site.

## R8. Freshness and request budget

**Decision**: a TTL cache (5 minutes, a constant — not an operator setting) keyed by tracker + issue
key, with single-flight so concurrent asks for the same key produce one request, and an explicit
refresh that bypasses it. Rate-limit refusals are honoured by waiting the period the tracker
states (`retryAfter` for Linear; `Retry-After` / 429 for Jira) before retrying.

**Rationale**: FR-028, FR-031 and SC-008. Five minutes is short enough that a state change is
not acted on for long and long enough that a sidebar badge does not spend the rate budget.
It is **not** exposed as a setting: no requirement asks for one, explicit refresh already covers
the case an operator would reach for it, and Constitution VII forbids the speculative control.

## R9. Exposing channels

**Decision**: declare every renderer-facing method once in `src/shared/electron-api/manifest.ts`,
which generates the preload adapter, the remote shim and the remote allowlist. Handlers are
registered through the existing `registerInvokeTable` / `invokeSpec` Zod-validated pattern.

**Remote behaviour**, per ADR-023's default-deny posture:

- `integrations.connect` / `integrations.disconnect` → **`omit`**. Credential entry stays on the
  local renderer; a LAN-reachable surface has no business writing tracker credentials, however
  well authenticated.
- Everything else (status, list, search, get, comment, link get/set/clear, context preview) →
  `same`, so the remote surface keeps working.

Credentials never cross the boundary in either direction: `status` returns a connected flag and
the account identity, never the secret (FR-003).

## R10. Extension API surface and migration

**Decision**: add `api.issues` and extend `api.workspace.createProject` with an optional issue,
released as Extension API **v2.2.0**.

**Version rationale**: the highest version marker in `docs/EXTENSION-DEVELOPMENT.md` is `v2.1.0`
(`openTerminalTab`, `createProject`), so the next additive release is v2.2.0. **Noted
inconsistency**: `src/main/extensions/api.ts` still annotates members as v1.x while the docs use
v2.x. This feature follows the documented series and does not attempt to reconcile the two — that
is a separate cleanup, recorded here so it is not mistaken for an oversight.

**Migration**:

- `speckit-pilot`: delete `api/linear.ts`, `api/jira.ts`, the credential half of
  `api/credentials.ts`, its Linear/Jira settings UI, `@linear/sdk` from its `package.json`, and
  the now-dead `transitionStatus`. `speckit:ticket-list` becomes `api.issues.listMine()`.
  Board behaviour must be unchanged (FR-029, SC-011).
- `git-integration`: its PR-body scraper (`github/pr-review-service.ts:848`) keeps finding
  references; each is enriched through `api.issues.get()` for title and state (FR-030).

## R11. Where an association lives

**Decision**: a store owned by the integrations module, keyed by project id, garbage-collected
from the existing `onProjectDelete` event (`src/main/extensions/workspace-events.ts`).

**Rationale**: keeps core's workspace store untouched and the feature self-contained, and the
deletion event already exists. FR-008 needs the association discarded with its project; nothing
needs it to be atomic with project creation.

**Alternative considered**: adding a field to `ProjectSchema` in the workspace store. Rejected
because it spreads this feature across a core schema every other surface reads, for no gain.

## R12. Testing

**Decision**: unit-first per Constitution VI, with the network boundary as the only mocked seam.

- Pure functions get direct tests: the ADF → markdown mapper, the agent-context builder and its
  truncation, the settings-block merge/unmerge, key/branch derivation.
- Providers are tested against recorded response fixtures, not the live API.
- IPC handlers extend the existing `*-ipc.spec.ts` pattern.
- Renderer components use jsdom with an `electronAPI` mock, matching the established convention.
- Markdown rendering gets an explicit **security** test: an issue body containing a `<script>`
  tag, an `onerror` image, a `javascript:` link and a remote image must render inert with no
  network fetch attempted.

Every new production file ships with tests bringing it to ≥80%. Before touching any existing
file, check its current coverage — the patch gate measures the whole file, and pre-existing
sub-80% files will otherwise block the change.

---

## Facts we would not take on faith

Five things the documentation could not settle. **All five are now closed** — see
[verifications.md](./verifications.md), which states each question in plain terms and what was
done about it. In short: two were proven against live systems, three were closed by decision.

| #   | The question                                                      | Outcome                                                         |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Naming an issue by key vs UUID when commenting on Linear          | Closed — we use the UUID, so it stops mattering                 |
| 2   | Whether the old, error-swallowing "PR opened" comment ever worked | Closed — that code is deleted                                   |
| 3   | Whether a hand-started `claude` really receives the issue         | **Verified** against a live agent, with a control               |
| 4   | Whether unlinking leaves the project directory untouched          | **Verified** by an automated test                               |
| 5   | Jira search paging past page one                                  | Closed — accepted on fixtures; real Jira users will exercise it |

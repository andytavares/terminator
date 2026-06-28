# Extension UI Views Contract: SpecKit Pilot Revamp

**Date**: 2026-06-27
**Visual reference**: `specs/014-ticket-pilot/renderings.html`

Defines the four sub-views the extension contributes to the SpecKit project tab and their data contracts. Each view is a React component rendered in the extension webview.

---

## Sub-navigation items

The extension adds four items to the sidebar slot the project tab reserves:

| Item        | Route key       | Badge                          |
| ----------- | --------------- | ------------------------------ |
| Tickets     | `'tickets'`     | Count of undispatched tickets  |
| Features    | `'features'`    | Count of all spec dirs         |
| Active runs | `'active-runs'` | Count of active + pending runs |
| History     | `'history'`     | —                              |

---

## View: TicketsView (scene 1 + sub-filters)

Renders the ticket inbox. Corresponds to renderings scene 01.

**Required data**:

- `tickets: Ticket[]` — from `speckit:ticket-list`
- `selectedTicket: Ticket | null`

**Sub-filters** (pill row):

- "Assigned to me" (always active)
- "Linear" — show only `source: 'linear'`
- "Jira" — show only `source: 'jira'`
- "Not yet dispatched" — show only tickets where `runRef === null`

**Ticket row elements** (per rendering):

- Source badge: `LINEAR` (indigo) or `JIRA` (blue)
- Ticket key (monospace)
- Title (ellipsis overflow)
- Priority tag + size tag
- Size estimate badge (S/M/L/XL) or run-status badge if dispatched

**Selected ticket detail** (right panel, scene 02):

- Full title + description + acceptance criteria list
- Dispatch sheet: autonomy level segmented control + per-phase gate toggles + "Start run" button

**Dispatch sheet constraints**:

- Self-Review and Open PR gate toggles are locked ON and not editable
- Constitution gate toggle auto-labeled (first run skips if constitution exists)
- "Start run" button disabled if no `.specify/` dir detected in the repo

---

## View: FeaturesView (scene 1 — Features tab)

Lists all `specs/NNN-slug/` dirs. Each row: feature slug, mini phase rail (10 dots), last modified.

---

## View: RunDashboard (scenes 03–07)

The main view when a run is active or at a gate. Appears for both Active runs sub-view and when a dispatched ticket row is clicked.

**Required data**:

- `state: PilotState` — from `speckit:pilot-state` + `speckit:state-changed` push
- `runOutput: string[]` — accumulated from `speckit:run-output` push events

**Elements**:

- Run header: ticket badge, feature dir path, worktree path, autonomy badge
- Phase rail: 10 nodes, each showing done / active / review / pending / locked state per rendering legend
- Streaming console: scrolling log of `runOutput` lines
- Gate panel (when `phaseStatus === 'awaiting_review'`) — see GatePanel below
- Batch check-in panel (when Implement hits section boundary) — see CheckIn below

---

## View: GatePanel (scene 04, 06)

Rendered inside RunDashboard when the current phase is `awaiting_review`.

**Elements**:

- Phase artifact preview (read-only, syntax-highlighted for markdown)
- Feedback textarea (for "Request changes" note)
- Action buttons:
  - Edit artifact (opens inline editor)
  - Diff vs HEAD
  - Reject & re-run → triggers `speckit:phase-request-changes`
  - Approve → next phase → triggers `speckit:phase-approve`
- History collapse row: links to `history.jsonl` summary

**For Self-Review gate (scene 06)**:

- Quality gate rows: Format / Lint / Tests / Coverage / /google-review
- Each row: pass/warn icon + name + metric value + optional progress bar
- Agent review summary card
- Actions: Back to Implement (re-run) | Approve → Open PR

**For Open PR gate (scene 07)**:

- PR card showing title, branch, changes stats, traceability (ticket key + spec link), write-back status
- PR description preview
- Actions: Open in GitHub | Next ticket | Open in Code Reviews (routes to git-integration PR review)

---

## View: BatchCheckIn (scene 05)

Rendered inside RunDashboard during Implement when a batch boundary is reached.

**Elements**:

- Kanban board (4 columns: Todo / In progress / In review / Done)
- Check-in banner: batch label, prose summary, partial diff button
- Actions: Partial diff | Split to follow-up ticket | Pause | Continue to next batch

---

## View: HistoryView

Completed run log. Simple table with columns:

| Column                    | Source                               |
| ------------------------- | ------------------------------------ |
| Ticket key + source badge | `PilotState.ticket`                  |
| Feature dir               | `PilotState.featureDir`              |
| PR URL (link)             | `PilotState.prUrl`                   |
| Final status              | `PilotState.run.status`              |
| Completed at              | Last `history.jsonl` entry timestamp |

---

## View: SettingsView (scene 08)

Three sections (matching rendering):

**1. Ticket integrations**

- Linear: API key input (masked) + Connected/Disconnected badge + team filter input
- Jira: Domain + email + API token + JQL input (editable) + Connected badge

Credentials are submitted via `speckit:credentials-set`. The form never receives the stored credential back — only the `connected` boolean and `email`/`domain` for display.

**2. Autonomy & phase gates**

- Default autonomy segmented control (Guided / Standard / Fast)
- Required gates toggle grid (10 toggles; Self-Review + Open PR locked ON)
- Batch check-ins toggle
- Write status back to tracker on PR open toggle

**3. Agent runner**

- Model selector (default: `claude-opus-4-6`)
- Isolation selector (default: `worktree`)
- Disallowed paths display (chip list)

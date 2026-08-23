# Feature Specification: Tracker issues attached to projects

**Feature Branch**: `031-linear-project-integration`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "~/Desktop/terminator-linear-integration/PLAN.md use the mockups in the same folder for reference on the look and feel. Keep in mind that linear issue contents are written in markdown so we should render them when opened as markdown"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Connect your trackers once, in one place (Priority: P1)

The operator opens application settings, finds a single Integrations section listing Linear and Jira, and connects either or both. Each credential is confirmed against that tracker before it is kept. From that moment every part of the application that wants issue data has it. There is no second place to paste a credential, and no part of the application asks for one again.

**Why this priority**: Nothing else in this feature can happen without it, and today both credentials are owned by one extension — invisible to the rest of the application and lost if that extension is removed. This story alone replaces two hidden, single-consumer credentials with shared, visible ones.

**Independent Test**: Connect each tracker in settings; each reports connected and names the account. Enter an invalid credential; it is rejected at the point of entry and nothing is stored. Restart the application; both are still connected.

**Acceptance Scenarios**:

1. **Given** no tracker is connected, **When** the operator enters a valid Linear API key, **Then** the settings section reports Linear connected and shows the account name and email that key belongs to.
2. **Given** no tracker is connected, **When** the operator enters valid Jira credentials, **Then** the settings section reports Jira connected and shows the site and account they belong to.
3. **Given** either tracker, **When** the operator enters an invalid or revoked credential, **Then** the entry is rejected with a plain error, and nothing is saved.
4. **Given** a tracker is connected, **When** the operator restarts the application, **Then** it is still connected without re-entry.
5. **Given** both trackers are connected, **When** the operator disconnects one, **Then** that tracker's credential is destroyed, its surfaces revert to unconnected, and the other tracker is unaffected.
6. **Given** Linear or Jira credentials were previously stored by the SpecKit Pilot extension, **When** the operator opens the application for the first time after this feature ships, **Then** they are already connected and are never asked to enter those credentials again.
7. **Given** both trackers are connected and both have an issue with the same key, **When** issues are listed anywhere, **Then** the operator can tell which tracker each belongs to.

---

### User Story 2 - Attach an issue to a project (Priority: P1)

The operator right-clicks a project, picks "Link issue…", and gets their assigned issues from every connected tracker without typing anything. They pick one. The project header now carries the issue key and a dot showing whether the issue is unstarted, in progress or done. A project holds one issue at a time. The link survives restarts and is removed when the project is removed.

**Why this priority**: This is the association the operator asked for. Everything downstream — reading the issue, feeding it to an agent, creating a project from it — depends on a project knowing which issue it is for.

**Independent Test**: Link an issue to a project; the key appears on the project's header in the sidebar; restart and it is still there; unlink and it is gone.

**Acceptance Scenarios**:

1. **Given** at least one tracker is connected and a project has no issue, **When** the operator opens the project's context menu, **Then** "Link issue…" is offered.
2. **Given** the link picker is open, **When** it first appears, **Then** the operator's assigned issues from every connected tracker are already listed, with key, title, state and which tracker they came from, and no search is required.
3. **Given** the link picker is open, **When** the operator types text, **Then** matching issues are listed; when they type an issue key exactly, that issue is offered directly.
4. **Given** an issue is selected, **When** the operator confirms, **Then** the project header shows the issue key with a state indicator, and the association persists across restarts.
5. **Given** a project already has an attached issue, **When** the operator picks a different one, **Then** they are told the current issue will be replaced, and on confirming the project holds only the new issue.
6. **Given** a project has a linked issue, **When** the operator opens its context menu, **Then** they can open the issue in its tracker, copy its key, change the linked issue, or unlink it.
7. **Given** a project has a linked issue, **When** that project is removed, **Then** the association is discarded with it and leaves nothing behind.
8. **Given** no tracker is connected, **When** the operator opens the link picker, **Then** they are told to connect in settings and offered a way to get there, rather than shown an empty list.

---

### User Story 3 - Agent sessions start knowing the issue (Priority: P1)

The operator opens a terminal in a project that has a linked issue and starts an agent session. Without pasting anything, the agent already knows the issue key, title, state, description and recent discussion. This holds for a session the operator starts themselves at a shell prompt in that project's directory, not only for sessions the application launches.

**Why this priority**: The second half of what the operator asked for, and the part that removes daily copy-paste. Without it the association is a bookmark.

**Independent Test**: Link an issue to a project, start an agent session in that project, and ask it what it is working on. It answers with the issue, having never been told in that session.

**Acceptance Scenarios**:

1. **Given** a project with a linked issue and context feeding on, **When** an agent session starts in that project, **Then** the agent can state the issue key, title, state and the substance of its description without being told.
2. **Given** the same project, **When** the operator starts an agent session by hand at a shell prompt in that directory rather than through the application, **Then** the same context is present.
3. **Given** a session has just started with issue context, **When** it appears, **Then** the operator is shown that it happened and how much context was supplied.
4. **Given** a project with a linked issue, **When** the operator turns context feeding off for that project, **Then** new sessions receive nothing, and the previous session's behaviour is unaffected.
5. **Given** an issue whose description and discussion exceed the amount that can be supplied, **When** context is prepared, **Then** it is deliberately shortened, the operator can see it was shortened and by how much, and a pointer to the full issue is included.
6. **Given** a project with a linked issue, **When** the operator unlinks it, **Then** new sessions receive no issue context and nothing the feature added is left inside the project's directory.

---

### User Story 4 - Read the issue without leaving the application (Priority: P2)

The operator clicks the issue key on a project header and a panel opens showing the issue as it reads in its tracker: headings, lists, checklists, links, inline and fenced code, tables and quotes all rendered — not raw markup. State, assignee and labels are shown, along with recent comments, also rendered. They can refresh it, comment on it, or open it in its tracker.

**Why this priority**: Referencing the issue "as necessary" is the operator's stated reason for the association. Reading a description as raw markup is materially worse than reading it in the tracker, which defeats the point. It is P2 only because the association and the agent feed deliver value before it exists.

**Independent Test**: Link an issue whose description contains headings, a nested list, a task list, a fenced code block, a table and a link; open the panel; every element renders as formatted content, and the link opens in the browser rather than inside the application.

**Acceptance Scenarios**:

1. **Given** a linked issue, **When** the operator clicks the issue key on the project header, **Then** a panel opens showing key, title, state, assignee, labels and last-updated.
2. **Given** an issue whose description uses markdown, **When** the panel renders it, **Then** headings, ordered and unordered lists, task lists, tables, block quotes, inline code, fenced code blocks, bold/italic and links all appear as formatted content, never as literal markup characters.
3. **Given** a rendered description containing a link, **When** the operator activates it, **Then** it opens in their browser and the application does not navigate.
4. **Given** an issue description containing embedded markup or scripting, **When** it is rendered, **Then** it is displayed as inert text and nothing in it can execute or alter the application.
5. **Given** the panel is open, **When** the operator refreshes, **Then** current issue data is fetched and shown, bypassing any cached copy.
6. **Given** the panel is open, **When** the operator adds a comment, **Then** it appears on the issue in its tracker and in the panel's comment list; if it fails to post, the operator is told and their text is not lost.
7. **Given** the panel is open, **When** the operator looks at the agent-context section, **Then** they see the exact text an agent session would receive and its size against the maximum.

---

### User Story 5 - Start a project from an issue (Priority: P2)

Creating a new project, the operator chooses to start from a tracker issue. Picking the issue fills in the project name and the branch — using the branch name the tracker itself suggests where it offers one — and the project is created already linked, with context feeding on.

**Why this priority**: Collapses issue → project → working copy → informed agent session into one dialog. Valuable, but every step of it can already be done manually once User Stories 2 and 3 exist.

**Independent Test**: Create a project from an issue; the name and branch are prefilled from the issue and remain editable; on creation the project is already linked to that issue.

**Acceptance Scenarios**:

1. **Given** the new-project dialog and a connected tracker, **When** the operator chooses to start from an issue, **Then** they can pick one from their assigned and recent issues.
2. **Given** an issue is picked, **When** the dialog updates, **Then** project name and branch are prefilled from the issue — branch using the tracker's own suggested branch name where it provides one, otherwise derived from the issue's key and title — and every field stays editable.
3. **Given** the operator creates the project, **When** it appears, **Then** it is already linked to that issue and shows its key.
4. **Given** the operator edits the prefilled name or branch before creating, **When** the project is created, **Then** their edits are honoured and the link is still made.

---

### User Story 6 - One connection behind every surface (Priority: P3)

Every part of the application that shows issue data — the board that imports assigned issues into cards from both Linear and Jira, the pull-request view that finds issue references in a PR description — reads the same connections and the same cached data. No component holds its own credential. The pull-request view, which today can only show a bare issue key it scraped from text, shows that issue's title and state.

**Why this priority**: The unification the operator asked for, and the payoff that stops the next surface from becoming a fourth silo. It is P3 because the operator sees no new capability from most of it — existing behaviour is preserved, not extended — except for the enriched pull-request references.

**Independent Test**: Disconnect a tracker in settings; every issue-dependent surface, including the board's issue import, reports not-connected for it. Reconnect; all of them work again, with the credential entered exactly once.

**Acceptance Scenarios**:

1. **Given** trackers are connected in settings, **When** the board imports assigned issues, **Then** it works without any credential of its own and produces the same cards it produces today, for both trackers.
2. **Given** a tracker is connected, **When** the pull-request view shows an issue reference found in a PR description, **Then** it shows the issue's title and state alongside the key.
3. **Given** several surfaces request the same issue at the same time, **When** they render, **Then** they show the same data and the tracker is not queried once per surface.
4. **Given** a tracker is disconnected, **When** any issue-dependent surface is opened, **Then** it reports that the tracker is not connected rather than failing silently or showing stale data as current.
5. **Given** the pull-request-opened comment setting is off, **When** a pull request opens for a card with an attached issue, **Then** nothing is written to the tracker.
6. **Given** that setting is on, **When** a pull request opens, **Then** a comment appears on the issue, and if it cannot be posted the operator is told rather than the failure being discarded.
7. **Given** the SpecKit Pilot extension is removed from the installation, **When** the operator attaches, reads and feeds an issue, **Then** all of it still works.

---

### Edge Cases

- **Credential rejected mid-use.** A credential that was valid is revoked in the tracker. Surfaces must report a connection problem and point at settings, not present empty results as "no issues assigned to you".
- **Rate limiting.** The tracker refuses further requests for a period. The application must wait out the stated period and retry rather than hammering it, and must not lose the operator's action.
- **Offline.** No network. Cached issue data may be shown, clearly marked as of its fetch time; agent context is still fed from the last known copy rather than nothing.
- **Issue deleted, archived, or moved out of reach** while linked. The project must not be broken by it — the badge shows the issue as unavailable and the operator can unlink or relink.
- **Issue changes after linking** — retitled, reassigned, moved to done. The badge and panel reflect it on next refresh; a completed issue on a live project is shown as such, not treated as an error.
- **Empty or absent description.** The panel and the agent context must both read sensibly rather than showing an empty region.
- **Very large description or a long comment thread.** Both the panel and the agent context stay usable; the context is shortened deliberately and visibly.
- **Markdown that is malformed, or that contains embedded markup, scripts, or images pointing at remote or local resources.** It renders as inert text; nothing loads or executes on the operator's behalf.
- **Two projects linked to the same issue.** Permitted; each keeps its own context-feeding setting.
- **Both trackers connected and both have an issue with the same key.** Every list, badge and association must stay unambiguous about which tracker an issue came from.
- **One tracker connected, the other not.** Pickers and lists show what is available and say plainly that the other is not connected — never an empty list with no explanation.
- **One tracker fails while the other succeeds** during a combined fetch. The operator sees the issues that were retrieved and is told which tracker failed and why, rather than getting a partial list presented as complete.
- **A tracker that does not supply a suggested branch name.** The branch is derived from the issue's key and title instead, and remains editable.
- **A comment fails to post** — bad addressing, permissions, or the tracker rejecting it. The operator is told, and their text is preserved. This must never be swallowed.
- **The same issue is already represented as a board card.** Linking a project to it must not create a duplicate card or disturb the existing one.
- **Project directory is not writable, or the operator's own agent configuration in it already exists.** Context feeding must fail loudly with a clear reason and must never damage or overwrite configuration the operator wrote.
- **Project removed or its directory deleted** while linked. The association and anything the feature stored for it are cleaned up.

## Requirements _(mandatory)_

### Functional Requirements

**Connection and credentials**

- **FR-001**: The application MUST provide exactly one place to connect an issue tracker, and MUST NOT ask for the same credential anywhere else.
- **FR-002**: The application MUST verify a credential against the tracker before storing it, and MUST reject an invalid one at the point of entry without storing anything.
- **FR-003**: The application MUST store tracker credentials encrypted using the operating system's own credential protection, and MUST NOT expose a stored credential to any consuming surface, only whether a connection exists and which account it belongs to.
- **FR-004**: The application MUST adopt the Linear **and** Jira credentials already stored by the SpecKit Pilot extension on first run, so no operator re-enters a credential they have already provided.
- **FR-005**: The application MUST allow disconnecting each tracker independently, which destroys that tracker's stored credential and returns every dependent surface to its unconnected state for that tracker.
- **FR-006**: The application MUST let the operator define which issues count as theirs, per tracker — by account for a tracker that identifies assignees directly, and by a saved query for a tracker that expresses it that way — defaulting to the account the credential belongs to where the tracker supports it.
- **FR-006a**: The application MUST support both trackers being connected at once, and MUST keep their issues distinguishable everywhere an issue appears, including when two trackers use the same issue key.

**Association**

- **FR-007**: The operator MUST be able to attach a tracker issue to a project, change which issue is attached, and detach it.
- **FR-008**: The application MUST persist an association across restarts and MUST discard it when its project is removed.
- **FR-009**: The application MUST display an attached issue's key on that project in the sidebar, together with an indicator of the issue's state that is distinguishable without relying on colour alone.
- **FR-010**: The application MUST offer, for a project with an attached issue: open in the tracker, copy the issue key, change the issue, and detach.
- **FR-011**: The application MUST allow creating a project from an issue, prefilling the project name and the branch from that issue — using the tracker's own suggested branch name where it provides one — with every field remaining editable, and MUST attach the issue to the resulting project.
- **FR-012**: The application MUST let an extension attach an issue to a project it creates, so an extension that already knows a card's issue does not need its own association.

**Reading the issue**

- **FR-013**: The application MUST show an attached issue's key, title, state, assignee, labels, last-updated time, description and recent comments.
- **FR-014**: The application MUST render issue descriptions and comments as formatted markdown — at minimum headings, ordered and unordered lists, task lists, tables, block quotes, inline code, fenced code blocks, emphasis, and links — and MUST NOT display raw markup to the operator.
- **FR-015**: The application MUST treat issue content as untrusted remote text: embedded markup and scripting MUST be rendered inert, and no content in an issue may cause the application to navigate, execute, or fetch on the operator's behalf without the operator activating it.
- **FR-016**: The application MUST open links found in issue content in the operator's browser, never inside the application.
- **FR-017**: The operator MUST be able to force a refresh of an issue, bypassing any cached copy.
- **FR-018**: The operator MUST be able to comment on an attached issue from within the application.

**Feeding agent sessions**

- **FR-019**: The application MUST make an attached issue's key, title, state, description and recent discussion available to an agent session started in that project's directory, without the operator supplying it.
- **FR-020**: FR-019 MUST hold for a session the operator starts themselves at a shell prompt in that directory, not only for sessions the application launches.
- **FR-021**: The application MUST let the operator turn issue feeding on or off per project, and MUST provide a default for newly attached issues.
- **FR-022**: The application MUST shorten issue context that exceeds what a session can accept, and MUST make both the shortening and a pointer to the full issue visible.
- **FR-023**: The operator MUST be able to see the exact text an agent session would receive, and its size against the maximum, before a session starts.
- **FR-024**: The application MUST tell the operator when a session has started with issue context, through the existing notification system so that it can be turned down or off.
- **FR-025**: Anything the application writes into a project's directory to achieve FR-019 MUST be confined to a region it owns, MUST NOT modify or discard configuration the operator wrote, and MUST be removed completely on detach.
- **FR-026**: The application MUST report a plain, actionable failure when it cannot feed context, rather than starting a session that silently lacks it.

**One shared connection**

- **FR-027**: Every surface in the application and every extension that reads issue data MUST do so through the single connection of FR-001, and MUST NOT hold a tracker credential or contact the tracker directly.
- **FR-028**: The application MUST serve repeated requests for the same issue from a shared short-lived cache, so that several surfaces asking at once result in one request to the tracker.
- **FR-029**: The application MUST preserve the board's existing behaviour of importing assigned issues as cards and advancing cards whose issue is complete, for both trackers, with no credential of its own.
- **FR-030**: The application MUST show issue title and state alongside issue references found in pull request descriptions.
- **FR-031**: The application MUST honour a rate-limit refusal by waiting the period the tracker states before retrying, without losing the operator's action.
- **FR-032**: The application MUST distinguish, in every dependent surface, between "not connected", "connection failed" and "no results", and MUST NOT present one as another.

**Scope decisions**

- **FR-033**: A project MUST have at most one attached issue. Attaching a second issue replaces the first rather than adding to it, and the operator MUST be told that is what will happen before it happens.
- **FR-034**: Writing back to the tracker MUST be limited to comments. The application MUST NOT change an issue's state, assignee, or any other field. Comments MUST be either operator-initiated (FR-018) or, for the board's existing pull-request-opened comment, governed by a setting that is **off by default** (FR-034a). No other automatic write exists.
- **FR-034a**: The board's existing behaviour of commenting on an issue when a pull request opens MUST be preserved behind an explicit, default-off setting. Because that write currently fails silently, the application MUST verify it succeeds and MUST surface a failure to the operator rather than discarding it.
- **FR-035**: This feature MUST cover both Linear and Jira. Both MUST connect through the single place of FR-001, MUST be stored and served by the same mechanism, and MUST present the same issue shape to every consuming surface. No tracker credential may remain owned by an extension after this feature ships.

### Key Entities

- **Tracker connection**: A verified credential for one issue tracker, plus which account it belongs to and how "my issues" is defined for it. At most one per tracker, at least two trackers supported (Linear, Jira), owned by the application, never handed to a consumer.
- **Issue**: A tracker's unit of work as the application understands it — which tracker it came from, stable identifier, human key, title, description in markdown, state and state category, assignee, labels, suggested branch name where the tracker offers one, completion, last-updated time, and recent comments. The same shape regardless of tracker, and identified by tracker plus key so two trackers may share a key.
- **Association**: A project's attachment to exactly one issue, plus whether that issue is fed to agent sessions in that project. Lives and dies with its project.
- **Agent context**: The text derived from an associated issue that an agent session receives, together with its size and whether it was shortened.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An operator connects each issue tracker exactly once and no part of the application asks for that credential again.
- **SC-002**: An operator attaches an issue to a project in under 20 seconds from the project's context menu, without typing an issue key.
- **SC-003**: An agent session started in a project with an attached issue can correctly state the issue's key, title and current state on its first response, with no operator input in that session.
- **SC-004**: Copy-and-paste of issue text into agent sessions is eliminated for projects with an attached issue — measured as zero pastes needed to brief a new session.
- **SC-005**: An issue description containing headings, lists, task lists, tables, code blocks and links displays as formatted content, with no literal markup characters visible to the operator.
- **SC-006**: An operator can tell, before starting a session, exactly what an agent will be told about the issue and whether anything was left out.
- **SC-007**: Attaching, reading and feeding an issue continue to work with the SpecKit Pilot extension removed from the installation.
- **SC-008**: Five surfaces displaying the same issue within the same few minutes result in no more than one request to the tracker.
- **SC-009**: An invalid credential is rejected at the point of entry 100% of the time and is never stored.
- **SC-010**: Detaching an issue leaves nothing behind in the project's directory — verified by comparing the directory before attachment and after detachment.
- **SC-011**: Existing board behaviour — importing assigned issues as cards, advancing cards whose issue is complete — is unchanged for both Linear and Jira after the credentials move out of the extension.
- **SC-012**: After this feature ships, no tracker credential is stored or requested anywhere outside the single Integrations section — verified by removing every extension and confirming both trackers still work.
- **SC-013**: Attaching, reading and feeding an issue behave identically whichever tracker the issue came from, differing only where the tracker genuinely offers less.
- **SC-014**: No issue field other than its comments is ever modified by the application; the one automatic comment is off unless the operator turns it on, and a comment that fails to post is reported 100% of the time.

## Assumptions

- Issue descriptions and comments are authored in markdown, and are untrusted remote content that must be rendered but never trusted to run.
- Feeding issue context to agent sessions defaults to on when an issue is attached, and is reversible per project.
- Cached issue data is considered current for a few minutes; anything longer risks acting on a stale state, anything shorter wastes the tracker's rate budget. The operator can always force a refresh.
- "Recent comments" means the most recent handful, newest first, not the whole thread. A long thread is read in the tracker itself.
- The look and feel follows the mockups in `~/Desktop/terminator-linear-integration/mockups.html` — the issue key as a monospace badge on the project header, a right-hand panel for the issue, and a new Integrations section in settings listing every tracker — and the application's existing tokens, row geometry and flat icon rules. The mockups show Jira as a not-connected row; with Jira in scope that row is live, not a placeholder.
- Both trackers describe issue content in markdown, and both are rendered by the same renderer. Where a tracker's markup differs, it is normalised to markdown before rendering rather than given its own renderer.
- Jira offers no equivalent of Linear's suggested branch name, so branch prefill falls back to key-and-title for it. This is expected, not a gap to close.
- Attaching an issue to a project does not create, modify, or reconcile a board card, and importing an issue as a card does not by itself attach it to a project. The two associations are independent unless an extension chooses to make both.
- The operator has an issue tracker account and can obtain an API credential for it; provisioning and organisation-level administration are out of scope.
- Creating, editing, closing, estimating, or otherwise managing issues from within the application is out of scope. This feature reads issues and, at most, comments on them.
- The board's existing behaviour of commenting on an issue when a pull request opens is preserved, but off by default (FR-034a). Operators who rely on it today must turn it back on; that change is stated plainly in the release, not slipped in.
- That comment currently fails silently. Whether it works at all today is unverified, so it is treated as unproven and must be verified against both trackers before FR-034a is considered met.

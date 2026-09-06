# Feature Specification: Foundry — a software factory

**Feature Branch**: `037-foundry-software-factory`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "https://claude.ai/code/artifact/d381abc7-1b92-494c-9e6c-5d7710c65f37 go with your recommendation on the questions in that artifact"

## Overview

Today the operator's agent pipeline runs one fixed shape for every piece of work: ten named stages in a fixed order, with an approval required after nine of them, and it only functions in a repository that has already had a particular specification toolkit installed into it. A one-line fix costs the same ceremony as a new subsystem, the operator is asked to approve twenty-seven times when three pieces of work run at once, and the whole thing is unusable in any other repository.

Foundry replaces that shape with two loops and one agreement between them.

- **The Forge** turns an idea — typed, or taken from a tracker issue — into an agreed **work order**, by conversation with an agent. It ends when the order passes a fixed set of completeness checks, not when the operator feels it is finished.
- **The Line** takes the agreed work order and delivers it: it chooses the shape of work that fits, does the work in parallel where the work allows, has every piece checked by someone other than whoever produced it, inspects for security risk when the change warrants it, and opens a draft pull request for review.

The operator supplies inputs — an idea, answers to a small number of questions, corrections to stated assumptions, and a final review. Agents do the work.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Agree the work before any of it starts (Priority: P1)

The operator types an idea, or picks an issue from their tracker. An agent reads the repository first, then drafts a complete work order — what the problem is, what "done" looks like as a list of criteria each paired with the way it will be proven, what the plan is, what it will deliberately not do, and what it is assuming. The operator's job is to scan the assumptions, strike the wrong ones, and answer at most a few questions that the agent genuinely could not answer from the code. A separate agent then attacks the order looking for holes. The order is finished when a fixed set of completeness checks all pass — including that every "done" criterion is covered by planned work and every piece of planned work exists to satisfy a criterion.

**Why this priority**: It is the agreement everything else depends on, and it delivers value on its own — the operator gets a checkable statement of work even if they then do the work by hand. It also removes the failure that has cost this project most: work that is individually correct and collectively incomplete.

**Independent Test**: Seed an idea and a tracker issue. In both cases a complete draft appears without the operator answering anything first. Strike an assumption and the affected part of the plan is redrawn. Deliberately leave a "done" criterion with no matching work and the order refuses to be marked agreed, naming the gap.

**Acceptance Scenarios**:

1. **Given** no work order exists, **When** the operator types a one-sentence idea, **Then** a complete draft work order appears containing intent, criteria for done, a plan, exclusions and stated assumptions, without the operator having answered any question.
2. **Given** a connected tracker, **When** the operator selects an issue, **Then** the draft is seeded from that issue's title, description and discussion, and the order records which issue it came from.
3. **Given** a draft work order, **When** the operator views it, **Then** every criterion for done is paired with a stated way of proving it, and any criterion whose proof is not executable is flagged as incomplete.
4. **Given** a draft work order, **When** the operator strikes a stated assumption, **Then** only the parts of the plan that depended on it are redrawn, and the completeness checks re-evaluate.
5. **Given** a draft work order, **When** the operator looks for what is being asked of them, **Then** they are shown no more than three open questions at a time, each with its options and a recommended answer.
6. **Given** a criterion for done that no planned work satisfies, **When** the operator attempts to agree the order, **Then** it is refused and the uncovered criterion is named.
7. **Given** planned work that satisfies no criterion for done, **When** the operator attempts to agree the order, **Then** it is refused and the unattached work is named.
8. **Given** a draft that otherwise passes, **When** the adversarial review has not finished or has unresolved findings, **Then** the order cannot be agreed until each finding is resolved or explicitly accepted with a stated reason.
9. **Given** an agreed work order, **When** the operator later amends it, **Then** it returns to draft, the completeness checks re-run, and the amendment is recorded.

---

### User Story 2 - Run each job in the shape it deserves (Priority: P1)

The operator's work is not all one kind. A one-line fix, a bug that needs reproducing first, a refactor that must not change behaviour, a throwaway investigation and a new subsystem are five different jobs. Foundry picks a named shape of work to fit the order — the operator can override the choice — and runs it. The existing ten-stage specification pipeline remains available as one of those shapes, offered only where the repository actually supports it.

**Why this priority**: This is the operator's stated complaint. Without it every job pays the heaviest job's cost, and the tool remains unusable outside one repository.

**Independent Test**: Run a one-line change and a new feature through Foundry. They take visibly different routes with different numbers of steps. Run the same feature in a repository lacking the specification toolkit and the pipeline shape is not offered, while the others still work.

**Acceptance Scenarios**:

1. **Given** an agreed work order for a small, low-risk change, **When** work starts, **Then** a short shape is used and the operator is told which shape was chosen and why.
2. **Given** an agreed work order for a bug, **When** work starts, **Then** the shape requires a failing reproduction to exist and fail before any fix is written.
3. **Given** an agreed work order, **When** the operator disagrees with the chosen shape, **Then** they can select a different one before work starts, and the override is recorded.
4. **Given** a repository that does not support a particular shape, **When** shapes are offered, **Then** that shape is not offered, and the reason is available.
5. **Given** planned work with no dependency between two pieces, **When** work runs, **Then** those pieces run at the same time, up to the agreed limit on how many agents may run at once.
6. **Given** planned work where one piece depends on another, **When** work runs, **Then** the dependent piece does not start until the piece it depends on has been verified.
7. **Given** the operator wants a shape Foundry does not ship, **When** they define their own, **Then** it becomes selectable without changing the application and without adding anything to the repository being worked on.

---

### User Story 3 - Nothing is trusted on its own say-so (Priority: P1)

Every piece of finished work is checked by a party other than whoever produced it, using evidence rather than the producer's summary. Checks run as early as they can rather than all at the end: formatting and linting as files are written, the piece's own tests as it finishes, the repository's own full checks after that, then an independent judgement of whether the criterion for done was actually met, then a security inspection when the change touches something that warrants one. A check that cannot run in this repository reports that it could not run — never that it passed.

**Why this priority**: The recurring failure in this project's history is work reported complete that was not. Independent verification is what makes leaving agents unattended defensible at all.

**Independent Test**: Complete a piece of work whose tests pass but which does not actually satisfy its criterion; the independent check rejects it and cites what it looked at. Run the same order in a repository with no lint step; the lint result reads "not measured", and the order does not claim it passed.

**Acceptance Scenarios**:

1. **Given** a piece of work an agent believes is finished, **When** it is checked, **Then** it is checked by a different party with no access to the producer's reasoning, using only the change itself and the criterion it claims to satisfy.
2. **Given** a check that produces a pass/fail result, **When** the verdict is recorded, **Then** it cites the evidence it was derived from, and the evidence is retrievable afterwards.
3. **Given** a repository that has no coverage step, **When** the coverage check is reached, **Then** the result is "not measured" with the reason, and it is not counted as a pass.
4. **Given** a test suite that reports failures but exits successfully, or exits unsuccessfully while printing passes, **When** the verdict is derived, **Then** it follows the command's exit status rather than its printed summary.
5. **Given** a change that alters the user interface, **When** it is checked, **Then** the evidence includes a picture of the running application, not only structural assertions.
6. **Given** a piece of work that fails its check twice, **When** a third attempt would begin, **Then** it stops and asks the operator instead, showing what was tried and why each attempt failed.
7. **Given** a change that touches authentication, payments, secrets, a data migration, a published interface, adds a dependency, or opens an outbound network call, **When** work completes, **Then** a security inspection runs over the change and its findings are attached.
8. **Given** a change that touches none of those, **When** work completes, **Then** no security inspection runs and the record says so explicitly.
9. **Given** the repository states its own conventions, **When** work is checked, **Then** those conventions are enforced as checks alongside the universal ones; **and given** the repository states none, **Then** only the universal ones apply.

---

### User Story 4 - Use it on any repository, with nothing installed (Priority: P1)

The operator points Foundry at any repository — one it has never seen, one belonging to someone else, one with a completely different language and toolchain — and it works. Nothing is added to that repository to make it work. Foundry finds out for itself how that project runs its tests, its linter, its formatter, its coverage and its end-to-end checks, and records what it found before any work begins. Where Foundry writes its own records is the operator's choice; if they have not chosen, it writes beside the working directory.

**Why this priority**: The operator's explicit requirement, and it constrains the design of everything above it — an agreed work order has to carry what was discovered about the project, because nothing can be assumed.

**Independent Test**: Run a complete order in a repository in a different language with no prior setup, no configuration committed and no scaffolding. It produces a work order and a draft pull request. Afterwards, the repository contains the change and nothing else Foundry put there.

**Acceptance Scenarios**:

1. **Given** a repository Foundry has never been used on, **When** the operator seeds an idea against it, **Then** intake proceeds with no setup step, no initialisation and nothing written into that repository.
2. **Given** any repository, **When** the repository is first read, **Then** the commands that project actually uses for testing, linting, formatting, coverage, end-to-end checks and building are discovered and recorded on the order.
3. **Given** a project with no such command for a given check, **When** that is discovered, **Then** it is recorded as absent, and the corresponding check later reports "not measured".
4. **Given** a repository that carries its own written conventions or house documents, **When** the repository is read, **Then** those are picked up and used; **and given** it carries none, **Then** intake still completes.
5. **Given** no location has been configured, **When** an order writes its records, **Then** they are written to a hidden folder beside the working directory, and the operator is told once that this folder is untracked.
6. **Given** the operator configures a location, **When** any order writes its records, **Then** they are written there instead, regardless of which repository the order is for.
7. **Given** a configured location that cannot be written to, **When** an order attempts to start, **Then** it stops with a plain message naming the location, and no work begins.
8. **Given** any order in any repository, **When** it finishes or is cancelled, **Then** the repository contains nothing Foundry added other than the change itself.

---

### User Story 5 - Be interrupted only when a rule fires, and take over when you want to (Priority: P2)

The operator has one place that lists everything wanting their attention, ordered by how much work each decision unblocks. Every item names the rule that raised it, shows the evidence behind it, and says what happens if it is ignored. Nothing else stops. An autonomy setting decides which rules are live. Separately and at all times, the operator can drop into the live session of any working agent and take over by hand.

**Why this priority**: This is the difference between nine approvals per job and nought to two. It depends on work actually running, so it follows the first three stories.

**Independent Test**: Run three orders at once. The list of things needing the operator contains only items a stated rule produced, ordered by how much each unblocks, and the count is far below one per stage. From any screen, reach a running agent's live session in one action and type into it.

**Acceptance Scenarios**:

1. **Given** several orders in flight, **When** the operator opens their list of outstanding decisions, **Then** each entry names the rule that raised it, the evidence, the available options and the consequence of ignoring it.
2. **Given** several outstanding decisions, **When** they are listed, **Then** they are ordered so that the decision unblocking the most work, weighted by risk, appears first.
3. **Given** a change carrying no risk trigger, no repeat failure and no budget breach, **When** work completes, **Then** the operator is not asked anything and the automatic decisions are recorded where they can be read afterwards.
4. **Given** the autonomy setting is at its most permissive, **When** work runs, **Then** the operator is still asked before anything is merged, before a destructive action, when a budget is exceeded, and when the change carries the highest risk grade.
5. **Given** a decision the operator has not answered, **When** its deadline passes, **Then** its stated default is applied and recorded as automatic; **and given** the default is to hold, **Then** nothing proceeds.
6. **Given** a running agent anywhere in either loop, **When** the operator chooses to take over, **Then** they are placed in that agent's live session and can type to it directly.
7. **Given** the operator has typed into an agent's session by hand, **When** they return to the structured view, **Then** it reflects what happened in the session rather than losing track of it.
8. **Given** an agreed budget on time, agent count or files touched, **When** it is exceeded, **Then** the work pauses and asks the operator rather than continuing or dying silently.

---

### User Story 6 - Ship as a draft pull request, and keep the tracker in step (Priority: P2)

Work does not end with a request for permission to open a pull request. Foundry pushes the branch and opens a **draft** pull request carrying the narrative, the verification verdicts and any inspection findings. The operator reviews a real change with real review tooling and decides whether to mark it ready and merge. Meanwhile, the issue the work came from receives the agreed work order as a comment, moves through its workflow states as work starts, reaches review and merges, and carries a link to each pull request.

**Why this priority**: It is what turns the final approval from rubber-stamping a promise into reviewing an actual change, and it removes the operator's manual tracker updates. It requires work to be completing first.

**Independent Test**: Complete an order; a draft pull request exists without the operator having approved its creation, and the linked issue shows the order summary, a moved state and the pull request link. Turn the setting off, and nothing is pushed until the operator says so.

**Acceptance Scenarios**:

1. **Given** an order whose work is complete and verified, **When** the final step runs, **Then** a draft pull request is opened without asking, containing a written summary of what was done, the verdict for each criterion, and any inspection findings.
2. **Given** an open draft pull request, **When** the operator is asked to decide, **Then** the decision offered is whether to mark it ready or merge — not whether to create it.
3. **Given** the automatic draft setting is turned off, **When** work completes, **Then** nothing is pushed and the operator is asked before the pull request is created.
4. **Given** an order graded at the highest risk levels, **When** work completes, **Then** the operator's risk decision is taken before anything is pushed to the remote.
5. **Given** an order seeded from a tracker issue, **When** the order is agreed, **Then** the issue receives the agreed work order as a comment, and again on any later amendment.
6. **Given** an order seeded from a tracker issue, **When** work starts, when a draft pull request opens, and when it merges, **Then** the issue moves to the matching workflow state each time.
7. **Given** a tracker whose workflow states do not match the expected names, **When** states are mapped, **Then** the available states are read from the tracker and the mapping is presented for the operator to adjust rather than guessed silently.
8. **Given** the tracker cannot be reached at the moment an update is due, **When** the update fails, **Then** the work is unaffected, the failure is recorded, and the update is retried.
9. **Given** an order not seeded from a tracker, **When** it completes, **Then** no tracker write is attempted.

---

### User Story 7 - One order across several repositories (Priority: P3)

A single piece of work sometimes spans more than one repository — a shared contract changes in one and is adopted in others. The operator agrees one work order for the whole thing. Foundry runs one stream per repository, in a declared order, and will not let a repository that consumes the change merge before the one that produces it. Files that more than one stream would touch are identified up front rather than discovered as a conflict.

**Why this priority**: The operator asked for it explicitly, and it settles where an order's records live, since a multi-repository order belongs to no single repository. It is P3 only because a single-repository order delivers the whole value of stories 1 through 6 first.

**Independent Test**: Agree one order that changes a shared contract in one repository and adopts it in another. Two streams appear, the consuming one is held until the producing one has merged, and the shared file is listed as a predicted collision before either starts.

**Acceptance Scenarios**:

1. **Given** an order that spans two repositories, **When** it is agreed, **Then** it declares one stream per repository, each with its own branch and its position in the merge order.
2. **Given** a stream that consumes something another stream produces, **When** work runs, **Then** the consuming stream does not merge until the producing stream has.
3. **Given** two streams that would touch the same file, **When** the order is agreed, **Then** that file is named as a predicted collision and the work that produces it is scheduled ahead of the work that consumes it.
4. **Given** a multi-repository order, **When** it ships, **Then** one draft pull request is opened per repository, each cross-linked to the others and to the order.
5. **Given** a multi-repository order seeded from a tracker issue, **When** the pull requests open, **Then** every one of them is linked on that single issue.
6. **Given** an order that touches one repository, **When** it runs, **Then** none of the above is visible and it behaves as a single stream.

---

### User Story 8 - The factory stops repeating what you reject (Priority: P3)

Every decision, rejection and reason is recorded. When the operator asks, Foundry reads that record for repetition and proposes new checks: "three of the last eight changes were rejected for the same reason — here is a rule that would have caught all three." The operator accepts, edits or rejects the proposal. Accepted rules apply from then on, across every repository.

**Why this priority**: It is what makes the tool improve rather than merely run. It needs a body of recorded decisions to exist first, so it comes last.

**Independent Test**: Reject three changes for the same stated reason, ask for proposals, and receive one rule naming those three rejections and describing what it would assert. Accept it, and the next change that would have repeated the mistake is caught before reaching the operator.

**Acceptance Scenarios**:

1. **Given** any decision taken by the operator or by a rule, **When** it is taken, **Then** it is appended to a permanent record with who or what decided, when, and why.
2. **Given** a record containing repeated rejections for the same reason, **When** the operator asks for proposals, **Then** each proposal cites the specific past rejections it is derived from and states what it would assert.
3. **Given** a proposed rule, **When** the operator accepts it, **Then** it applies to subsequent work; **when** they reject it, **Then** it is not proposed again.
4. **Given** an accepted rule that turns out to be wrong, **When** the operator removes it, **Then** it stops applying and the removal is recorded.
5. **Given** proposals are available, **When** the operator has not asked for them, **Then** none are raised unprompted.
6. **Given** a new order in any repository, **When** its context is gathered, **Then** past decisions affecting the same files are available as prior art.

---

### Edge Cases

- **A repository with no test, lint, format or coverage command at all.** Intake completes, every affected check reports "not measured", and the operator is told before work starts which checks will be unavailable — so the absence is a decision they make, not a surprise at the end.
- **A tracker issue that is only a title.** Intake proceeds; the missing detail becomes stated assumptions and, where genuinely undecidable, one of the small number of questions.
- **Striking an assumption that invalidates most of the plan.** The dependent parts are redrawn, the completeness checks fail again, and the order returns to draft rather than silently keeping stale work.
- **The adversarial review finds something after the order was agreed.** The order returns to draft and any work already started is paused, rather than continuing against a superseded agreement.
- **A piece of work fails its check twice.** The third attempt is not made automatically; the operator is shown both attempts and asked.
- **No remote, no push permission, or a detached checkout at the moment of shipping.** Work is preserved and the operator is told what blocked the pull request; nothing is discarded.
- **A tracker with no workflow state matching "in review".** The mapping is presented for the operator to set rather than guessed; an unmapped transition is skipped and recorded rather than failing the work.
- **A budget exhausted part-way through a piece of work.** The work pauses with its partial change intact and asks; it is neither killed nor allowed to run on.
- **An order cancelled mid-flight.** Every branch, working copy and temporary artefact it created is accounted for, and the operator is told what was removed and what was kept.
- **The same tracker issue seeded twice.** The operator is shown the existing order for that issue and offered it, rather than silently creating a duplicate.
- **A repository with uncommitted changes when work is about to start.** The operator is told before any work begins, because work runs against a known starting point.
- **Two orders wanting the same repository at the same time.** Each gets its own isolated working copy; neither observes the other's changes.
- **The configured records location is missing, unwritable, or on a volume that disappears.** No order starts, and the message names the location and the problem.
- **A criterion whose proof cannot be executed anywhere.** The order cannot be agreed; the operator must either make the proof executable or accept the criterion as unverifiable with a stated reason.

## Requirements _(mandatory)_

### Functional Requirements

#### Intake and the work order

- **FR-001**: The system MUST accept a new piece of work from a typed description or from an issue in a connected tracker.
- **FR-002**: The system MUST read the target repository before asking the operator anything.
- **FR-003**: The system MUST produce a complete draft work order on the first turn, containing intent, the outcome, explicit exclusions, discovered context, criteria for done, a plan of work, a risk assessment, budgets and stated assumptions.
- **FR-004**: The system MUST state anything it decided for itself as an assumption the operator can strike, rather than asking about it.
- **FR-005**: The system MUST ask the operator only what cannot be determined from the repository, the source issue or the project's own stated conventions.
- **FR-006**: The system MUST present no more than three open questions at a time, ordered by how much each would change the plan, and each MUST carry its options and a recommended answer.
- **FR-007**: The system MUST redraw only the parts of the order affected when an assumption is struck or a question answered.
- **FR-008**: The system MUST pair every criterion for done with a stated means of proving it: a command whose exit status decides the outcome, a named test, or an assessment against a written rubric with named evidence.
- **FR-009**: The system MUST subject every draft order to an adversarial review conducted without access to the intake conversation.
- **FR-010**: The system MUST refuse to mark an order agreed unless: no questions remain open; every criterion's proof is executable; every criterion is covered by at least one piece of planned work; every piece of planned work satisfies at least one criterion; risk has been graded; every adversarial finding is resolved or explicitly accepted with a reason; and budgets are set.
- **FR-011**: The system MUST name the specific failing condition when it refuses to mark an order agreed.
- **FR-012**: The system MUST return an agreed order to draft when it is amended, and re-run every completeness condition.
- **FR-013**: The system MUST record the origin of an order, and MUST offer the existing order when the same source issue is seeded again.

#### Shapes of work

- **FR-014**: The system MUST support more than one named shape of work and MUST select one to fit the order, stating why.
- **FR-015**: The system MUST allow the operator to override the selected shape before work begins, and MUST record the override.
- **FR-016**: The system MUST provide, at minimum, shapes for: a direct small change; a bug requiring reproduction before a fix; a general multi-part change; a refactor that must preserve behaviour; a time-boxed investigation that produces findings and no pull request; and the existing ten-stage specification pipeline.
- **FR-017**: The bug shape MUST require a reproduction that fails before any fix is written, and MUST require that reproduction to pass afterwards.
- **FR-018**: The refactor shape MUST require evidence that observable behaviour is unchanged.
- **FR-019**: The investigation shape MUST NOT open a pull request.
- **FR-020**: Each shape MUST declare what it requires of a repository, and MUST NOT be offered where those requirements are unmet.
- **FR-021**: The operator MUST be able to define additional shapes, agent roles and checks that become available without modifying the application and without adding anything to the repository being worked on.
- **FR-022**: Operator-defined shapes, roles and checks MUST take precedence over those supplied with the application; a definition carried by the repository being worked on MUST be honoured when present but MUST NEVER be required or created.

#### Execution

- **FR-023**: The system MUST run each piece of work in its own isolated working copy.
- **FR-024**: The system MUST run pieces of work with no dependency between them at the same time, up to the order's agreed agent limit.
- **FR-025**: The system MUST NOT start a piece of work before every piece it depends on has been verified.
- **FR-026**: The system MUST identify, at the time an order is agreed, any file more than one piece of work would touch, and MUST schedule the work that produces it ahead of the work that consumes it.
- **FR-027**: The system MUST run every agent in a live session the operator can enter and type into at any time.
- **FR-028**: The system MUST reflect anything the operator does by hand in such a session in its own view of that work, rather than losing track of it.
- **FR-029**: The system MUST hold every action an agent takes against a decision — automatic where the autonomy setting allows it, and by asking the operator where it does not.
- **FR-030**: The system MUST pause and ask the operator when an order's budget for time, agent count or files touched is exceeded, preserving work in progress.
- **FR-031**: The system MUST detect work that has stopped making progress and distinguish it from work that has exhausted a budget.

#### Verification

- **FR-032**: The system MUST have every completed piece of work checked by a party other than the one that produced it, given only the change and the criteria it claims to satisfy.
- **FR-033**: The system MUST derive verdicts from evidence — command output, exit status, named tests, pictures of the running application — and MUST NOT accept the producing agent's own account as evidence.
- **FR-034**: The system MUST retain the evidence behind every verdict and make it retrievable afterwards.
- **FR-035**: The system MUST run its checks as early as each can run: formatting and linting as files are written; a piece's own tests as it completes; the project's full checks after that; independent judgement of each criterion after that; security inspection over the accumulated change; and integration checks at merge.
- **FR-036**: The system MUST stop a piece of work at the first check it fails, rather than continuing to later checks.
- **FR-037**: The system MUST derive a command's verdict from its exit status, never from its printed summary.
- **FR-038**: The system MUST measure coverage per changed file rather than only as a project-wide total, wherever the project provides a means to do so.
- **FR-039**: The system MUST report a check it could not run as "not measured", with the reason, and MUST NOT count it as a pass.
- **FR-040**: The system MUST require a picture of the running application as evidence for a change that alters the user interface.
- **FR-041**: The system MUST stop and ask the operator when a piece of work has failed its check twice, showing every attempt and why each failed.
- **FR-042**: The system MUST apply a set of universal checks in every repository, and MUST apply a project's own stated conventions as additional checks only where that project states them.

#### Security inspection

- **FR-043**: The system MUST inspect a change for security risk when it touches authentication, payments, secrets, a data migration or a published interface, adds a dependency, opens an outbound network call, or writes outside the area the order declared.
- **FR-044**: The system MUST NOT run a security inspection when no such trigger is present, and MUST record that it did not and why.
- **FR-045**: The system MUST inspect the accumulated change rather than any single piece of work, so that a piece finishing early cannot avoid inspection.
- **FR-046**: The system MUST attach inspection findings, with severity, to the change and to the pull request that carries it.

#### Interruptions

- **FR-047**: The system MUST raise a request for the operator's attention only from a named rule, and every request MUST state that rule, its evidence, its options and what happens if it is ignored.
- **FR-048**: The system MUST present all outstanding requests in a single list, ordered by how much work each unblocks, weighted by risk.
- **FR-049**: The system MUST offer at least three autonomy settings that differ in which rules are live.
- **FR-050**: The system MUST always require the operator's decision — at every autonomy setting — before merging, before a destructive action, when a budget is exceeded, and when a change carries the highest risk grade.
- **FR-051**: Every request MUST carry a default and a deadline; an unanswered request MUST take its default and record that it was taken automatically.
- **FR-052**: The system MUST record every decision taken automatically where the operator can read it afterwards.

#### Shipping and trackers

- **FR-053**: The system MUST open a draft pull request as the final step of work, without asking, when the operator's setting for this is on; that setting MUST default to on.
- **FR-054**: When that setting is off, the system MUST NOT push anything until the operator has decided.
- **FR-055**: The system MUST take the operator's risk decision before pushing anything for an order graded at the two highest risk levels, and MUST open the draft pull request first for all lower grades.
- **FR-056**: A draft pull request MUST carry a written summary of the work, the verdict for every criterion, and any inspection findings.
- **FR-057**: The operator's decision on a completed order MUST be whether to mark the pull request ready or merge it, not whether to create it.
- **FR-058**: The system MUST write the agreed work order to the source issue as a comment on agreement, and again on any amendment.
- **FR-059**: The system MUST move the source issue's workflow state when work starts, when a draft pull request opens, and when it merges, for every tracker that supports being asked to.
- **FR-059a**: Where a connected tracker does not support workflow moves, the system MUST report that state write-back is unsupported for that tracker — at the point the order is agreed, not when the move is attempted — and MUST still perform the writes that tracker does support.
- **FR-060**: The system MUST read the available workflow states from the tracker and present the mapping for the operator to adjust, rather than assuming names.
- **FR-061**: The system MUST attach every pull request it opens to the source issue.
- **FR-062**: The system MUST allow tracker writes to be enabled or disabled per order, defaulting from the operator's configuration.
- **FR-063**: A failed tracker write MUST NOT affect the work; it MUST be recorded and retried. An unsupported write is not a failure: it is recorded once and not retried.
- **FR-064**: The system MUST reuse the application's existing tracker connections and MUST NOT ask for credentials of its own.

#### More than one repository

- **FR-065**: An order MUST be able to span more than one repository, with one stream per repository, each with its own branch, working copy and position in the merge order.
- **FR-066**: The system MUST NOT merge a stream that consumes a change before the stream that produces it has merged.
- **FR-067**: The system MUST open one draft pull request per repository, each cross-linked to the others and to the order.
- **FR-068**: An order touching a single repository MUST behave as a single stream, with none of the above visible.

#### Portability and records

- **FR-069**: The system MUST work against any repository with no setup step and nothing added to that repository.
- **FR-070**: The system MUST NOT create or modify any file in a repository other than the change the order asked for.
- **FR-071**: The system MUST discover, and record on the order, the commands the target project actually uses for testing, linting, formatting, coverage, end-to-end checks and building.
- **FR-072**: The system MUST record a command it could not discover as absent, and the corresponding check MUST later report "not measured".
- **FR-073**: The system MUST use a project's own written conventions where they exist, and MUST complete intake where they do not.
- **FR-074**: The system MUST write its records to an operator-configured location; where none is configured it MUST write to a hidden folder beside the working directory and tell the operator once that the folder is untracked.
- **FR-075**: The system MUST refuse to start an order when its records location cannot be written to, naming the location and the problem.
- **FR-076**: The system MUST keep every record for an order — the agreement, the discovered context, the changes, the verdicts, the evidence and the decisions — under that one location.
- **FR-077**: The system MUST account for every branch, working copy and temporary artefact it created when an order finishes or is cancelled, and MUST tell the operator what was removed and what was kept.

#### Records and learning

- **FR-078**: The system MUST append every decision — by the operator or by a rule — to a permanent record with who or what decided, when, and why.
- **FR-079**: The system MUST, when asked, read that record for repeated rejections and propose new checks, each citing the specific past rejections it derives from.
- **FR-080**: The system MUST NOT propose new checks unprompted.
- **FR-081**: An accepted check MUST apply to subsequent work across every repository; a rejected proposal MUST NOT be raised again; an accepted check MUST be removable, and its removal recorded.
- **FR-082**: The system MUST make past decisions affecting the same files available as prior art when a new order's context is gathered.
- **FR-083**: The system MUST classify any question raised during execution — as opposed to during intake — as a defect of intake, and record it against the order as one, in addition to answering it.

### Key Entities

- **Work order**: The agreement between the operator and the factory. Holds intent and exclusions, discovered context about the project, criteria for done each with its means of proof, a plan of work, a risk assessment, budgets, stated assumptions, and its origin. It is either draft or agreed; only an agreed order may be worked.
- **Criterion for done**: One falsifiable statement about the finished work, paired with the means of proving it and a priority.
- **Piece of work**: One unit of the plan. Names what it will touch, which criteria it exists to satisfy, what it depends on, which repository it belongs to, and which role performs it.
- **Stream**: One repository's share of an order — its branch, its working copy, its position in the merge order, and what it produces or consumes.
- **Shape of work**: A named arrangement of steps, with what it requires of a repository. Selected per order, overridable.
- **Role**: What an agent is for — what it may read, what it may write, what tools it may use and what it must produce. Distinct roles read, plan, attack, build, verify, inspect, integrate, document and schedule.
- **Check**: A named assertion applied at a stated point in the work, scoped as universal or belonging to a particular project.
- **Request for attention**: One decision waiting on the operator, carrying the rule that raised it, its evidence, its options, its default and its deadline.
- **Verdict**: The outcome of checking one piece of work against one criterion, with the evidence it was derived from; passing, failing, or not measured.
- **Record of decisions**: The permanent, append-only account of everything decided, by whom or by what rule, and why.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A one-line change reaches a draft pull request with at most one operator decision beyond seeding the idea, down from nine today.
- **SC-002**: Across a mixed sample of ten completed pieces of work, the median number of operator decisions per shipped change is two or fewer.
- **SC-003**: The operator can complete a piece of work in a repository they have never used Foundry on before, without performing any setup step, and that repository afterwards contains nothing Foundry added other than the change itself.
- **SC-004**: 100% of agreed work orders have every criterion for done covered by at least one piece of planned work, and every piece of planned work attached to at least one criterion.
- **SC-005**: At no point during intake is the operator shown more than three open questions.
- **SC-006**: 100% of completed pieces of work carry a verdict produced by a party other than the one that produced the work, together with the evidence it was derived from.
- **SC-007**: Across a sample of runs in repositories lacking a given check, that check reports "not measured" 100% of the time and reports a pass 0% of the time.
- **SC-008**: 0% of changes reach a merged state without an explicit operator decision, at every autonomy setting.
- **SC-009**: From any screen, the operator can reach the live session of any running agent in a single action.
- **SC-010**: 100% of orders seeded from a tracker issue have the agreed work order, the current state and every pull request link visible on that issue without the operator typing anything.
- **SC-011**: For an order spanning two repositories, no consuming repository merges before the repository producing the change it consumes — 0 violations.
- **SC-012**: After a proposed check is accepted, the rejection reason it was derived from does not recur in subsequent work.
- **SC-013**: A single-repository idea reaches an agreed work order within 15 minutes of the operator seeding it, including their answers.
- **SC-014**: Every request for the operator's attention names the rule that raised it and the evidence behind it — 100%, with no unattributed interruptions.

## Assumptions

Decisions taken where the source material left a choice open, and defaults chosen where nothing was specified. The operator asked for the recommended option in each case.

- **Risk decision before pushing, for the riskiest work only**: for orders graded at the two highest risk levels the operator's decision is taken before anything reaches the remote; for everything else the draft pull request is opened first, so review happens on a real change. This is deliberately two behaviours rather than one; the cost is that the operator cannot predict from the rule alone which will happen, and the risk grade is shown on the order so they can.
- **One pull request per repository, not a stacked flow**: a multi-repository order opens one draft pull request per repository, cross-linked. A properly stacked review flow is better to read and materially more machinery; it is out of scope here and worth revisiting once a real multi-repository order has been run.
- **Proposals for new checks are made on request only**: never on a schedule and never unprompted, until there is evidence that their hit rate justifies interrupting.
- **Budget defaults**: three agents at once, forty-five minutes of wall clock, twenty-five files touched, and no ceiling on token spend. The first three match limits the operator already lives with today. A token ceiling is deliberately absent because one that fires part-way through leaves a half-finished change, which is worse than an expensive one; wall clock is the better proxy until there is data.
- **Records location**: where the operator configures nothing, records are written to a hidden folder named after the tool beside the working directory. Foundry never adds an ignore entry for it — it tells the operator once and leaves the repository alone. A single configured location is the recommended configuration and the only workable one for multi-repository orders.
- **Existing capabilities are reused, not rebuilt**: the application already runs agents in visible sessions with every tool call held for a decision, reviews changes at sub-file granularity and can revert what is rejected, grades a change's risk by what it touches, coordinates merge order across repositories, and holds tracker connections with issue links and session context. Foundry consumes all of it.
- **Risk is graded on the existing four-level scale**, highest to lowest, by what a change touches — authentication, payments, secrets, data migrations and published interfaces at the highest level. "The highest grade" and "the two highest grades" throughout this specification refer to that scale.
- **One operator**: no multi-user roles, permissions or assignment. Every decision belongs to the person running the application.
- **The existing ten-stage pipeline is retained as one shape of work**, offered only where the repository supports it. Nothing available today is lost.
- **Trackers**: whichever the application already connects to. No new tracker types are added by this feature.
- **Workflow-state write-back is built for Linear only.** Comments and pull-request links work for every connected tracker; moving an issue's state is implemented for Linear alone, because that is the tracker the operator uses. Jira remains connected and readable and keeps its comment write; asked to move a state, it reports the capability as unsupported (FR-059a) and the work is unaffected. The interface is still expressed as an intent — `started` / `in_review` / `done` — rather than as a state identifier, because FR-060 requires the operator to be able to adjust which state each intent means, and that indirection is needed with one tracker as much as with two.
- **Autonomy**: three settings, differing only in which rules are live. The most permissive still requires an operator decision to merge.
- **Delivery is staged**: the P1 stories are the foundation and are individually useful; P2 removes the operator from the loop; P3 covers multiple repositories and learning. Each priority level is shippable on its own.

## Out of Scope

- Multi-user operation: shared queues, assignment, per-user permissions or review roles.
- A stacked pull request flow across repositories.
- Automatic merging. Every merge requires an operator decision.
- Automatic proposal of new checks on a schedule.
- New tracker integrations, or any credential entry of Foundry's own.
- Workflow-state write-back for any tracker other than Linear. The capability is reported as unsupported rather than partially built.
- Running agents anywhere other than the operator's own machine.
- Replacing the application's existing change-review, risk-grading or session-supervision capabilities; Foundry uses them as they are.
- Editing any file in a target repository beyond the change the order asked for — including ignore files.

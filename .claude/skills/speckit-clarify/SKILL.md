---
name: "speckit-clarify"
description: "Identify underspecified areas in the current feature spec by asking up to 5 highly targeted clarification questions and encoding answers back into the spec."
argument-hint: "Optional areas to clarify in the spec"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/clarify.md"
user-invocable: true
disable-model-invocation: false
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you continue (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before clarification)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_clarify` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- To build a command invocation from a hook command name, replace dots (`.`) with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`.
- For each executable hook, output the block that matches its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
    After you output the block above, you MUST invoke the hook and wait for it to finish before you continue. Run it the way you run any command in this agent session. The invocation can differ from the `{command}` id shown above (for example, a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). The block alone does not run the hook.
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Outline

Goal: Find and reduce ambiguity and missing decision points in the active feature specification. Record the clarifications in the spec file.

Note: Run and finish this clarification workflow BEFORE you run `/speckit-plan`. If the user says they skip clarification (for example, an exploratory spike), you can continue, but you must warn that the risk of downstream rework increases.

Execution steps:

1. Run `.specify/scripts/bash/check-prerequisites.sh --json --paths-only` from repo root **once** (combined `--json --paths-only` mode / `-Json -PathsOnly`). Parse these JSON fields only:
   - `FEATURE_DIR`
   - `FEATURE_SPEC`
   - (Optionally capture `IMPL_PLAN`, `TASKS` for future chained flows.)
   - If JSON parsing fails, abort and tell the user to re-run `/speckit-specify` or to verify the feature branch environment.
   - For single quotes in args like "I'm Groot", use escape syntax: for example 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **IF EXISTS**: Load `.specify/memory/constitution.md` for project principles and governance constraints.

3. Load the current spec file. Run a structured ambiguity and coverage scan with this taxonomy. For each category, mark the status: Clear / Partial / Missing. Produce an internal coverage map for prioritization (output the raw map only if you will ask no questions).

   Functional Scope & Behavior:
   - Core user goals & success criteria
   - Explicit out-of-scope declarations
   - User roles / personas differentiation

   Domain & Data Model:
   - Entities, attributes, relationships
   - Identity & uniqueness rules
   - Lifecycle/state transitions
   - Data volume / scale assumptions

   Interaction & UX Flow:
   - Critical user journeys / sequences
   - Error/empty/loading states
   - Accessibility or localization notes

   Non-Functional Quality Attributes:
   - Performance (latency, throughput targets)
   - Scalability (horizontal/vertical, limits)
   - Reliability & availability (uptime, recovery expectations)
   - Observability (logging, metrics, tracing signals)
   - Security & privacy (authN/Z, data protection, threat assumptions)
   - Compliance / regulatory constraints (if any)

   Integration & External Dependencies:
   - External services/APIs and failure modes
   - Data import/export formats
   - Protocol/versioning assumptions

   Edge Cases & Failure Handling:
   - Negative scenarios
   - Rate limiting / throttling
   - Conflict resolution (e.g., concurrent edits)

   Constraints & Tradeoffs:
   - Technical constraints (language, storage, hosting)
   - Explicit tradeoffs or rejected alternatives

   Terminology & Consistency:
   - Canonical glossary terms
   - Avoided synonyms / deprecated terms

   Completion Signals:
   - Acceptance criteria testability
   - Measurable Definition of Done style indicators

   Misc / Placeholders:
   - TODO markers / unresolved decisions
   - Ambiguous adjectives ("robust", "intuitive") lacking quantification

   For each category with Partial or Missing status, add a candidate question opportunity unless:
   - The clarification would not materially change the implementation or validation strategy
   - The information is better deferred to the planning phase (note this internally)

4. Generate (internally) a prioritized queue of candidate clarification questions (at most 5). Do NOT output them all at once. Apply these constraints:
    - Ask at most 5 questions in the whole session.
    - Each question must have EITHER:
       - A short multiple‑choice answer (2–5 distinct, mutually exclusive options), OR
       - A one-word or short‑phrase answer (state the limit: "Answer in <=5 words").
    - Include only questions whose answers materially affect architecture, data modeling, task decomposition, test design, UX behavior, operational readiness, or compliance validation.
    - Balance category coverage: cover the unresolved categories with the highest impact first. Do not ask two low-impact questions when one high-impact area (for example, security posture) is unresolved.
    - Exclude questions that have answers, trivial style preferences, and plan-level execution details (unless they block correctness).
    - Favor clarifications that reduce the risk of downstream rework or prevent misaligned acceptance tests.
    - If more than 5 categories remain unresolved, select the top 5 by the (Impact * Uncertainty) heuristic.

5. Sequential questioning loop (interactive):
    - Ask EXACTLY ONE question at a time.
    - **Question writing quality (applies to every question, MC or short-answer):**
       - Start with `**Question:**` followed by a full question that ends with `?`. The text before the `?` must make sense on its own.
       - NEVER use a topic label, section heading, or requirement id as the question itself. For example, `Acceptance device/runtime matrix (FR-023)` is INVALID because it is a label, not a question.
       - After the `?`, the only allowed suffix is an optional requirement or question id in parentheses. Exact format: `**Question:** <interrogative>?` or `**Question:** <interrogative>? (FR-023)`. Never put the id before the `?`. Never use the id (alone or with a topic label) as the whole prompt.
       - Directly after the question line, add one plain-language "Why it matters" sentence (the stake for acceptance or shipping) before the recommendation or options.
       - Use everyday words. Use jargon only if you define it in the same sentence. Self-check: a reader who does not know Spec Kit must be able to answer from the Question line alone. Short is fine; cryptic labels are not.
    - For multiple‑choice questions:
       - **Analyze all options** and choose the **most suitable option** from:
          - Best practices for the project type
          - Common patterns in similar implementations
          - Risk reduction (security, performance, maintainability)
          - Fit with the project goals or constraints that the spec states
       - Show your **recommended option** at the top with clear reasoning (1-2 sentences that explain why it is the best choice).
       - Format as: `**Recommended:** Option [X] - <reasoning>`
       - Then show all options as a Markdown table:

       | Option | Description |
       |--------|-------------|
       | A | <Option A description> |
       | B | <Option B description> |
       | C | <Option C description> (add D/E as needed up to 5) |
       | Short | Provide a different short answer (<=5 words) (Include only if free-form alternative is appropriate) |

       - After the table, add: `You can reply with the option letter (e.g., "A"), accept the recommendation by saying "yes" or "recommended", or provide your own short answer.`
    - For short‑answer style (no meaningful discrete options):
       - Give your **suggested answer** based on best practices and the context.
       - Format as: `**Suggested:** <your proposed answer> - <brief reasoning>`
       - Then output: `Format: Short answer (<=5 words). You can accept the suggestion by saying "yes" or "suggested", or provide your own answer.`
    - After the user answers:
       - If the user replies with "yes", "recommended", or "suggested", use your previously stated recommendation/suggestion as the answer.
       - Otherwise, validate that the answer maps to one option or fits the <=5 word limit.
       - If the answer is ambiguous, ask a quick follow-up (it counts as the same question; do not advance).
       - When the answer is clear, record it in working memory (do not write to disk yet) and move to the next queued question.
    - Stop asking further questions when:
       - You resolve all critical ambiguities early (the remaining queued items are then unnecessary), OR
       - The user signals completion ("done", "good", "no more"), OR
       - You have asked 5 questions.
    - Never reveal queued questions before you ask them.
    - If no valid questions exist at the start, report at once that no critical ambiguities exist.

6. Integration after EACH accepted answer (incremental update):
    - Keep an in-memory representation of the spec (loaded once at the start) plus the raw file contents.
    - For the first integrated answer in this session:
       - Ensure a `## Clarifications` section exists (if it is missing, create it just after the highest-level context or overview section, per the spec template).
       - Under it, create (if it does not exist) a `### Session YYYY-MM-DD` subheading for today.
    - Append a bullet line right after you accept the answer: `- Q: <question> → A: <final answer>`.
    - Then apply the clarification at once to the best-fitting section(s):
       - Functional ambiguity → Update or add a bullet in Functional Requirements.
       - User interaction / actor distinction → Update User Stories or Actors subsection (if present) with clarified role, constraint, or scenario.
       - Data shape / entities → Update Data Model (add fields, types, relationships) keep the ordering; note added constraints briefly.
       - Non-functional constraint → Add/modify measurable criteria in Success Criteria > Measurable Outcomes (replace a vague adjective with a metric or explicit target).
       - Edge case / negative flow → Add a new bullet under Edge Cases / Error Handling (or create the subsection if the template has a placeholder for it).
       - Terminology conflict → Normalize the term across the spec. Keep the original only if needed, by adding `(formerly referred to as "X")` once.
    - If the clarification invalidates an earlier ambiguous statement, replace that statement. Do not duplicate it. Leave no obsolete, contradictory text.
    - Save the spec file AFTER each integration to reduce the risk of context loss (atomic overwrite).
    - Preserve the formatting: do not reorder unrelated sections; keep the heading hierarchy.
    - Keep each inserted clarification minimal and testable (no narrative drift).

7. Validation (run after EACH write and in a final pass):
   - The Clarifications session has exactly one bullet per accepted answer (no duplicates).
   - The total of asked (accepted) questions is at most 5.
   - Updated sections have no vague placeholders that the new answer should have resolved.
   - No earlier contradictory statement remains (scan for alternative choices that are now invalid and remove them).
   - The Markdown structure is valid; the only allowed new headings are `## Clarifications`, `### Session YYYY-MM-DD`.
   - Terminology consistency: all updated sections use the same canonical term.

8. Write the updated spec back to `FEATURE_SPEC`.

9. **Re-validate Spec Quality Checklist** (if it exists):
   - Check if `FEATURE_DIR/checklists/requirements.md` exists.
   - If it does NOT exist, skip this step silently.
   - If it exists:
     1. Read the checklist file.
     2. Find all GitHub task-list checkbox lines — lines matching `- [ ]`, `- [x]`, or `- [X]` (case-insensitive, tolerant of leading whitespace for nested items) outside of code fences. Ignore all other content (headings, notes, non-checkbox bullets, metadata).
     3. For each checkbox line, record its marker state (checked or unchecked) and item text in a before-snapshot list.
     4. Evaluate each checkbox item again against the **updated** spec (the version just saved in step 7).
     5. For each checkbox item, update it only if the checked or unchecked state changes:
        - If the item now passes and was unchecked: change `[ ]` to `[x]`.
        - If the item now fails and was checked: change `[x]`/`[X]` to `[ ]`.
        - If the state is unchanged: leave the marker as it is (keep the existing case to avoid cosmetic diffs).
     6. Save the updated checklist file. **Only toggle the `[ ]`/`[x]` marker portion of checkbox lines whose state changed.** All other file content (headings, metadata, notes, line order, whitespace) must stay unchanged to avoid noisy diffs.
     7. Compare the before-snapshot with the current state to build three lists for the Completion Report:
        - **Newly passing**: items that changed from unchecked to checked.
        - **Regressions**: items that changed from checked to unchecked.
        - **Still unchecked**: items that remain unchecked.
     8. Record the before and after pass counts as checked and total checkbox items (e.g., "12/16 → 15/16 items passing").

Behavior rules:

- If you find no meaningful ambiguities (or all possible questions have low impact), respond: "No critical ambiguities detected worth formal clarification." and suggest that the user continue.
- If spec file missing, tell the user to run `/speckit-specify` first (do not create a new spec here).
- Never ask more than 5 questions in total (a retry of one question is not a new question).
- Avoid speculative tech stack questions unless the missing answer blocks functional clarity.
- Obey early termination signals from the user ("stop", "done", "proceed").
- If no questions asked due to full coverage, output a compact coverage summary (all categories Clear), then suggest that the user advance.
- If you reach the quota with unresolved high-impact categories, flag them under Deferred with the rationale.

Context for prioritization: $ARGUMENTS

## Mandatory Post-Execution Hooks

**You MUST complete this section before reporting completion to the user.**

Check if `.specify/extensions.yml` exists in the project root.
- If it does not exist, or no hooks are registered under `hooks.after_clarify`, skip to the Completion Report.
- If it exists, read it and look for entries under the `hooks.after_clarify` key.
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue to the Completion Report.
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- To build a command invocation from a hook command name, replace dots (`.`) with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`.
- For each executable hook, output the block that matches its `optional` flag:
  - **Mandatory hook** (`optional: false`) — **You MUST emit `EXECUTE_COMMAND:` for each mandatory hook**:
    ```
    ## Extension Hooks

    **Automatic Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}
    ```
    After you output the block above, you MUST invoke the hook and wait for it to finish before you continue. Run it the way you run any command in this agent session. The invocation can differ from the `{command}` id shown above (for example, a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). The block alone does not run the hook.
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```

## Completion Report

Report completion (after the questioning loop ends or the user ends it early):
- Number of questions asked and answered.
- Path to updated spec.
- Sections touched (list names).
- Spec quality checklist status (if you re-validated `FEATURE_DIR/checklists/requirements.md`): show the before and after pass counts (e.g., "Spec Quality Checklist: 12/16 → 15/16 items passing") and list the items that changed state: newly checked (unchecked → checked) and regressions (checked → unchecked). List the items that remain unchecked as areas that need attention.
- Coverage summary table listing each taxonomy category with Status: Resolved (was Partial/Missing and addressed), Deferred (exceeds question quota or better suited for planning), Clear (already sufficient), Outstanding (still Partial/Missing but low impact).
- If any Outstanding or Deferred remain, recommend whether to continue to `/speckit-plan` or to run `/speckit-clarify` again after the plan.
- Suggested next command.

## Done When

- [ ] Spec ambiguities identified and clarifications integrated into spec file
- [ ] Spec quality checklist re-validated against updated spec (if `FEATURE_DIR/checklists/requirements.md` exists)
- [ ] Extension hooks dispatched or skipped by the rules in Mandatory Post-Execution Hooks above
- [ ] Completion reported to user with questions answered, sections touched, checklist status, and coverage summary

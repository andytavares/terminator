---
name: "speckit-analyze"
description: "Perform a non-destructive cross-artifact consistency and quality analysis across spec.md, plan.md, and tasks.md after task generation."
argument-hint: "Optional focus areas for analysis"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/analyze.md"
user-invocable: true
disable-model-invocation: false
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you continue (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before analysis)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_analyze` key
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

    Wait for the result of the hook command before proceeding to the Goal.
    ```
    After you output the block above, you MUST invoke the hook and wait for it to finish before you continue. Run it the way you run any command in this agent session. The invocation can differ from the `{command}` id shown above (for example, a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). The block alone does not run the hook.
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Goal

Find inconsistencies, duplications, ambiguities, and underspecified items across the three core artifacts (`spec.md`, `plan.md`, `tasks.md`) before implementation. Run this command ONLY after `/speckit-tasks` has produced a complete `tasks.md`.

## Operating Constraints

**STRICTLY READ-ONLY**: Do **not** modify any files. Output a structured analysis report. Offer an optional remediation plan. The user must approve the plan before anyone runs a follow-up editing command by hand.

**Constitution Authority**: The project constitution (`.specify/memory/constitution.md`) is **non-negotiable** in this analysis. A constitution conflict is always CRITICAL. Change the spec, plan, or tasks to fix it. Do not dilute, reinterpret, or silently ignore the principle. To change a principle, make a separate, explicit constitution update outside `/speckit-analyze`.

## Execution Steps

### 1. Initialize Analysis Context

Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` once from repo root and parse JSON for FEATURE_DIR and AVAILABLE_DOCS. Build absolute paths:

- SPEC = FEATURE_DIR/spec.md
- PLAN = FEATURE_DIR/plan.md
- TASKS = FEATURE_DIR/tasks.md

If a required file is missing, abort with an error message that tells the user to run the missing prerequisite command.
For single quotes in args like "I'm Groot", use escape syntax: for example 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

### 2. Load Artifacts (Progressive Disclosure)

Load only the minimum context from each artifact:

**From spec.md:**

- Overview/Context
- Functional Requirements
- Success Criteria (measurable outcomes, for example performance, security, availability, user success, business impact)
- User Stories
- Edge Cases (if present)

**From plan.md:**

- Architecture/stack choices
- Data Model references
- Phases
- Technical constraints

**From tasks.md:**

- Task IDs
- Descriptions
- Phase grouping
- Parallel markers [P]
- Referenced file paths

**From constitution:**

- Load `.specify/memory/constitution.md` for principle validation

### 3. Build Semantic Models

Create internal representations (do not put raw artifacts in the output):

- **Requirements inventory**: For each Functional Requirement (FR-###) and Success Criterion (SC-###), record a stable key. Use the FR-/SC- identifier as the primary key when it exists. You can also derive an imperative-phrase slug for readability (for example, "User can upload file" → `user-can-upload-file`). Include only Success Criteria items that need buildable work (for example, load-testing infrastructure, security audit tooling). Exclude post-launch outcome metrics and business KPIs (for example, "Reduce support tickets by 50%").
- **User story/action inventory**: Discrete user actions with acceptance criteria
- **Task coverage mapping**: Map each task to one or more requirements or stories (infer from keywords or from explicit references such as IDs or key phrases)
- **Constitution rule set**: Extract principle names and MUST/SHOULD normative statements

### 4. Detection Passes (Token-Efficient Analysis)

Focus on high-signal findings. Report at most 50 findings; put the rest in an overflow summary.

#### A. Duplication Detection

- Identify near-duplicate requirements
- Mark lower-quality phrasing for consolidation

#### B. Ambiguity Detection

- Flag vague adjectives (fast, scalable, secure, intuitive, robust) that have no measurable criteria
- Flag unresolved placeholders (TODO, TKTK, ???, `<placeholder>`, etc.)

#### C. Underspecification

- Requirements that have a verb but no object or measurable outcome
- User stories that do not align with acceptance criteria
- Tasks that reference files or components the spec or plan does not define

#### D. Constitution Alignment

- Any requirement or plan element that conflicts with a MUST principle
- Sections or quality gates that the constitution requires and the artifacts lack

#### E. Coverage Gaps

- Requirements with zero associated tasks
- Tasks with no mapped requirement or story
- Success Criteria requiring buildable work (performance, security, availability) that no task covers

#### F. Inconsistency

- Terminology drift (the same concept has different names in different files)
- Data entities that the plan references but the spec lacks (or the reverse)
- Task ordering contradictions (for example, integration tasks before foundational setup tasks with no dependency note)
- Conflicting requirements (for example, one requires Next.js while another specifies Vue)

### 5. Severity Assignment

Use this heuristic to rank findings:

- **CRITICAL**: Violates a constitution MUST, lacks a core spec artifact, or has a requirement with zero coverage that blocks baseline functionality
- **HIGH**: Duplicate or conflicting requirement, ambiguous security/performance attribute, untestable acceptance criterion
- **MEDIUM**: Terminology drift, missing non-functional task coverage, underspecified edge case
- **LOW**: Style/wording improvements, minor redundancy not affecting execution order

### 6. Produce Compact Analysis Report

Output a Markdown report (do not write files) with this structure:

## Specification Analysis Report

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| A1 | Duplication | HIGH | spec.md:L120-134 | Two similar requirements ... | Merge phrasing; keep clearer version |

(Add one row per finding. Give each finding a stable ID that starts with the initial of its category.)

**Coverage Summary Table:**

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|

**Constitution Alignment Issues:** (if any)

**Unmapped Tasks:** (if any)

**Metrics:**

- Total Requirements
- Total Tasks
- Coverage % (requirements with >=1 task)
- Ambiguity Count
- Duplication Count
- Critical Issues Count

### 7. Provide Next Actions

At the end of the report, output a short Next Actions block:

- If CRITICAL issues exist: Recommend that the user resolve them before `/speckit-implement`
- If only LOW/MEDIUM: The user can continue, but give improvement suggestions
- Give explicit command suggestions, for example "Run /speckit-specify with refinement", "Run /speckit-plan to adjust architecture", "Manually edit tasks.md to add coverage for 'performance-metrics'"

### 8. Offer Remediation

Ask the user: "Would you like me to suggest concrete remediation edits for the top N issues?" (Do NOT apply them automatically.)

### 9. Check for extension hooks

After the report, check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.after_analyze` key
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

    **Optional Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}
    ```
    After you output the block above, you MUST invoke the hook and wait for it to finish before you continue. Run it the way you run any command in this agent session. The invocation can differ from the `{command}` id shown above (for example, a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). The block alone does not run the hook.
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Operating Principles

### Context Efficiency

- **Minimal high-signal tokens**: Give actionable findings, not exhaustive documentation
- **Progressive disclosure**: Load artifacts step by step; do not put all content into the analysis
- **Token-efficient output**: Limit the findings table to 50 rows; summarize the overflow
- **Deterministic results**: A rerun with no changes gives the same IDs and counts

### Analysis Guidelines

- **NEVER modify files** (this analysis is read-only)
- **NEVER hallucinate missing sections** (if a section is absent, report it as absent)
- **Prioritize constitution violations** (they are always CRITICAL)
- **Use examples over exhaustive rules** (cite specific instances, not generic patterns)
- **Report zero issues gracefully** (output a success report with coverage statistics)

## Context

$ARGUMENTS

---
name: "speckit-specify"
description: "Create or update the feature specification from a natural language feature description."
argument-hint: "Describe the feature you want to specify"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/specify.md"
user-invocable: true
disable-model-invocation: false
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you continue (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before specification)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_specify` key
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

The text the user typed after `/speckit-specify` in the triggering message **is** the feature description. Assume you always have it in this conversation, even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it, unless the command is empty.

With that feature description, do these steps:

1. **Generate a concise short name** (2-4 words) for the feature:
   - Extract the most meaningful keywords from the feature description
   - Create a 2-4 word short name that states the core of the feature
   - Use action-noun format when possible (for example, "add-user-auth", "fix-payment-bug")
   - Keep technical terms and acronyms (OAuth2, API, JWT, etc.)
   - Keep it short but clear enough to show the feature at a glance
   - Examples:
     - "I want to add user authentication" → "user-auth"
     - "Implement OAuth2 integration for the API" → "oauth2-api-integration"
     - "Create a dashboard for analytics" → "analytics-dashboard"
     - "Fix payment processing timeout bug" → "fix-payment-timeout"

2. **Branch creation** (optional, via hook):

   If a `before_specify` hook ran successfully in the Pre-Execution Checks above, it created or switched to a git branch and output JSON with `BRANCH_NAME` and `FEATURE_NUM`. Note these values for reference. The branch name does **not** set the spec directory name.

   If the user gave `GIT_BRANCH_NAME`, pass it to the hook. The branch script then uses the value as the branch name and skips all prefix and suffix generation.

3. **Create the spec feature directory**:

   Specs live under the default `specs/` directory, unless the user gives `SPECIFY_FEATURE_DIRECTORY`.

   **Resolution order for `SPECIFY_FEATURE_DIRECTORY`**:
   1. If the user gave `SPECIFY_FEATURE_DIRECTORY` (for example, as an environment variable, an argument, or in the configuration), use it as it is
   2. Otherwise, generate it under `specs/`:
      - Read `feature_numbering` (preferred) or `branch_numbering` (deprecated, migration only, a future release removes it) in `.specify/init-options.json`
      - If `"timestamp"`: prefix is `YYYYMMDD-HHMMSS` (current timestamp)
      - If `"sequential"` or absent: prefix is `NNN` (the next free 3-digit number after you scan the existing directories in `specs/`)
      - Build the directory name: `<prefix>-<short-name>` (for example, `003-user-auth` or `20260319-143022-user-auth`)
      - Set `SPECIFY_FEATURE_DIRECTORY` to `specs/<directory-name>`
      - If `branch_numbering` was used (and `feature_numbering` was absent), output a one-line warning: "⚠️ `branch_numbering` in init-options.json is deprecated. Rename to `feature_numbering`."

   **Create the directory and spec file**:
   - `mkdir -p SPECIFY_FEATURE_DIRECTORY`
   - Resolve the active `spec-template` through the Spec Kit preset and template resolution stack (equivalent to `specify preset resolve spec-template`)
   - Copy the resolved `spec-template` file to `SPECIFY_FEATURE_DIRECTORY/spec.md` as the starting point
   - Set `SPEC_FILE` to `SPECIFY_FEATURE_DIRECTORY/spec.md`
   - Save the resolved path to `.specify/feature.json`:
     ```json
     {
       "feature_directory": "<resolved feature dir>"
     }
     ```
     Write the resolved directory path (for example, `specs/003-user-auth`), not the literal string `SPECIFY_FEATURE_DIRECTORY`.
     With this file, downstream commands (`/speckit-plan`, `/speckit-tasks`, and others) find the feature directory without git branch name conventions.

   **IMPORTANT**:
   - Create only one feature per `/speckit-specify` invocation
   - The spec directory name and the git branch name are independent — they can be the same, but the user chooses
   - This command always creates the spec directory and file, never the hook

4. Load the resolved active `spec-template` file to see the required sections.

5. **IF EXISTS**: Load `.specify/memory/constitution.md` for project principles and governance constraints.

6. Follow these steps:
    1. Parse the user description from the arguments
       If empty: ERROR "No feature description provided"
    2. Extract key concepts from description
       Identify: actors, actions, data, constraints
    3. For unclear aspects:
       - Make informed guesses based on the context and industry standards
       - Mark with [NEEDS CLARIFICATION: specific question] only if:
         - The choice significantly affects the feature scope or user experience
         - Many reasonable interpretations exist with different implications
         - No reasonable default exists
       - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**
       - Rank clarifications by impact: scope > security/privacy > user experience > technical details
    4. Fill User Scenarios & Testing section
       If no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements
       Each requirement must be testable
       Use reasonable defaults for unspecified details (document assumptions in Assumptions section)
    6. Define Success Criteria
       Create measurable outcomes that are technology-agnostic
       Include quantitative metrics (time, performance, volume) and qualitative measures (user satisfaction, task completion)
       Each criterion must be verifiable without implementation details
    7. Identify Key Entities (if data involved)
    8. Return: SUCCESS (spec ready for planning)

7. Write the specification to SPEC_FILE using the template structure, replacing placeholders with concrete details from the feature description (arguments). Keep the section order and headings.

8. **Specification Quality Validation**: After you write the initial spec, validate it against quality criteria:

   a. **Create Spec Quality Checklist**: Generate a checklist file at `SPECIFY_FEATURE_DIRECTORY/checklists/requirements.md` using the checklist template structure with these validation items:

      ```markdown
      # Specification Quality Checklist: [FEATURE NAME]

      **Purpose**: Validate specification completeness and quality before proceeding to planning
      **Created**: [DATE]
      **Feature**: [Link to spec.md]

      ## Content Quality

      - [ ] No implementation details (languages, frameworks, APIs)
      - [ ] Focused on user value and business needs
      - [ ] Written for non-technical stakeholders
      - [ ] All mandatory sections completed

      ## Requirement Completeness

      - [ ] No [NEEDS CLARIFICATION] markers remain
      - [ ] Requirements are testable and unambiguous
      - [ ] Success criteria are measurable
      - [ ] Success criteria are technology-agnostic (no implementation details)
      - [ ] All acceptance scenarios are defined
      - [ ] Edge cases are identified
      - [ ] Scope is clearly bounded
      - [ ] Dependencies and assumptions identified

      ## Feature Readiness

      - [ ] All functional requirements have clear acceptance criteria
      - [ ] User scenarios cover primary flows
      - [ ] Feature meets measurable outcomes defined in Success Criteria
      - [ ] No implementation details leak into specification

      ## Notes

      - Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
      ```

   b. **Run Validation Check**: Check the spec against each checklist item:
      - For each item, decide if it passes or fails
      - Document the specific issues you find (quote the relevant spec sections)

   c. **Handle Validation Results**:

      - **If all items pass**: Mark the checklist complete and continue to the Mandatory Post-Execution Hooks section

      - **If items fail (excluding [NEEDS CLARIFICATION])**:
        1. List the failing items and specific issues
        2. Update the spec to fix each issue
        3. Re-run validation until all items pass (max 3 iterations)
        4. If still failing after 3 iterations, document the remaining issues in the checklist notes and warn the user

      - **If [NEEDS CLARIFICATION] markers remain**:
        1. Extract all [NEEDS CLARIFICATION: ...] markers from the spec
        2. **LIMIT CHECK**: If more than 3 markers exist, keep only the 3 most critical (by scope, security, and UX impact) and make informed guesses for the rest
        3. For each clarification needed (max 3), present options to the user in this format:

           ```markdown
           ## Question [N]: [Topic]

           **Context**: [Quote relevant spec section]

           **What we need to know**: [Specific question from NEEDS CLARIFICATION marker]

           **Suggested Answers**:

           | Option | Answer | Implications |
           |--------|--------|--------------|
           | A      | [First suggested answer] | [What this means for the feature] |
           | B      | [Second suggested answer] | [What this means for the feature] |
           | C      | [Third suggested answer] | [What this means for the feature] |
           | Custom | Provide your own answer | [Explain how to provide custom input] |

           **Your choice**: _[Wait for user response]_
           ```

        4. **CRITICAL - Table Formatting**: Format markdown tables correctly:
           - Use consistent spacing and align the pipes
           - Put spaces around the content of each cell: `| Content |` not `|Content|`
           - The header separator must have at least 3 dashes: `|--------|`
           - Check that the table renders correctly in a markdown preview
        5. Number the questions in order (Q1, Q2, Q3 - max 3 total)
        6. Present all questions together before you wait for responses
        7. Wait for the user to respond with their choices for all questions (for example, "Q1: A, Q2: Custom - [details], Q3: B")
        8. Update the spec: replace each [NEEDS CLARIFICATION] marker with the answer the user chose or gave
        9. Re-run validation after you resolve all clarifications

   d. **Update Checklist**: After each validation iteration, update the checklist file with the current pass or fail status

## Mandatory Post-Execution Hooks

**You MUST complete this section before reporting completion to the user.**

Check if `.specify/extensions.yml` exists in the project root.
- If it does not exist, or no hooks are registered under `hooks.after_specify`, skip to the Completion Report.
- If it exists, read it and look for entries under the `hooks.after_specify` key.
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

Report completion to the user with:
- `SPECIFY_FEATURE_DIRECTORY`: the feature directory path
- `SPEC_FILE`: the spec file path
- Checklist results summary
- Readiness for the next phase (`/speckit-clarify` or `/speckit-plan`)

**NOTE:** The `before_specify` hook (git extension) creates the branch. This core command always creates the spec directory and file.

## Quick Guidelines

- Focus on **WHAT** users need and **WHY**.
- Avoid HOW to implement (no tech stack, APIs, code structure).
- Write for business stakeholders, not developers.
- DO NOT create checklists embedded in the spec. A separate command does that.

### Section Requirements

- **Mandatory sections**: Complete them for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section does not apply, remove it entirely (do not leave "N/A")

### For AI Generation

When you create this spec from a user prompt:

1. **Make informed guesses**: Use the context, industry standards, and common patterns to fill gaps
2. **Document assumptions**: Record reasonable defaults in the Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers - use them only for critical decisions that:
   - Significantly affect the feature scope or user experience
   - Have many reasonable interpretations with different implications
   - Have no reasonable default
4. **Rank clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement must fail the "testable and unambiguous" checklist item
6. **Common areas needing clarification** (only if no reasonable default exists):
   - Feature scope and boundaries (include/exclude specific use cases)
   - User types and permissions (if conflicting interpretations are possible)
   - Security/compliance requirements (when they matter legally or financially)

**Examples of reasonable defaults** (do not ask about these):

- Data retention: Industry-standard practices for the domain
- Performance targets: Standard web/mobile app expectations unless specified
- Error handling: User-friendly messages with appropriate fallbacks
- Authentication method: Standard session-based or OAuth2 for web apps
- Integration patterns: Use patterns that fit the project (REST/GraphQL for web services, function calls for libraries, CLI args for tools, etc.)

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from the user or business view, not system internals
4. **Verifiable**: Can be tested and validated without knowing the implementation details

**Good examples**:

- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"
- "Task completion rate improves by 40%"

**Bad examples** (implementation-focused):

- "API response time is under 200ms" (too technical, use "Users see results instantly")
- "Database can handle 1000 TPS" (implementation detail, use user-facing metric)
- "React components render efficiently" (framework-specific)
- "Redis cache hit rate above 80%" (technology-specific)

## Done When

- [ ] Specification written to `SPEC_FILE` and validated against quality checklist
- [ ] Extension hooks dispatched or skipped by the rules in Mandatory Post-Execution Hooks above
- [ ] Completion reported to user with feature directory, spec file path, and checklist results

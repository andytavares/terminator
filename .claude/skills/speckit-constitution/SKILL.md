---
name: "speckit-constitution"
description: "Create or update the project constitution from interactive or provided principle inputs."
argument-hint: "Principles or values for the project constitution"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/constitution.md"
user-invocable: true
disable-model-invocation: false
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before you continue (if not empty).

## Scope Guard

This command only updates the project constitution. Dependent templates
and commands read the constitution at runtime. This command does not modify them.

- Classify every part of the user input as constitution content or as a separate,
  non-governance intent.
- If the input includes requests for feature implementation, code generation, refactoring, building, or
  deployment, you **MUST NOT** execute them. Extract them as deferred intents.
- You **MUST NOT** create, modify, or delete application source files, feature routes,
  components, tests, deployment files, or other artifacts that the constitution
  workflow does not cover.
- If you are not sure that an instruction is constitution content, ask for clarification before
  you make changes.
- After the constitution update, include a `Next Actions` section for each deferred
  intent. List the original intent and suggest the follow-up Spec Kit command, such
  as `/speckit-specify`. Do not run the command.
- If there are no non-governance intents, omit the `Next Actions` section.

## Pre-Execution Checks

**Check for extension hooks (before constitution update)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_constitution` key
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

You update the project constitution at `.specify/memory/constitution.md`. The command resolves the active
constitution scaffold from `constitution-template` through the Spec Kit
preset and template resolution stack.

Follow these steps:

1. Run `.specify/scripts/bash/resolve-template.sh constitution-template --json` from the repository root and parse `TEMPLATE_CONTENT` as the active template.
   - The shared resolver applies project overrides, composing preset layers, and extension layers
     before the core template fallback. It MUST succeed before you continue.
   - If it fails, stop and report the resolution error. Do not continue with only one contributing
     template layer.
   - If `.specify/memory/constitution.md` exists, load it as the source of the current project-specific
     values and amendments. Keep the information that still applies when you apply the newly
     resolved scaffold.
   - If it does not exist, use the resolved template as the initial document.
   - Do not write back to any versioned template layer.
   - Find every placeholder token of the form `[ALL_CAPS_IDENTIFIER]`.
   **IMPORTANT**: The user can ask for fewer or more principles than the template has. If the user gives a number, use that number and follow the general template. Update the doc to match.

2. Collect or derive values for the placeholders:
   - If the user input (conversation) gives a value, use it.
   - Otherwise infer the value from the repo context (README, docs, prior constitution versions if embedded).
   - For governance dates: `RATIFICATION_DATE` is the original adoption date (if unknown, ask or mark TODO). `LAST_AMENDED_DATE` is today if you make changes, otherwise keep the previous date.
   - `CONSTITUTION_VERSION` must increment by the semantic versioning rules:
     - MAJOR: Backward incompatible governance/principle removals or redefinitions.
     - MINOR: New principle/section added or materially expanded guidance.
     - PATCH: Clarifications, wording, typo fixes, non-semantic refinements.
   - If the type of version bump is ambiguous, give your reasoning before you finalize.

3. Draft the updated constitution content. Use the resolved template as the required structure:
   - Replace every placeholder with concrete text (leave no bracketed tokens, except template slots that the project chose not to define yet; justify each one you leave).
   - Keep the heading hierarchy. Remove template comments after you replace them, unless they still give useful guidance.
   - Each Principle section has a short name line, a paragraph (or bullet list) with the non‑negotiable rules, and an explicit rationale if it is not obvious.
   - The Governance section lists the amendment procedure, the versioning policy, and the compliance review expectations.

4. Produce a Sync Impact Report (prepend it as an HTML comment at the top of the constitution file after the update):
   - Version change: old → new
   - List of modified principles (old title → new title if renamed)
   - Added sections
   - Removed sections
   - Follow-up TODOs if you deferred any placeholders on purpose.

5. Validation before the final output:
   - No remaining unexplained bracket tokens.
   - Version line matches report.
   - Dates ISO format YYYY-MM-DD.
   - Principles are declarative, testable, and free of vague language (replace "should" with MUST or SHOULD plus a rationale where it fits).

6. Write the finished constitution to `.specify/memory/constitution.md` (overwrite).

7. Output a final summary to the user:
   - New version and bump rationale.
   - Any TODO placeholders or deferred items that need manual follow-up.
   - Suggested commit message (for example, `docs: amend constitution to vX.Y.Z (principle additions + governance update)`).
   - A `Next Actions` section for any deferred non-governance intents.

Formatting & Style Requirements:

- Use the Markdown headings of the template exactly (do not change the levels).
- Wrap long rationale lines for readability (ideally under 100 characters). Do not force awkward breaks.
- Keep a single blank line between sections.
- Leave no trailing whitespace.

If the user gives partial updates (for example, only one principle revision), still run the validation and version decision steps.

If critical information is missing (for example, the ratification date is unknown), insert `TODO(<FIELD_NAME>): explanation` and include in the Sync Impact Report under deferred items.

Write only `.specify/memory/constitution.md`. Do not create or modify template source files.

## Post-Execution Checks

**Check for extension hooks (after constitution update)**:
Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.after_constitution` key
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

# [CHECKLIST TYPE] Checklist: [FEATURE NAME]

**Purpose**: [Brief description of what this checklist covers]
**Created**: [DATE]
**Feature**: [Link to spec.md or relevant documentation]

**Note**: The `/speckit-checklist` command generates this custom checklist from feature context and requirements.
**Review Ownership**: The reviewer owns this checklist. It is a requirements-quality review artifact. Mark an item `[x]` only when the reviewer decides the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the reviewer reviewed the criterion and it is satisfied for requirements quality. It does not mean the implementation work is complete.

<!--
  ============================================================================
  IMPORTANT: The checklist items below are SAMPLE ITEMS for illustration only.

  The /speckit-checklist command MUST replace these with actual items from:
  - The user's checklist request
  - Feature requirements from spec.md
  - Technical context from plan.md
  - Implementation details from tasks.md

  DO NOT keep these sample items in the generated checklist file.
  ============================================================================
-->

## [Category 1]

- [ ] CHK001 First checklist item with clear action
- [ ] CHK002 Second checklist item
- [ ] CHK003 Third checklist item

## [Category 2]

- [ ] CHK004 Another category item
- [ ] CHK005 Item with specific criteria
- [ ] CHK006 Final item in this category

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- Leave items unchecked when they still need clarification, correction, or reviewer evaluation
- `/speckit-implement` reads the checkbox state as a gate. It must not change the markers
- `checklists/requirements.md` has a separate built-in lifecycle. `/speckit-specify` and `/speckit-clarify` maintain it
- Add comments or findings inline
- Link to relevant resources or documentation
- Number items sequentially so that you can refer to them

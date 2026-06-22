---
name: repo-conventions
description: Detects and applies this repository's existing conventions for file layout, naming, error handling, logging, and import style. Use whenever Claude is creating a new file or changing structure.
---

# Repo conventions

A convention is a style-guide rule, and a style guide is a tool for scaling a codebase, not a matter
of taste (see the `style-guides-as-scaling-tools` concept). The principles: **a rule must have a
purpose**, code is **optimized for the reader** (it's read far more often than written), and
**consistency beats personal preference** — a consistent codebase is one any engineer can move
through. Prefer rules a formatter/linter can enforce automatically over rules humans must remember.

Before creating any file, do this:

1. Read `.claude/stack.json` for the detected toolchain.
2. Find 2-3 nearest analogous files in the same package or module.
3. Mirror their:
   - file naming and casing
   - import order and grouping
   - error handling style (exceptions vs result types vs error returns)
   - logging library and log-level conventions
   - test file placement (`__tests__/`, sibling `_test.go`, mirrored `tests/`, etc.)
   - public API surface and visibility

Do not introduce a new convention. If the existing convention is broken, surface that to the user as a separate decision — do not silently "fix" it as part of an unrelated change.

See also: `references/file-layout-patterns.md`.

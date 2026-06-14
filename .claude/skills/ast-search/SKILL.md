---
name: ast-search
description: Use for structural code search — finding code by shape, pattern, or usage rather than by string match. Reads ast_search_tool from stack.json to select the binary (ast-grep primary, semgrep fallback). Returns file:line matches. Use AFTER a ripgrep text pass, not instead of it. Called automatically by find-reuse; also available standalone.
---

# AST Search

Structural code search finds matches by code shape, not by string. Use it when a text search would produce too many false positives (e.g. finding all call sites of a function regardless of how it's imported) or too many false negatives (e.g. finding all implementations of a pattern regardless of variable names).

## Prerequisites

Read `.claude/stack.json` and check the `ast_search_tool` key before running.

- If `ast_search_tool` is `"ast-grep"`: use `ast-grep` commands.
- If `ast_search_tool` is `"semgrep"`: use `semgrep` commands.
- If `ast_search_tool` is `null`: inform the caller that no AST search tool is available. Suggest `brew install ast-grep` or `pip install semgrep`, then re-run `/forge-detect-stack`.

Do not attempt to install the tool. Do not fall back to ripgrep — the caller already ran a text pass.

## How to run ast-grep

```bash
# Match a pattern across all files of a language
ast-grep --lang <lang> --pattern '<pattern>' <path>

# Common languages: js, ts, jsx, tsx, python, go, rust, java, c, cpp
# Default path: . (repo root)
```

Pattern syntax: use `$VAR` for any single AST node, `$$$` for any sequence. See `references/pattern-syntax.md` for examples.

## How to run semgrep (fallback)

```bash
semgrep --pattern '<pattern>' --lang <lang> <path>
```

Semgrep uses the same `$VAR` / `$...VAR` metavariable syntax.

## Output format

For each match, return:

```
file:line  — <one-line description of what matched>
```

Group by file. After listing matches, add a one-sentence summary: total match count, languages searched, and whether structural matches overlapped with or extended the prior text search.

## When called from find-reuse

The find-reuse skill passes:

- The verb-noun term it already searched with ripgrep
- The list of file paths ripgrep returned (to avoid re-reporting identical matches)

This skill should:

1. Translate the verb-noun term into 1–2 structural patterns for the primary languages in `stack.json`.
2. Run ast-grep for each pattern.
3. Return only matches NOT already in the ripgrep result set (deduplication by `file:line`).

See `references/pattern-syntax.md` for how to translate common search terms into structural patterns.

---
name: codebase-stats
description: Quantitative answers about the repository — lines of code by language, file counts, test counts, age of code, contributor breakdown, ownership, churn. Use when the question is "how many", "how much", "who owns", or any other measurable property of the codebase.
---

# Codebase stats

Authoritative numbers about this repo. Use real tools, not hand-counts.

## Tool preference order

1. **`scc`** — fastest, most accurate. Treats comments and blanks correctly.
2. **`tokei`** — solid fallback.
3. **`cloc`** — works everywhere but slower.
4. **`git ls-files | xargs wc -l`** — last resort. Inaccurate (counts blanks and comments) but always available.

Use `command -v scc || command -v tokei || command -v cloc` to detect. If none are installed, surface that and offer to use the `wc` fallback with a caveat about accuracy.

## Common questions and how to answer them

### Lines of code by language

```
scc --no-cocomo .
```

Report: language, files, lines, code lines, comment lines, blank lines. Always note the commit SHA the count is from.

### Test code vs production code

```
scc --include-ext go,ts,py,rb,java .
scc --include-ext go,ts,py,rb,java --include-glob "*_test.go,*.test.ts,test_*.py,*_spec.rb,*Test.java" .
```

Report the ratio.

### Who owns what

Read `CODEOWNERS` (or `.github/CODEOWNERS`). Cross-reference with `git shortlog -sn -- <path>` for actual contributor activity.

### What's changed recently

```
git log --since="90 days ago" --pretty=format: --name-only | sort -u
git shortlog -sn --since="90 days ago"
```

### File count by directory

```
find . -type f -not -path "./.git/*" | sed "s|^./||" | cut -d/ -f1 | sort | uniq -c | sort -rn
```

See `references/scc-flags.md`.

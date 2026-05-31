# Diagnostic checklist (per tool)

## Bazel slowness

- [ ] Run `bazel analyze-profile profile.json` after a clean build with `--profile`.
- [ ] Identify the longest-running actions. Are they exec-bound, network-bound, or analysis-bound?
- [ ] Are there ungrouped sources causing many small actions?
- [ ] Is remote cache hit rate > 80%? `bazel info | grep cache`.
- [ ] Are `py_library` targets accidentally `srcs`-only when they should use `imports`?
- [ ] Are there `glob()` patterns that walk huge trees on every analysis?
- [ ] Is `--jobs` set to something sane for the host?
- [ ] Are deps overly broad? `bazel query "deps(//target)"` and look for surprises.

## Python packaging slow

- [ ] Wheel cache populated? `pip install --no-cache-dir` for comparison.
- [ ] Pinned vs unpinned? Resolver thrash dominates if unpinned.
- [ ] C extensions building from source on every CI run?

## npm/pnpm slow

- [ ] Is the lockfile committed and used? `npm ci` vs `npm install`.
- [ ] Are postinstall scripts doing heavy work?
- [ ] Workspace topology — are too many packages re-resolving?

This list is a starting point, not exhaustive. Always cite the tool's own docs when stating what "should" be.

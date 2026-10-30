# Clean-gate report: the overhaul branch

Measured 2026-10-13 on `claude/brave-newton-5ssiux` at `2d3160c` (base `da1fe0b`). The rules come
from the user's clean-code standard: functions within 30 lines, complexity 10 and 3 parameters, no
`as unknown as`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no coverage-ignore comments.

Two tools measure the rules, and they disagree. This report gives both:

- **ESLint** (the project's own check, `npm run lint`) measures size and `any`.
- **gate.py** (`/home/user/andytavares/claude/at/hooks/clean-gate/gate.py`, lizard 1.24.1) measures
  the handoff's two open items, repeated names and comment runs.

## Where it stands

Measured 2026-10-14 at `fe2e2a89`, after the clean-up passes. These numbers replace the numbers in
the sections below, which record the first measurement.

| Rule                                                  | First measurement | Now | Command                                                                              |
| ----------------------------------------------------- | ----------------- | --- | ------------------------------------------------------------------------------------ |
| Functions over the limits (ESLint, every file)        | 1                 | 0   | `npm run lint`                                                                       |
| Explicit `any`, counting ones behind `eslint-disable` | 25                | 0   | `npx eslint . --no-inline-config --rule '@typescript-eslint/no-explicit-any: error'` |
| `as unknown as` lines                                 | 256               | 0   | `git grep -n 'as unknown as' -- '*.ts' '*.tsx' '*.mts' '*.js' '*.mjs' '*.cjs'`       |
| Coverage-ignore comments                              | 30                | 0   | `git grep -niE '(istanbul\|v8\|c8) ignore' -- '*.ts' '*.tsx'`                        |
| Comment runs over 3 lines (gate.py)                   | 986               | 6   | `uv run --script findings.py origin/main..HEAD` (the script below)                   |
| Repeated names (gate.py)                              | 2,807             | 0   | same                                                                                 |
| Size and ratchet (gate.py, lizard)                    | 277               | 278 | same; ESLint reports 0                                                               |

The gate reads `.clean-gate.json`. The file makes the gate skip three groups:

- PNGs, which the gate could not decode.
- Names that an interface, a `vi.mock`, an event handler or a call site gives (`run`, `dispose`,
  `onKeyDown`). lizard counts these as function definitions. The owner asked to skip them.
- Names that lizard invents for an anonymous callback (`return`, `describe`, `useEffect`).

Functions that only shared a generic name now have names for what they do. Copies are merged.

What is left is listed in [clean-gate-findings.tsv](clean-gate-findings.tsv):

- **6 comment runs.** Three are lines of the template that `scripts/create-extension.cjs` writes into
  a new extension, not comments of that file. Three are file headers (`types/api.d.ts`,
  `electron-api/manifest.ts`), which the rule allows. The gate reports them because line 1 itself
  did not change.
- **278 size and ratchet findings.** lizard counts each field of a destructured parameter. It loses
  the end of a function after some generics and template literals. ESLint parses TypeScript and
  reports none over the limits.

## First measurement: result

| Rule                                                                    | At `da1fe0b` | Now | Command                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Functions over 30 lines, complexity 10 or 3 params (ESLint, every file) | 1            | 0   | `npx eslint . --rule 'max-lines-per-function: [error, {max: 30, skipBlankLines: true, skipComments: true}]' --rule 'complexity: [error, 10]' --rule 'max-params: [error, 3]'`                          |
| Explicit `any`, counting the ones behind `eslint-disable`               | 25           | 4   | `npx eslint . --no-inline-config --rule '@typescript-eslint/no-explicit-any: error' -f json`, filtered to that rule                                                                                    |
| `as unknown as` lines                                                   | 256          | 5   | `git grep -n 'as unknown as' -- '*.ts' '*.tsx' '*.mts' '*.js' '*.mjs' '*.cjs' \| wc -l`                                                                                                                |
| `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`                         | 0            | 0   | `git grep -nE '@ts-(ignore\|expect-error\|nocheck)' -- '*.ts' '*.tsx'` (3 matches, all text the review insights look for in a diff: `extensions/git-integration/src/review/insights.ts:291`, its spec) |
| Coverage-ignore comments                                                | 30           | 30  | `git grep -niE '(istanbul\|v8\|c8) ignore' -- '*.ts' '*.tsx' \| wc -l`                                                                                                                                 |

`npm run lint` now applies the size limits to every `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` and `.tsx` file, and `@typescript-eslint/no-explicit-any` is an error (`eslint.config.mjs`, last block;
`tests/unit/lint/size-limits.spec.ts`). That covers `tests/unit/e2e-harness/**`,
`tests/unit/support/**`, `tests/unit/extension-css-layers.spec.ts` and
`tests/integration/foundry-portability.spec.ts`. No block covered these files before.

## What was fixed

- 242 `as unknown as` lines in 85 extension spec files: `partialFake`, `vi.mocked`, `Object.assign` and
  `Reflect.deleteProperty` (commit `2a8d850`). The removal showed fixtures that no longer matched
  their types (a gate rule `merge`, a decision with `actor`, git files without `isBinary`). These are now fixed.
- 9 `as unknown as` lines in 8 extension source files (`4fa8a48`).
- 21 `any`: the remote shim, its spec, `build-api.spec.ts`, `review-agent.spec.ts` and
  `scripts/perf/git-integration.mts` (`ede6874`, `2a8d850`).
- The one function over the limits, `tests/integration/foundry-portability.spec.ts:64`, split into
  four describes (`16439dd`).

## First measurement: repeated names and comment runs

The handoff's 929 and 255 came from the report mode of gate.py over the branch. The run was in the main checkout:
`uv run --script /home/user/andytavares/claude/at/hooks/clean-gate/gate.py report origin/main..HEAD`
(2026-10-12 13:31 UTC; it also printed 121 size, 142 ratchet and 53,463 added lines). That command
now crashes: `git show` of the 118 Linux story baselines is not UTF-8, and gate.py decodes it as text.
An untracked `.clean-gate.json` of `{"ignorePaths": ["*.png"]}` skips the baselines, and the command
runs again. It did not finish in 2 hours, and we stopped it: it parses every file that mentions a
name once per name. The numbers below come from this wrapper. It calls the same `report_findings`
with the same PNG skip and caches the result of lizard per file. We measured at `16439dd` (the two
commits after it change no function). The wrapper finished in 11 minutes 26 seconds:

```sh
# from the repository root; findings.py is the script below
uv run --script findings.py origin/main..HEAD > findings.tsv
cut -f1 findings.tsv | sort | uniq -c   # 986 comment, 26 ratchet, 2807 repeat, 251 size
```

```python
# /// script
# requires-python = ">=3.10"
# dependencies = ["lizard==1.24.1"]
# ///
# Prints every finding gate.py's `report` mode counts, one per line, so the
# counts can be broken down by kind and directory.
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".claude/skills/at/hooks/clean-gate"))
import gate  # noqa: E402

# Same results, faster: each file is parsed by lizard once, not once per name.
_parse = gate.functions_of
_cache = {}


def cached_functions_of(path, text):
    key = (str(path), text)
    if key not in _cache:
        _cache[key] = _parse(path, text)
    return _cache[key]


gate.functions_of = cached_functions_of
root = gate.repo_root(Path.cwd())
config = gate.load_config(root)
# gate.py decodes `git show` output as text, which a PNG cannot be; skip them.
config["ignorePaths"] = [*config["ignorePaths"], "*.png"]
for f in gate.report_findings(root, sys.argv[1], config):
    print(f"{f.kind}\t{f.path}:{f.line}\t{f.message}")
```

| Finding                                                     | 2026-10-12 | Now                                     |
| ----------------------------------------------------------- | ---------- | --------------------------------------- |
| Added lines (`git diff --numstat origin/main HEAD`, summed) | 53,463     | 187,972                                 |
| Repeated names                                              | 929        | 2,807 (1,453 in source, 1,354 in specs) |
| Comment runs over 3 lines                                   | 255        | 986 (782 in source, 204 in specs)       |
| Functions over a limit (lizard)                             | 121        | 251                                     |
| Ratchet breaches (lizard)                                   | 142        | 26                                      |

The counts grew because the span grew: the branch added 134,509 more lines since the first count. No
fix of the four is small or mechanical, so all four are left:

- **Repeated names.** Most are not copies. lizard names a callback by the call that receives it, and
  sometimes by a keyword. The most repeated names are `run` (149, the `run` of each `ChannelSpec`),
  `return` (45), `useEffect` (40), `play` (28, Storybook) and `describe` (26). Methods that implement
  one interface (`register`, `dispose`, `close`) repeat by design. A real copy needs a judgement per
  name. `openInBrowser` in Foundry, Task Vault and the core is a real copy. An extension cannot import
  another extension (Constitution II), so sharing it means adding it to the SDK.
- **Comment runs.** 986 comments are longer than 3 lines in added code. Each needs a reading. Most
  state a constraint (ADR references, platform behaviour), which the standard keeps, in one to three
  lines. Shortening them is an edit per comment, not a mechanical change.
- **Size and ratchet (lizard).** ESLint finds no function over the limits. lizard finds 251. lizard
  counts a destructured props object as one parameter per field (`NoLimit({ row, draft, disabled,
onChange })`, `extensions/foundry/src/components/BudgetForm.tsx:131`, "4 parameters"). It loses the
  end of a function after some TypeScript generics (`useOrderMoves`, `Forge.tsx:597`, "1,211 lines").
  ESLint parses TypeScript with typescript-eslint, so trust its 0.

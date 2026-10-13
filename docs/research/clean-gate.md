# Clean-gate report: the overhaul branch

Measured 2026-10-13 on `claude/brave-newton-5ssiux` at `2d3160c` (base `da1fe0b`). The rules are the
ones in the user's clean-code standard: functions within 30 lines, complexity 10 and 3 parameters, no
`as unknown as`, no `@ts-ignore` or `@ts-expect-error`, no `any`, no coverage-ignore comments.

Two tools measure them, and they disagree, so both are reported:

- **ESLint** (the project's own check, `npm run lint`) for size and `any`.
- **gate.py** (`/home/user/andytavares/claude/at/hooks/clean-gate/gate.py`, lizard 1.24.1) for the
  handoff's two open items, repeated names and comment runs.

## Result

| Rule                                                                    | At `da1fe0b` | Now | Command                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Functions over 30 lines, complexity 10 or 3 params (ESLint, every file) | 1            | 0   | `npx eslint . --rule 'max-lines-per-function: [error, {max: 30, skipBlankLines: true, skipComments: true}]' --rule 'complexity: [error, 10]' --rule 'max-params: [error, 3]'`                          |
| Explicit `any`, counting the ones behind `eslint-disable`               | 25           | 4   | `npx eslint . --no-inline-config --rule '@typescript-eslint/no-explicit-any: error' -f json`, filtered to that rule                                                                                    |
| `as unknown as` lines                                                   | 256          | 5   | `git grep -n 'as unknown as' -- '*.ts' '*.tsx' '*.mts' '*.js' '*.mjs' '*.cjs' \| wc -l`                                                                                                                |
| `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`                         | 0            | 0   | `git grep -nE '@ts-(ignore\|expect-error\|nocheck)' -- '*.ts' '*.tsx'` (3 matches, all text the review insights look for in a diff: `extensions/git-integration/src/review/insights.ts:291`, its spec) |
| Coverage-ignore comments                                                | 30           | 30  | `git grep -niE '(istanbul\|v8\|c8) ignore' -- '*.ts' '*.tsx' \| wc -l`                                                                                                                                 |

`npm run lint` now holds every `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` and `.tsx` file to the size
limits, and `@typescript-eslint/no-explicit-any` is an error (`eslint.config.mjs`, last block;
`tests/unit/lint/size-limits.spec.ts`). That covers `tests/unit/e2e-harness/**`,
`tests/unit/support/**`, `tests/unit/extension-css-layers.spec.ts` and
`tests/integration/foundry-portability.spec.ts`, which were outside every block before.

## What was fixed

- 242 `as unknown as` lines in 85 extension spec files: `partialFake`, `vi.mocked`, `Object.assign` and
  `Reflect.deleteProperty` (commit `2a8d850`). Removing them showed fixtures that no longer matched
  their types (a gate rule `merge`, a decision with `actor`, git files without `isBinary`), now fixed.
- 9 `as unknown as` lines in 8 extension source files (`4fa8a48`).
- 21 `any`: the remote shim, its spec, `build-api.spec.ts`, `review-agent.spec.ts` and
  `scripts/perf/git-integration.mts` (`ede6874`, `2a8d850`).
- The one function over the limits, `tests/integration/foundry-portability.spec.ts:64`, split into
  four describes (`16439dd`).

## What is left, and why

| Where                                                                                               | What                                                | Why it stays                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `extensions/foundry/src/components/factory/canvas.ts:7`, `:10`                                      | `as unknown as string` on `fillStyle`               | The art kit's `PaintGradient` stands for a `CanvasGradient` that `createRadialGradient` made; TypeScript cannot prove that, and an `instanceof CanvasGradient` check throws in jsdom, which has no canvas. Fix: make the kit generic over the gradient type. |
| `packages/extension-sdk/src/index.ts:32`                                                            | `spec as unknown as ChannelSpec` in `defineChannel` | Widens `ChannelSpec<S>` to the registry's `ChannelSpec`; `run` takes the parsed payload, so the generic is not assignable. Removing it changes the SDK's public types (a major version).                                                                     |
| `src/main/extensions/host/api-server.ts:79`                                                         | `api as unknown as Record<string, unknown>`         | `memberAt` walks a dotted path the extension host sends at run time.                                                                                                                                                                                         |
| `src/main/integrations/providers/linear.provider.ts:56`                                             | `new LinearClient(...) as unknown as LinearLike`    | `LinearLike` is the narrow interface the provider and its specs use. Without the cast, `npx tsc --noEmit -p tsconfig.main.json` fails with TS2322: `viewer` is `LinearFetch<User>`, whose `assignedIssues` takes typed variables, not `unknown`.             |
| `src/main/ipc/channel-registrar.ts:26`, `:36`                                                       | 3 `any`                                             | The handler signature mirrors Electron's `ipcMain.handle` listener, which is `(...args: any[]) => any` ([Electron docs](https://www.electronjs.org/docs/latest/api/ipc-main#ipcmainhandlechannel-listener)); `unknown[]` rejects every typed handler.        |
| `src/main/storage/cached-store.ts:13`                                                               | 1 `any`                                             | electron-store 8 constrains its schema type to `Record<string, any>`; the schemas are interfaces, which `Record<string, unknown>` does not accept.                                                                                                           |
| `extensions/notepad/src/editor/{NoteEditor.tsx,livePreview.ts,commentField.ts}`, `NoteList.tsx:134` | 22 `v8 ignore`                                      | CodeMirror view code (widgets, decorations, DOM measuring) that jsdom cannot lay out; the e2e suite drives it.                                                                                                                                               |
| `extensions/foundry/src/factory/{callouts.ts:349,director.ts:213,sim.ts:251}`                       | `v8 ignore` on an exhaustive `switch` default       | Unreachable while the union is exhaustive; dropping the default removes the throw for a state read from a corrupted file.                                                                                                                                    |
| `extensions/foundry/src/factory/{director.ts:88,sim.ts:240,layout.ts:165}`                          | `v8 ignore` on an invariant guard                   | A hall always has the rest seats and floor these guard; no input reaches them.                                                                                                                                                                               |
| `extensions/foundry/src/trackers/write-back.ts:201`                                                 | `c8 ignore` on the return after the retry loop      | Every loop iteration returns; restructuring the loop is a behaviour change to the tracker write-back.                                                                                                                                                        |
| `vitest.config.ts:1`                                                                                | `v8 ignore file`                                    | The config itself is not code under test.                                                                                                                                                                                                                    |

## The handoff's two open items: repeated names and comment runs

The handoff's 929 and 255 came from gate.py's report mode over the branch, run in the main checkout:
`uv run --script /home/user/andytavares/claude/at/hooks/clean-gate/gate.py report origin/main..HEAD`
(2026-10-12 13:31 UTC; it also printed 121 size, 142 ratchet and 53,463 added lines). That command
now crashes: `git show` of the 118 Linux story baselines is not UTF-8, and gate.py decodes it as text.
Skipping them with an untracked `.clean-gate.json` of `{"ignorePaths": ["*.png"]}` runs it again,
but here it did not finish in 2 hours and was stopped: it parses every file that mentions a name once
per name. The numbers below come from this wrapper (measured at `16439dd`; the two commits after it
change no function), which calls the same `report_findings` with the same PNG skip and caches lizard's
result per file. It finished in 11 minutes 26 seconds:

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

sys.path.insert(0, "/home/user/andytavares/claude/at/hooks/clean-gate")
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

Every finding, with its `file:line`, is in [clean-gate-findings.tsv](clean-gate-findings.tsv).

The counts grew because the span did: the branch added 134,509 more lines since the first count. None
of the four is a small mechanical fix, so all are left:

- **Repeated names.** Most are not copies. lizard names callbacks by the call they are passed to and
  sometimes by a keyword: the most repeated names are `run` (149, the `run` of each `ChannelSpec`),
  `return` (45), `useEffect` (40), `play` (28, Storybook), `describe` (26). Methods that implement one
  interface (`register`, `dispose`, `close`) repeat by design. A real copy is a judgement per name:
  `openInBrowser` in Foundry, Task Vault and the core is one, but an extension may not import another
  extension (Constitution II), so sharing it means adding it to the SDK.
- **Comment runs.** 986 comments longer than 3 lines in added code. Each needs a reading: most state a
  constraint (ADR references, platform behaviour), which the standard keeps, in one to three lines.
  Shortening them is an edit per comment, not a mechanical change.
- **Size and ratchet (lizard).** ESLint finds no function over the limits; lizard finds 251. lizard
  counts a destructured props object as one parameter per field (`NoLimit({ row, draft, disabled,
onChange })`, `extensions/foundry/src/components/BudgetForm.tsx:131`, "4 parameters"), and loses the
  end of a function after some TypeScript generics (`useOrderMoves`, `Forge.tsx:597`, "1,211 lines").
  ESLint parses TypeScript with typescript-eslint, so its 0 is the number to trust.

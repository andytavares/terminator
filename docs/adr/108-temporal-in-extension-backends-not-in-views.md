# ADR 108: Temporal in an extension's backend, never in its view

**Status**: Accepted
**Date**: 2026-10-13
**Relates to**: Constitution Principles I and IV

## Decision

The backend of Task Vault computes dates with [`Temporal`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) (`PlainDate`, `ZonedDateTime`, `Instant`, `Duration`) instead of hand-written sums on `Date`. Its view does not use `Temporal`, and no extension view may.

| Code                                                               | Runs in                                                    | `Temporal`  |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ----------- |
| Backend: what `src/index.ts` imports and the view does not         | The extension host, Electron 44 (V8 15.2)                  | Allowed     |
| View: what `index.html`'s module (`src/renderer/main.tsx`) imports | The app's window, and the phone's browser (Remote Control) | Not allowed |
| A module both import                                               | Both                                                       | Not allowed |

Four rules follow:

1. **The view check has no `Temporal` type.** `extensions/task-vault/tsconfig.view.json` type-checks the view from its entry, through everything it imports. It does this without the `esnext.temporal` library of TypeScript. So a use of `Temporal` in any file the view reaches is `TS2304: Cannot find name 'Temporal'`. `tsconfig.json` and `tsconfig.test.json` add the library ([TypeScript 6.0, "New Types for Temporal"](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)). `npm run typecheck` runs all three. `tests/unit/lint/temporal-boundary.spec.ts` holds the three configs to this rule.
2. **Use `Temporal` for arithmetic and comparison only.** Format anything shown to a person with `Intl`, as before. What is stored or sent over a channel keeps its format: `YYYY-MM-DD` dates and `Date.prototype.toISOString()` instants.
3. **Read the clock with `Date.now()`** and turn the result into a `Temporal.ZonedDateTime` in one place (`src/vault/clock.ts`). The fake timers of the installed Vitest (4.1.11) replace `Date` and leave `Temporal.Now` alone. Under `vi.setSystemTime(new Date('2001-01-01'))`, `new Date()` read 2001 and `Temporal.Now.instant()` read today. The current Vitest documentation says a later version fakes `Temporal` when it is on the global object ([`fakeTimers`](https://vitest.dev/config/faketimers)). The clock can read `Temporal.Now` once the installed version does.
4. **Vitest's workers start with `--harmony-temporal`** (`execArgv` in `vitest.config.ts`). `tests/unit/config/temporal-runtime.spec.ts` fails without the flag. Remove the flag when `.nvmrc` reaches Node 26.

Another extension that wants `Temporal` in its backend adds the same two libraries and the same view config.

## Context

Measured on 2026-10-13:

| Runtime                                    | Command                                                                 | Result      |
| ------------------------------------------ | ----------------------------------------------------------------------- | ----------- |
| Electron 44.7.0, the extension host        | `ELECTRON_RUN_AS_NODE=1 npx electron -e "console.log(typeof Temporal)"` | `object`    |
| Node 24.21.0, where Vitest runs (`.nvmrc`) | `node -e "console.log(typeof Temporal)"`                                | `undefined` |
| Node 24.21.0 with the flag                 | `node --harmony-temporal -e "console.log(typeof Temporal)"`             | `object`    |

The compatibility table of MDN lists Node from 26.0.0, and no Safari on iOS ([browser-compat-data](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Temporal.json): `safari_ios: false`). Remote Control serves the view of Task Vault to the phone's browser, so the view has to run there.

The flagged implementation of Node 24 (V8 13.6) is an earlier draft than the one in Electron. The same script ran on both. It gave the same results for every sum and comparison the backend uses:

- `PlainDate.from`, including what it rejects
- `add`, `subtract` and `with({ day }, { overflow: 'constrain' })` on `PlainDate` and `ZonedDateTime`, with days, weeks, months, hours and minutes
- `startOfDay`, `compare`, `dayOfWeek`, `hour`, `minute`, `epochMilliseconds`
- `Instant.toZonedDateTimeISO`, and `Instant.toString({ fractionalSecondDigits: 3 })`

The results differed in two places. The backend uses neither:

- `Temporal.Now.timeZoneId()` and `ZonedDateTime.prototype.timeZoneId` do not exist on Node 24. The backend reads the system time zone with `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `PlainDate.prototype.toLocaleString('en-US', { month: 'short', day: 'numeric' })` gives "Jan 31, 2026" on Node 24 and "Jan 31" on Electron 44. Hence rule 2.

## Alternatives considered

| Alternative                                                          | Why rejected                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A polyfill (`temporal-polyfill`, `@js-temporal/polyfill`) everywhere | A dependency for what the extension host already has (Principle IV: the standard library when it satisfies the requirement), and tens of kilobytes in every view bundle. |
| `Temporal` in the view too                                           | The view stops loading on an iPhone.                                                                                                                                     |
| A lint rule on view folders (`no-restricted-globals`)                | A folder list misses a module that the backend and the view both import, as `src/vault/recurrence.ts` was. The type-check follows the imports.                           |
| Run Vitest on Node 26                                                | `.nvmrc` pins 24, the active LTS. Moving the whole toolchain is a separate decision.                                                                                     |
| Keep the arithmetic on `Date`                                        | It had the defects that hand-written sums produce: a day counted as 86,400,000 ms across a clock change, and a month as 30 days.                                         |

## Consequences

- A module that the backend and the view both import stays free of `Temporal`, or is split. For this reason `localDate()` moved from `src/vault/recurrence.ts` to `src/utils/local-date.ts`.
- Until Node 26, the specs run on an earlier `Temporal` than the app does. Check any method outside the set measured above on both runtimes before you use it.
- The calendar and date picker in the view keep their `Date` arithmetic.

# ADR 094: Extensions follow the VS Code model

**Status**: Accepted
**Date**: 2026-10-12
**Supersedes**: ADR-002 (extension host in the main process), ADR-025 (separate git parsers)
**Relates to**: Constitution Principle II (2.0.0), ADR-022, ADR-039

## Decision

The core and the extensions meet only through the Extension SDK, on the model that VS Code uses:

1. **One declaration.** `@terminator/extension-sdk` declares the Extension API. `src/main/extensions/api.ts` implements that declaration, and the compiler checks it. The tooling generates the renderer preload for extension views, and its types, from the channel manifest. Nobody writes them by hand.
2. **A separate process.** Extension backends run in one extension host process. Electron's [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) starts it, as VS Code runs its [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host). The API crosses on a `MessagePort`. Callbacks become registered ids with events. Synchronous getters become async or pushed snapshots. Terminal output becomes a batched stream.
3. **Imports.** An extension imports only the SDK, the design system (ADR 098) and its own declared npm packages. A lint rule rejects anything else.
4. **Shared functionality comes from the SDK.** When more than one extension needs something, the SDK adds it once. It is either an API member that the core implements, or a design-system export. Examples of API members are running git with a buffer limit, raw output and its own environment, and writing a file atomically. Examples of design-system exports are relative time and markdown.
5. **Extension to extension.** An extension offers an API by returning it from `activate`. A consumer declares the provider as a dependency in its manifest and uses only that object. This is [`extensionDependencies`](https://code.visualstudio.com/api/references/extension-manifest) and `exports` of VS Code. The [`getAPI`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts) of its built-in git extension is the precedent.
6. **Built-in extensions.** Foundry and task-vault ship with the app as built-in extensions. task-vault exposes its data to other extensions through its `activate` exports. Being built in grants no access to core internals.

## Context

ADR-002 put extension backends in the main process as a phase 1 measure. It said that a separate process would supersede it. The audit of 2026-10-11 found that this phase had outgrown its premise:

- About 43,000 lines of extension backend share the event loop that relays every terminal byte.
- Start-up waits for each extension in series.
- Extensions already use `child_process`, `electron-store` and `electron.app` directly.
- The published SDK has no importers.
- 32 extension source files import core source instead (`rg -l "from ['\"](\.\./)+src/" extensions -g '!**/tests/**'`).

Copies exist because sharing was forbidden without a legal shared home. ADR-025 kept two git parsers for that reason.

The team considered Foundry for the core. That would add 27,000 lines to the core. It would end the dependency direction that kept the changes of Foundry out of the core. It would still leave the work of Foundry on the main event loop. A built-in extension in the extension host gives Foundry a permanent place in the product without either cost.

## Alternatives considered

| Alternative                                 | Why rejected                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Keep backends in the main process           | The defect above; the API cannot be enforced in the same process            |
| One process per extension                   | More processes and memory with no measured need; VS Code uses one host      |
| Allow extensions to import any `packages/*` | Turns every workspace package into public API without anyone deciding it is |
| Foundry in the core                         | Above                                                                       |

## Consequences

- The work changes first the five things that cannot cross a process boundary today. It changes them one API namespace at a time, while backends still run in the main process. The move to `utilityProcess` follows.
- Nothing reaches the git parser of the core, so the work deletes it. The parser of git-integration is the only one, so the duplication of ADR-025 ends.
- The server of remote control moves with its extension into the extension host. The LAN exposure without TLS of ADR-017 stays an accepted risk.
- Extension channels become local-only unless an extension declares them remote-accessible (`src/main/extensions/api.ts`).

# ADR 094: Extensions follow the VS Code model

**Status**: Accepted
**Date**: 2026-10-12
**Supersedes**: ADR-002 (extension host in the main process), ADR-025 (separate git parsers)
**Relates to**: Constitution Principle II (2.0.0), ADR-022, ADR-039

## Decision

The core and the extensions meet only through the Extension SDK, on the model VS Code uses:

1. **One declaration.** `@terminator/extension-sdk` declares the Extension API. `src/main/extensions/api.ts` implements that declaration and the compiler checks it. The renderer preload for extension views and its types are generated from the channel manifest, not written by hand.
2. **A separate process.** Extension backends run in one extension host process started with Electron's [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process), as VS Code runs its [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host). The API crosses on a `MessagePort`; callbacks become registered ids with events, synchronous getters become async or pushed snapshots, terminal output becomes a batched stream.
3. **Imports.** An extension imports only the SDK, the design system (ADR 098) and its own declared npm packages. A lint rule rejects anything else.
4. **Shared functionality comes from the SDK.** Something more than one extension needs is added once: as an API member the core implements (running git with a buffer limit, raw output and its own environment; writing a file atomically), or as a design-system export (relative time, markdown).
5. **Extension to extension.** An extension offers an API by returning it from `activate`; a consumer declares the provider as a dependency in its manifest and uses only that object. This is VS Code's [`extensionDependencies`](https://code.visualstudio.com/api/references/extension-manifest) and `exports`, and its built-in git extension's [`getAPI`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts) is the precedent.
6. **Built-in extensions.** Foundry and task-vault ship with the app as built-in extensions. task-vault exposes its data to other extensions through its `activate` exports. Being built in grants no access to core internals.

## Context

ADR-002 put extension backends in the main process as a phase 1 measure and said a separate process would supersede it. The 2026-10-11 audit found that phase had outgrown its premise: about 43,000 lines of extension backend share the event loop that relays every terminal byte, start-up waits for each extension in series, and extensions already use `child_process`, `electron-store` and `electron.app` directly. The published SDK has no importers, and 32 extension source files import core source instead (`rg -l "from ['\"](\.\./)+src/" extensions -g '!**/tests/**'`). Copies exist because sharing was forbidden without a legal shared home: ADR-025 kept two git parsers for that reason.

Foundry was considered for the core. That would add 27,000 lines to the core, end the dependency direction that kept its changes out of the core, and still leave its work on the main event loop. A built-in extension in the extension host gives it a permanent place in the product without either cost.

## Alternatives considered

| Alternative                                 | Why rejected                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Keep backends in the main process           | The defect above; the API cannot be enforced in the same process            |
| One process per extension                   | More processes and memory with no measured need; VS Code uses one host      |
| Allow extensions to import any `packages/*` | Turns every workspace package into public API without anyone deciding it is |
| Foundry in the core                         | Above                                                                       |

## Consequences

- The five things that cannot cross a process boundary today are changed first, one API namespace at a time, while backends still run in the main process. The move to `utilityProcess` follows.
- The core's git parser is unreachable and is deleted; git-integration's parser is the only one, so ADR-025's duplication ends.
- Remote control's server moves with its extension into the extension host. ADR-017's LAN exposure without TLS stays an accepted risk.
- Extension channels become local-only unless declared remote-accessible (`src/main/extensions/api.ts`).

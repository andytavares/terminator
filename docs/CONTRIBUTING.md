# Contributing to Terminator

---

## Setup

```bash
git clone <repo-url>
cd terminator

# Install all dependencies (versions are pinned — do not use --legacy-peer-deps without cause)
# node-pty is NAPI-based (ABI-stable), so its `npm install` build works across
# Electron versions with no separate rebuild step.
npm install
```

**macOS with Python 3.12+**: node-pty's native build requires `setuptools`:

```bash
pip3 install setuptools --break-system-packages
```

---

## Development Workflow

### Start the app

```bash
npm run dev        # Electron + hot-reload via electron-vite
```

### Run tests

```bash
npm test                # Unit + integration (Vitest)
npm run test:watch      # Watch mode
npm run test:e2e        # E2E — launches real Electron app (Playwright)
npm run test:coverage   # Coverage report in coverage/
```

### Build extensions

Extension TypeScript is compiled to CommonJS bundles by esbuild. The output is gitignored — never commit `extensions/*/src/index.js`. Always rebuild after changing extension source files:

```bash
npm run build:extensions   # compile all extensions
```

`npm run dev` and `npm run build` call this automatically.

### Lint and format

```bash
npm run lint       # ESLint (zero errors required)
npm run typecheck  # TypeScript type check (no emit — zero errors required)
npm run format     # Prettier (auto-fixes)
```

Both `lint` and `typecheck` must pass with **0 errors** before opening a PR. Warnings are acceptable but should not accumulate.

---

## Branching

All work happens on feature branches. Direct commits to `main` are **forbidden**.

Feature branches follow the naming convention:

```
{sequential-number}-{kebab-case-description}
e.g. 001-extension-first-terminal
     002-marketplace-phase-two
```

---

## TDD (Non-Negotiable)

Per the [project constitution](../.specify/memory/constitution.md), **no production code is written without a failing test first**.

1. Write a failing test that captures the requirement.
2. Implement the minimum code to make it pass.
3. Refactor under a green suite.

Test location by type:

| Type        | Location             | When to use                                                |
| ----------- | -------------------- | ---------------------------------------------------------- |
| Unit        | `tests/unit/`        | Pure logic — schemas, storage, pty-manager, extension host |
| Integration | `tests/integration/` | IPC round-trips, storage read/write                        |
| E2E         | `tests/e2e/`         | Full acceptance scenarios against the real Electron app    |

---

## Documentation Requirements

**Documentation ships in the same PR as the code.** A feature is not complete until docs are updated. This is a hard requirement from the project constitution (Principle VI).

### When you add or change something, update:

| Change                              | Documentation to update                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| New feature or user-facing behavior | `README.md` features list and/or `docs/ARCHITECTURE.md`                                                           |
| New IPC channel                     | `specs/001-extension-first-terminal/contracts/ipc-channels.md` (master contract) and `src/renderer/electron.d.ts` |
| Change to extension API             | `specs/001-extension-first-terminal/contracts/extension-api.md` and `docs/EXTENSION-DEVELOPMENT.md`               |
| New npm script                      | `README.md` scripts table and `specs/.../quickstart.md`                                                           |
| Architectural decision              | New ADR in `docs/adr/`                                                                                            |
| Data model change                   | `specs/.../data-model.md` and `docs/ARCHITECTURE.md`                                                              |
| Setup step change                   | `README.md`, `docs/CONTRIBUTING.md`, `specs/.../quickstart.md`                                                    |
| New keyboard shortcut               | `README.md` features list, `contracts/extension-api.md` reserved list                                             |

---

## IPC Contracts

All IPC channels are defined in `specs/001-extension-first-terminal/contracts/ipc-channels.md`. Before adding a new channel:

1. Document it in the contracts file first.
2. Add the Zod validation schema to `src/shared/schemas/`.
3. Expose it in `src/main/preload.ts` and `src/renderer/electron.d.ts`.
4. Implement the `ipcMain.handle()` in the appropriate `src/main/ipc/*.ipc.ts` file.

---

## Architectural Decision Records (ADRs)

Significant decisions require an ADR in `docs/adr/`. ADRs are numbered sequentially (`005-`, `006-`, …). Template:

```markdown
# ADR-NNN: Title

**Date**: YYYY-MM-DD
**Status**: Accepted | Superseded by ADR-NNN

## Decision

One sentence.

## Motivation

Why this decision was made.

## Alternatives Considered

What else was evaluated and why it was rejected.

## Consequences

What this decision enables and what it constrains.
```

ADRs are **immutable**. If a decision is reversed, write a new ADR that supersedes the old one — do not edit the original.

---

## Dependency Policy

Per the constitution (Principle II):

- New dependencies require a brief justification in the PR: community health signal and official docs link.
- Versions must be pinned (no `^`, no `latest`).
- The standard library must be used when it covers the need; do not add a package for something Node.js provides.

---

## PR Checklist

Before opening a PR, verify:

- [ ] All tests pass (`npm test`)
- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run build:extensions` succeeds (no compile errors)
- [ ] No unused imports, variables, or dead code introduced
- [ ] Documentation updated for every changed behavior (see table above)
- [ ] New IPC channels documented in `ipc-channels.md` and typed in `electron.d.ts`
- [ ] ADR written if a significant architectural decision was made

# ADR 105: Duplicate code is a CI gate

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principles II, IV and V; [ADR 104](104-unused-code-is-a-ci-gate.md)

## Decision

Copy-pasted code fails the build. The check is [jscpd](https://github.com/kucherenko/jscpd), pinned at 5.4.1. It runs as `npm run lint:duplicates` in the CI lint job, after the unused-code gate. Its configuration is `.jscpd.json`:

- `path`: `src`, `packages` and `extensions`
- `minLines` 6 and `minTokens` 60: a clone is at least 6 lines and 60 tokens
- `ignore`: `**/*.spec.*`, `**/tests/**` and `**/stories/**`. Tests and stories repeat their setup on purpose, so that each one can be read alone.
- `threshold` 0 and `exitCode` 1: a single clone fails the run.

jscpd also skips what `.gitignore` lists, such as `node_modules`, the `dist` folders and the built `src/index.js` of each extension. No other path is ignored.

When the team added the gate, it found 138 clones (`npx jscpd`, this configuration). The team moved each clone to the one place it belongs, so the gate starts at zero:

- Code shared by the core and the extensions went to `@terminator/extension-ui` (controls, settings fields, the toast store) or `@terminator/extension-sdk` (the Vite config of the extension view).
- Code shared inside one extension went to a module of that extension.
- Repeated CSS declarations were grouped into one rule, placed where it keeps the cascade order.

Under Principle II an extension may import only the SDK, the design system and its own dependencies. So one extension never shares a clone between two extensions by importing the other.

## Why 5.4.1 and not 4.x

jscpd 4.0.5, the last 4.x release, finds files through `fast-glob`, which depends on `braces`. `braces` up to 3.0.3 is affected by [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). No patched `braces` has been released. Principle IV forbids adopting a package with an active advisory.

jscpd 5 is a rewrite in Rust. It is published on npm as `jscpd`, with one prebuilt binary package per platform (`jscpd-linux-x64-gnu` and the others) as optional dependencies. It has no JavaScript dependency tree, so `braces` is not part of it. Version 5.4.1 was published on 2026-10-09 ([npm](https://www.npmjs.com/package/jscpd/v/5.4.1); `npm view jscpd@5.4.1` lists only the platform binaries). With 5.4.1 in the lockfile, `npm audit --audit-level=high` exits 0.

## Principle IV exception

jscpd is published by one npm maintainer (`apk`, the author of the project), which Principle IV forbids. The project owner chose it for this gate. The exception is accepted on the same terms as syncpack ([ADR 097](097-one-version-per-dependency.md)) and knip (ADR 104). It is a development-only lint that never ships and never runs in the app. If it stops being maintained, the cost is one CI step. If it is deprecated or carries an active CVE, the project replaces it under the last rule of Principle IV.

## Alternatives considered

| Alternative                         | Why rejected                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| jscpd 4.0.5                         | Depends on `braces` through `fast-glob`; GHSA-vfj7-8cjw-p6xm has no patched version |
| SonarQube / SonarCloud duplications | A server or a hosted service for one metric; not a local `npm run` check            |
| PMD CPD                             | Needs a Java runtime in CI and on every contributor's machine                       |

## Consequences

- Write code that two places need once, where both may import it. A second copy fails CI.
- The fix for a clone is extraction, not an `ignore` entry. Widening `ignore` is a decision that gets its own ADR.
- The check does not cover tests, specs and stories.

# Memory Index

- [Documentation is mandatory](feedback_docs_mandatory.md) — Constitution Principle VIII: docs ship with code, never after. README + ARCHITECTURE.md + relevant contracts must be updated in the same session as implementation.
- [Extension deps in extension package.json only](feedback_extension_isolation.md) — NEVER put extension-only npm deps in root package.json. Constitution Principle II. npm workspaces hoist them; Vite resolves them. Root package.json = core app only.
- [Git Integration Feature Complete](project_git_integration_complete.md) — branch 002-git-github-integration, all 90 tasks done, 136 tests passing, ExtensionAPI v1.1.0 shipped.
- [80% test coverage is mandatory](feedback_test_coverage.md) — Every new file must reach ≥80% coverage. 0% is a defect. Run `npx vitest run --coverage` before reporting done. Hard blocker.

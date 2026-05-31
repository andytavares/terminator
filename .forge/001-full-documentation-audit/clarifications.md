# Clarifications — 001-full-documentation-audit

## Resolved (1)

### T-011 — Scaffold v1.2.0 scope

**Question:** Should T-011 only fix the documentation note (which was already accurate at v1.1.0), or also update `scripts/create-extension.cjs` to generate v1.2.0 stubs?

**Resolution:** Update scaffold to v1.2.0 stubs AND update the doc note.

**Impact on tasks.md:** T-011 description updated to expand scope to include scaffold script changes (`api.globalShortcut`, `api.workspace`, `api.window`, `api.sidebar.registerGlobalTab` stubs) and version bump in the generated template comment. Tag changed from `docs-only` to `production-code`.

**Secondary finding (no action required):** The git-integration renderer registers exactly two project tabs (lines 20 and 26 of `renderer.tsx`). The existing EXTENSION-DEVELOPMENT.md claim is accurate; the verification bullet in the original T-011 was dropped as a no-op.

## Deferred (0)

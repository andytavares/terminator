# ADR-019: ILIKE Search Instead of FTS5 for Notepad

**Status**: Accepted  
**Date**: 2026-06-21  
**Deciders**: Andrew Tavares

---

## Context

The Markdown Notepad extension previously used an SQLite FTS5 virtual table (`notes_fts`) for full-text search with BM25 relevance ranking. The extension then migrated from `better-sqlite3` to a shared PGlite (PostgreSQL) database, and FTS5 is no longer available.

PGlite supports PostgreSQL's native full-text search (`tsvector`/`tsquery`) and the `pg_trgm` extension for trigram-based ILIKE acceleration. Neither is enabled in the current PGlite build without additional setup.

---

## Decision

Replace FTS5 with case-insensitive `ILIKE '%query%'` pattern matching across the `title` and `body` columns. Results are ordered by `updated_at DESC`, not by BM25 relevance rank.

---

## Consequences

**Positive:**

- No virtual table maintenance: no `insertFts`/`deleteFts` calls on every autosave.
- The schema is simpler: one fewer table, no FTS5 triggers.
- It behaves correctly out of the box with PGlite, with no WASM extension loading.

**Negative:**

- **Performance**: leading-wildcard `ILIKE '%query%'` does not use a B-tree index and performs a full sequential scan. For note sets larger than a few thousand rows, search latency will degrade.
- **No relevance ranking**: results are returned by recency, not by how well they match the query.
- **No stemming or tokenisation**: FTS5 handled word boundaries. ILIKE matches substrings literally.

---

## Future Improvement

Enable a `pg_trgm` GIN index once PGlite ships support for it:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX notes_body_trgm ON notes USING gin (body gin_trgm_ops);
CREATE INDEX notes_title_trgm ON notes USING gin (title gin_trgm_ops);
```

This would restore indexed substring search without a separate FTS virtual table.
Track in issue: search scalability for large note sets.

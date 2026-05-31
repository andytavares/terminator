# Task Schema Reference

## Required fields

| Field                     | Format                          | Notes                                               |
| ------------------------- | ------------------------------- | --------------------------------------------------- |
| ID                        | `T-NNN` (zero-padded)           | Sequential within the feature                       |
| Title                     | Verb-noun, ≤ 10 words           | e.g. "Add login endpoint to auth service"           |
| Description               | One paragraph, prose            | No file names, no implementation choices            |
| Acceptance criteria       | Bulleted list, ≥ 2 items        | Each item is a testable behavior, not a file change |
| Depends on                | Comma-separated IDs or `(none)` | Only earlier IDs (lower number) allowed             |
| Tags                      | One or more of the values below | Space or comma separated                            |
| Touches tested package    | `yes` / `no` / `unknown`        | Resolved from `.claude/stack.json`                  |
| Touches documented module | `yes` / `no` / `unknown`        | Resolved from `.claude/doc-index.json`              |

## Tag values

| Tag               | Use when                                                       |
| ----------------- | -------------------------------------------------------------- |
| `production-code` | The task changes runtime behavior in a source file             |
| `docs-only`       | The task only updates markdown or other documentation          |
| `config`          | The task changes configuration files, env vars, or build setup |
| `scaffolding`     | The task creates new empty files, directories, or boilerplate  |

A single task may have multiple tags (e.g. `production-code config` for a task that adds a feature flag).

## Example entry

```
## T-002: Add password hashing to user creation
**Description:** When a new user is created, the plaintext password must be hashed before storage. The hashing algorithm and work factor must be configurable.
**Acceptance criteria:**
- Creating a user with a plaintext password stores a hash, not the plaintext
- The stored value passes verification against the original password
- The work factor is read from configuration and defaults to a safe value if absent
**Depends on:** T-001
**Tags:** production-code
**Touches tested package:** yes
**Touches documented module:** no
```

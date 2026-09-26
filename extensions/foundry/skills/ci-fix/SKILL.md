---
name: ci-fix
description: Use when a previous attempt failed a check or CI run handed back in the brief and needs fixing.
---

Read the failing output under "Your previous attempt failed a check" in the
brief. Reproduce it locally with the project's own command the brief names —
not a guess at one.

Fix the cause in the code. Never fix the check itself, and never make it pass
by skipping, weakening, or deleting a test. Keep the fix within the files the
unit already declared.

Commit the fix.

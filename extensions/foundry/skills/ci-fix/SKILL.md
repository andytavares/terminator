---
name: ci-fix
description: Use when a previous attempt failed a check or CI run handed back in the brief and needs fixing.
---

Read the failing output under "Your previous attempt failed a check" in the
brief. Reproduce the failure locally with the project's own command that the
brief names. Do not guess a command.

Fix the cause in the code. Never fix the check itself. Never make it pass by
skipping, weakening or deleting a test. Keep the fix within the files the unit
already declared.

Commit the fix.

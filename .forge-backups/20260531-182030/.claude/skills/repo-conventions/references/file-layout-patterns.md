# File layout patterns

When in doubt about where a new file belongs, run:

```
rg --files -g '!node_modules' -g '!vendor' -g '!target' | head -200
```

Identify the directory pattern (e.g. `src/<domain>/<feature>/`, `internal/<pkg>/`, `app/models/<resource>.rb`). Place the new file in the same pattern.

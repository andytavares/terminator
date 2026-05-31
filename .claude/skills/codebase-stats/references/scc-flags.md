# Useful scc flags

- `--no-cocomo` — drop the COCOMO cost estimation (cleaner output).
- `--include-ext <list>` — only count specific languages.
- `--include-glob <patterns>` — only files matching glob.
- `--exclude-dir <list>` — skip directories (defaults are sensible).
- `-f json` — JSON output for piping.
- `-s files|lines|code|complexity` — sort by column.

Source: scc README, https://github.com/boyter/scc (cite the README directly when quoting flags).

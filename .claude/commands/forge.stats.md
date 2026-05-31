---
description: Print a quick quantitative summary of the repository (lines by language, file counts, test ratio, top contributors)
---

Run the `codebase-oracle` subagent with the `codebase-stats` skill. Produce a concise summary:

- Lines of code by language (using scc/tokei/cloc, whichever is available).
- File count by top-level directory.
- Test-to-production ratio.
- Top 10 contributors over the last 90 days.

Report numbers only, no narrative. Cite the commit SHA the count is from.

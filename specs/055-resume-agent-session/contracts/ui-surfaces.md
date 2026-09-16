# Contract: UI surfaces

Addressed by role and name, as in feature 054.

- **Resume**: `button` named `Resume <session name>`, on the Ledger row, the Logbook detail, and the wall tile, wherever the session is exited or closed and resumable.
- **Not resumable**: where Resume would be, the text `Conversation no longer available` on a session that had one and no longer can be resumed. Nothing at all for a session that never had one.
- **Running sessions** show no Resume.
- **Failure**: when the terminal cannot be opened, the existing toast for a terminal that will not start says why; the session stays listed.
- Resume keeps the icon rules: a flat lucide icon inheriting text colour.

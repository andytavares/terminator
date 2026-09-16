# Quickstart: validating Session Home and Monitor Wall

Run from the repo root (or the feature worktree) on branch `054-session-home-wall`.

## 1. Project checks

The feature is done only when every one of these exits 0:

```sh
npm run format
npm run lint                  # 0 errors
npm test; echo "exit=$?"      # vitest run --coverage: exit=0, patch coverage ≥ 80%
npm run build
npx playwright test tests/e2e/session-home.spec.ts tests/e2e/monitor-wall.spec.ts
```

Check `$?`, not the pass count. Vitest can print all-passed and still exit 1 on an unhandled error.

## 2. Pure layer (fastest signal)

```sh
npx vitest run tests/unit/renderer/sidebar tests/unit/shared/session-records
```

These should prove the boundaries named in [contracts/pure-layer.md](contracts/pure-layer.md):

- The 30-day edge.
- A session link beating a project link.
- A prompt at the top of the screen, not the bottom, yielding `null`.
- Tile array order unchanged when a session moves between bands.

## 3. Home, by hand (US1, US2, US5, US7)

1. `npm run dev`. The app opens on **Home**, in Ledger.
2. Open three terminals in two workspaces, and link one project to a ticket in Settings → Integrations.
3. The Ledger shows three rows under two workspace/project groups. The linked project's row shows the ticket key and title. The other rows show **What is this session doing?**
4. Type a description in one row and press Enter. The Overview tab's tile for that session shows the same description.
5. Switch Layout to **Logbook**, then quit and relaunch. Home opens in Logbook, and the described session is listed under **Closed** with its description.
6. Type a word from the description into **Filter sessions**. The closed entry remains, and nothing else does.

## 4. Monitor wall, by hand (US3)

1. Open **Overview**, and run `yes | head -n 100000` in one terminal. Its tile shows output as it arrives.
2. Set tile size **Large**, toggle **Pin sessions that need you** off, then relaunch. Both settings are kept.
3. Close every terminal. Overview says no terminals are open and offers **Open a terminal**.

## 5. Answering in place, live (US4, research R6 `[UNVERIFIED]`)

This has to be done against a real agent at least once before the PR. No fixture proves Claude Code's key handling.

1. In a terminal, run `claude` in a scratch repo and ask: _"Create a file named a.txt"_. Claude pauses on the permission prompt, whose options are numbered `1.`, `2.` and `3.`.
2. Within about a second of the output settling, the session's tile moves into **Needs you** and shows buttons **1. Yes**, **2. …**, **3. No…**.
3. Press **1. Yes**. `a.txt` is created, and the tile leaves Needs you within 2 seconds (SC-003).
4. Repeat, but answer in the terminal itself before pressing a tile button, then press it. Nothing is sent, and the buttons disappear.
5. Record in the PR whether a bare digit confirmed the choice, or whether `\r` was needed (research R6).

## 6. Performance spot check (SC-005)

With 12 terminals open and 6 of them printing continuously, focus one idle terminal and type. There should be no visible lag. Record the DevTools Performance input-to-paint time for 10 keystrokes in the PR.

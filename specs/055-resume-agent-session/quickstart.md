# Quickstart: validating Resume

Run from the repo root on branch `055-resume-agent-session`.

## 1. Project checks

```sh
npm run format
npm run lint                  # 0 errors
npm test; echo "exit=$?"      # exit=0, patch coverage ≥ 80%
npm run build
npx playwright test tests/e2e/resume-session.spec.ts
```

## 2. The pure layer and the store

```sh
npx vitest run tests/unit/sessions tests/unit/ipc/session-records.ipc.spec.ts tests/unit/renderer/sidebar
```

Proves the boundaries in [contracts/session-records-ipc.md](contracts/session-records-ipc.md) and data-model: a record kept alive by a conversation alone, a second conversation replacing the first, `resumable` false when the transcript is gone, and transfer moving context in one write.

## 3. Capture, by hand

1. `npm run dev`, open a terminal on any branch.
2. Run `claude` and say anything.
3. Within 5 seconds, `userData/agent-sessions/<session id>.json` exists and names the conversation (`ls ~/Library/Application\ Support/Terminator/agent-sessions/`).
4. Quit the agent. Home and the wall offer **Resume** on that session.

## 4. Resume, live (R6, R7)

This is the run that proves the feature. No fixture can.

1. In a terminal, run `claude` and tell it: _"remember the number 4242"_.
2. Quit it with `/exit`. Its tab stays, showing an exited process.
3. Open Home. The session offers **Resume**. Press it.
4. A terminal opens on the same branch, and the exited tab is gone.
5. Ask: _"what number did I ask you to remember?"_ It answers **4242**.
6. Check the resumed session kept the description and work item link the old one had.

## 5. Restart

1. With a conversation running, quit Terminator and reopen it.
2. Home lists the session under **Closed**, offering **Resume**.
3. Resume it, and ask the same question. It answers.
4. Nothing started on its own: before pressing Resume, no agent is running.

## 6. When it cannot be resumed

1. Delete the transcript the record names.
2. That session shows `Conversation no longer available` and offers no Resume.

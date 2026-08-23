# Quickstart: validating tracker issues attached to projects

**Feature**: 031-linear-project-integration

How to prove this feature works, end to end, in the real application. Passing tests are not
completion (Constitution VI) — these scenarios are the manual validation that is.

## Prerequisites

- A Linear API key, and Jira site + email + API token.
- At least one issue assigned to you in each, with a description exercising markdown: a heading,
  a nested list, a task list, a table, a fenced code block, a link, and bold text.
- A workspace pointing at a git repository.

```bash
npm install
npm run dev          # builds extensions + remote, then launches Electron
```

## Automated gates — all three must pass before any scenario is claimed

```bash
npm run format
npm run lint                    # 0 errors (Constitution X)
npx vitest run --coverage       # all pass, ≥80% statements/branches/functions/lines
```

Run from the worktree directory. A coverage threshold failure is a hard blocker, not a warning.

---

## S1 — Connect once (US1, FR-001 → FR-006a)

1. Settings (`⌘,`) → **Integrations**.
2. Paste the Linear key. → Reports connected, naming your account.
3. Paste a deliberately wrong key into Jira. → Rejected inline; **nothing stored**.
4. Paste the real Jira credentials. → Reports connected, naming the site and account.
5. Quit and relaunch. → Both still connected, nothing re-entered.
6. Disconnect Jira. → Jira surfaces report not-connected; **Linear is unaffected**.

**Migration check (FR-004)**: with a Linear key already stored by SpecKit Pilot, launch a build
carrying this feature for the first time. Integrations shows connected without any entry, and
`<userData>/speckit-pilot-creds.json` has become `…-creds.json.bak`.

## S2 — Attach an issue (US2, FR-007 → FR-012)

1. Right-click a project → **Link issue…**
2. → Your assigned issues from **both** trackers are already listed, each showing which tracker
   it came from. No typing required.
3. Type a partial title → results narrow. Type an exact key → that issue is offered first.
4. Pick one, confirm. → The project's sidebar header shows the key with a state dot.
5. Relaunch. → Still there.
6. Right-click → pick a **different** issue. → You are warned the current one will be replaced;
   after confirming the project holds only the new issue (FR-033).
7. Remove the project. → The association is gone; `<userData>/integrations/` holds nothing for it.

**Not-connected path**: disconnect both trackers, open the picker. → A line telling you to
connect, and a way to get there. **Not** an empty list.

## S3 — Agent sessions know the issue (US3, FR-019 → FR-026) — _the one that matters_

1. Attach an issue to a project, injection on.
2. Open a terminal in that project and run `claude`.
3. Ask: _what am I working on?_
   → **Expected**: it answers with the key, title, state and the substance of the description,
   having been told nothing in this session.
4. → A notification appeared saying context was injected, with the character count.
5. **The hand-started case (FR-020)**: open iTerm — outside Terminator entirely — `cd` to the
   project directory, run `claude`, ask the same question. → Same answer.
6. Open `<projectDir>/.claude/settings.local.json`. → One `SessionStart` hook, inside a block
   clearly ours. If you had your own settings there, they are untouched.
7. Turn injection **off** for that project, start a new session. → No context, no notification.
8. **Unlink.** → `settings.local.json` is back to exactly what it was (or gone, if we created
   it); the context file under `userData` is gone. `git status` in the project is clean of
   anything we did (SC-010).

**Over-budget case (FR-022)**: attach an issue with a very long description and thread. → The
drawer's counter shows the truncation; the injected text ends with a pointer to the issue URL;
the session still starts.

**Unwritable case (FR-026)**: `chmod -w` the project directory, then try to link. → Linking
fails with a plain reason. It does **not** half-link and it does **not** start sessions that
silently lack context.

## S4 — Read the issue, rendered (US4, FR-013 → FR-018)

1. Click the issue key on the project header. → Drawer opens: key, title, state, assignee,
   labels, last-updated.
2. → Headings, nested lists, task lists, tables, code blocks, bold and links all render as
   **formatted content**. No `##`, no `**`, no pipe-table source visible anywhere.
3. Do the same with the **Jira** issue. → Identical rendering. (Jira stores ADF, not markdown —
   this proves the conversion.)
4. Click a link in the description. → Opens in your **browser**; the app does not navigate.
5. **Security (FR-015)**: put this in an issue description, then open the drawer —

   ```markdown
   <script>window.__pwned = 1</script>
   <img src=x onerror="window.__pwned = 2">
   [click me](javascript:alert(1))
   ![remote](https://example.com/pixel.png)
   ```

   → Expected: nothing executes (`window.__pwned` is undefined in devtools), the
   `javascript:` link is inert, and **no network request is made for the remote image** —
   check the Network tab. Any of those failing is a release blocker.

6. **Refresh** → current data, cache bypassed.
7. **Comment** → appears on the issue in the tracker and in the list. Then break it deliberately
   (revoke the credential mid-session) and comment again → you are **told it failed** and your
   text is still there (FR-034a).
8. Read the **Claude session context** block → it is exactly what S3 injected, same character
   count.

## S5 — Project from an issue (US5, FR-011)

1. New project → **From issue** → pick a **Linear** issue.
2. → Name and branch prefill; the branch is Linear's own suggested name.
3. Pick a **Jira** issue instead. → Branch falls back to key + title (Jira has no suggested
   branch name — expected, not a bug).
4. Edit the name, create. → Your edit is kept and the project is already linked.

## S6 — One connection behind everything (US6, FR-027 → FR-032)

1. Open the SpecKit Pilot board and import assigned issues. → Same cards as before, from both
   trackers, with no credential of its own.
2. Open a PR in the git-integration review view whose description references an issue. → Title
   and state shown beside the key, not a bare key (FR-030).
3. Open the drawer, the sidebar badge and the board at once for the same issue. → One request in
   the network log within the cache window, not three (SC-008).
4. Disconnect a tracker. → Every dependent surface says **not connected** — none shows an empty
   list, and none shows stale data as if current (FR-032).
5. **The isolation proof (SC-012)**: disable every extension, relaunch. → Connecting, attaching,
   reading and feeding all still work.
6. **PR-open comment (FR-034a)**: with the setting **off** (default), open a PR from a card with
   an attached issue → nothing is written to the tracker. Turn it on, repeat → a comment appears;
   break it and repeat → you are told, and the failure is not discarded.

---

## Things not to take on faith

Five facts the documentation could not settle. All five are closed — each stated in plain terms,
with what was done about it, in [verifications.md](./verifications.md). Two were proven against
live systems; three were closed by decision with the reasoning written down.

## Definition of done

- [ ] `npm run format`, `npm run lint` (0 errors), `npx vitest run --coverage` (≥80%) all pass
- [ ] S1–S6 walked manually, in the real app
- [ ] The five open questions closed in writing (verifications.md)
- [ ] ADR written for the core issue-tracker service and the SessionStart injection
- [ ] `docs/ARCHITECTURE.md`, `docs/EXTENSION-DEVELOPMENT.md` (v2.2.0) and the user guide updated
      **in the same PR** (Constitution VIII)
- [ ] No tracker credential, client, or settings UI remains in any extension

# Things we did not want to take on faith

Five facts this feature depended on that could not be settled by reading documentation. Each is
recorded here with what was actually done about it — not with an assumption.

**Status: all five closed.** Two verified, three closed by decision with the reasoning below.

| #   | The question, in plain terms                                                                                               | Outcome                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | When we post a comment to Linear, can we name the issue by its human key (`TAV-9`), or must we use Linear's internal UUID? | **Closed by decision** — UUID everywhere, so the question stops applying.                         |
| 2   | The old code commented on your ticket when a PR opened, and hid every error. Did it ever actually work?                    | **Closed — unanswerable.** That code is deleted; what replaced it is tested and reports failures. |
| 3   | Does a `claude` you start yourself, in a terminal outside Terminator, really receive the issue?                            | **Verified.** Proven with a live agent and a control run.                                         |
| 4   | After you unlink an issue, is your project directory exactly as it was?                                                    | **Verified**, by an automated test that cannot silently regress.                                  |
| 5   | Does Jira's issue search page correctly past the first page of results?                                                    | **Accepted on fixtures** by the operator; real Jira users will exercise it.                       |

---

## 3. Does a hand-started `claude` receive the issue context? ✅ **VERIFIED**

**Why it mattered**: FR-020 is the requirement that chose the whole mechanism. If a session the
operator starts themselves does not get the context, the `SessionStart` hook buys nothing over the
launch-time `--settings` flag it was chosen instead of (ADR-030).

**Method**: built a project directory containing nothing but `.claude/settings.local.json` with the
hook, and a context file naming a **fictional** issue — `TAV-9142, "Giraffe telemetry pipeline
overflows on leap seconds"` — chosen so it could not possibly be answered from any real tracker.
Then ran `claude` from an ordinary shell in that directory, outside Terminator entirely.

```
$ cd <project> && claude -p "What issue key am I working on, and what is its
                             one-line title? Answer in one sentence."

You're on TAV-9142: "Giraffe telemetry pipeline overflows on leap seconds."
```

**Control**, same prompt, same machine, a directory with **no hook installed**:

```
No issue is actually in progress — the only open one assigned to you in Linear is
TAV-14: "Make all text in the application red" (status: Backlog) …
```

The control reached a real tracker and answered something else entirely. The only way the first run
could name a fictional issue is the hook. **Conclusive.**

Also confirmed by the automated test that executes the script under node: the emitted JSON carries
`hookEventName` — the field ADR-026 records as failing _silently_ when omitted.

---

## 4. Is the project directory unchanged after unlinking? ✅ **VERIFIED**

**Method**: automated, not manual — `tests/unit/integrations/context-sync.spec.ts` and
`tests/unit/integrations/session-hook.spec.ts` compare `fs.readdirSync(projectDir)` before
attaching and after detaching, and assert equality. Covered cases:

- We created everything → file and `.claude` directory both gone; listing identical to before.
- The file already existed with the operator's own settings → restored to exactly those.
- Another tool's `SessionStart` hook was present → left in place, ours removed.
- `.claude` contained other things → directory kept, only our file removed.

Being a test rather than a one-off inspection, this cannot silently regress. **SC-010 met.**

---

## 1. Naming an issue when commenting on Linear ✅ **CLOSED — the answer does not change anything**

**The question.** Linear's API needs to know which issue a comment belongs to. You can identify an
issue two ways: by the key you see in the UI (`TAV-9`), or by Linear's internal UUID. Linear's
documentation confirms the key works for _reading_ an issue. It says nothing either way about
using it when _creating a comment_.

**Why it came up.** The extension this feature replaces passed the key, and wrapped the whole call
in `.catch(() => {})`. So if Linear rejected it, the comment silently never appeared and nobody —
including us, reading the code years later — could tell.

**What we did instead of finding out.** The provider looks the issue up by key, takes its UUID,
and comments with that. The UUID is documented to work in every case, so the question stops
mattering. A test asserts the lookup happens.

**Decision (operator, 2026-08-22): use the UUID across the board.** Linear issues are addressed by
UUID everywhere, not just when commenting — never by the human key, even where Linear would accept
one. One addressing mechanism is one thing to be right about, and it is the form documented as
working for every operation.

That closes the question by making it not apply, rather than by answering it. Answering it would
have meant posting two real comments to a real issue in the operator's workspace, and the only
thing that buys is permission to delete one lookup call.

## 2. Did the old "PR opened" comment ever work? ✅ **CLOSED — the code it asked about is gone**

The path it referred to **no longer exists**. It called `postLinearComment(key, ticket.key, …)`
through the extension's own client, wrapped in `.catch(() => {})`. Both the client and the empty
catch are gone: it now goes through `api.issues.comment()`, which resolves key → UUID and rejects
on failure, and a failure is surfaced to the operator as a toast.

So the original question — "did _that_ code ever post a comment?" — can no longer be answered, and
answering it would mean restoring code we deliberately deleted. What replaced it is covered by
tests: the write is off by default, it reaches the tracker through the single connection when on,
and its failure is reported rather than discarded.

**What would still need a live run** is one real comment on a real issue, confirming the whole
path end to end — the same live write question 1 raised, and not worth a write to someone's
tracker for the same reason.

## 5. Jira search paging past the first page ✅ **CLOSED — accepted on fixtures**

**The question.** Jira returns search results a page at a time, handing back a token for the next
page. Our tests model that with recorded fixtures — two pages and a token — which reproduces what
Atlassian's documentation describes, but is not the live API confirming it.

**Outcome.** The operator accepted the fixtures and will have the feature exercised by real Jira
users, who will surface anything the documentation got wrong faster than a single synthetic run
would. Recorded as a decision, not an oversight.

Worth knowing if it ever does misbehave: the old extension called `GET /rest/api/3/search`, which
Atlassian documents as being deprecated and removed. This feature moved to `/search/jql`, so a
paging problem here would be new code being wrong — not the old endpoint dying.

---

## Quickstart walkthrough (T109) — what was actually exercised

Run in the real dev app, 2026-08-22, against the operator's **live Linear workspace**.

### ✅ S1 — Connect once, and the migration

Settings gained an **Integrations** section, and Linear showed **Connected** with the
assigned-issue lookup already filled in — **without any credential being entered**. That is
FR-004 adopting the key SpecKit Pilot had stored, proven on real data rather than a fixture.
Jira showed **Not connected** with its form, as it should.

### ✅ S5 — Start a project from an issue (live)

The new-project dialog's **Start from an issue** picker listed the operator's real assigned
issues — TAV-14, TAV-10, TAV-6, TAV-7, TAV-8, TAV-9, TAV-12 — each labelled `Linear`. Selecting
TAV-9 filled in the name and the branch, both editable.

### ✅ S3 — Agent context

Verified separately and conclusively — see question 3 above.

### ⏸ S2, S4, S6 — not walked to completion

These need a project created in the operator's real workspace and an issue attached to it, which
writes into a real repository directory. The mechanics are covered by tests (link store, badge,
drawer, markdown security, extension migration); what is untested is only the final click-through.

### Two defects this walkthrough found, both fixed

Neither would have been caught by the test suite, because both were about what the real API
returns and what the operator actually reads:

1. **Linear's suggested branch name never reached the picker.** `IssueSummary` did not carry
   `branchName`, so every project created from a Linear issue fell back to a derived branch —
   FR-011 says to use the tracker's own where it offers one. Fixed by putting `branchName` on the
   summary (Linear returns it on the same query the list already makes, so it costs nothing), and
   the prefill now reads `andrewtavares87/tav-9-high-risk-filter-…` — Linear's own name, username
   prefix and all.
2. **"Jira unavailable" for a tracker that was never connected.** Misleading: nothing was
   unavailable, it simply was not set up. The picker now stays silent about `not-connected` and
   names only real failures, matching what the link dialog and the board already did.

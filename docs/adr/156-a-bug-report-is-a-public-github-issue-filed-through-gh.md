# ADR 156: A bug report is a public GitHub issue, filed through the user's gh

**Status**: Accepted

**Date**: 2026-11-09

## Context

The maintainer asked for bug reports, with text, images and videos, from anywhere in the app and from any user, ending up in Linear. The research and design ("In-App Bug Reporter", 2026-11-09) compared four routes:

- **A relay service holding a Linear key.** Works for anyone, but it is a hosted service to run and protect.
- **A Linear key inside the app.** Anyone could extract it.
- **Linear's own intake (email, Asks web forms).** Email needs a mail-sending service, so a server anyway. Web forms are Enterprise-only and need sign-in through the company's identity provider.
- **GitHub issues on the app's public repository.** No server. Linear can copy issues over.

The maintainer chose GitHub issues. The workspace is on Linear's free plan, which stops new issues past 250 (https://linear.app/docs/billing-and-plans). So Linear's GitHub sync stays off: the maintainer triages on GitHub and creates Linear issues by hand for accepted bugs.

GitHub's REST API has no way to upload an attachment to an issue. `gh issue create --attach` uploads images and videos and puts them in the body (https://cli.github.com/manual/gh_issue_create).

## Decision

- **Core owns it.** Help › Report a Bug… (`CmdOrCtrl+Shift+B`), a Quick Action and a Report button on error toasts open one dialog in the main window. It must work with every extension deleted (Constitution II).
- **Posted through the user's gh.** The main process checks `gh issue create --help` for `--attach` (which release added it is not documented), then `gh api user` for the signed-in account. When both pass, it runs `gh issue create --repo andytavares/terminator --body-file - --attach …`. gh is already in core's command allowlist, so nothing new is installed.
- **Otherwise, the browser.** The dialog copies the files into one folder under `<userData>/reports/`, shows it in Finder, and opens `.github/ISSUE_TEMPLATE/bug_report.yml` with the text filled in through URL parameters. The form's `labels` key labels the issue; a URL `labels` parameter would need label permission the reporter does not have.
- **Only files main handed out.** A report attaches a window capture main saved or a file the user chose in the file picker. Any other path is refused, so a renderer cannot attach an arbitrary file to a public issue.
- **10 MB per file.** GitHub's limit for images, and for video in a repository on a free plan. The lowest limit that applies, so GitHub never refuses a file the dialog accepted.
- **No screen recording.** The maintainer left it out. "Capture window" uses `webContents.capturePage()`, which needs no macOS permission.
- **Not MCP tools.** A public issue goes out only on the user's own click.

## Alternatives considered

- **Pass `--label` from the app.** Likely refused or dropped for reporters without triage rights on the repository. The body ends with "Sent from Terminator's bug reporter." instead.
- **Linear's GitHub Issues Sync.** It copies every issue, spam and duplicates included, into a free workspace capped at 250.

## Consequences

- Every report is public, screenshots included. The dialog says so above the form, and shows the app details it will send.
- Reporters need a GitHub account. Without gh they finish in the browser and drag the files in by hand.
- `appDetails` names the app version, the OS version and the installed extensions. Nothing else about the machine leaves it.

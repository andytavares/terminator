# Feature Specification: Git & GitHub Integration Extension

**Feature Branch**: `002-git-github-integration`
**Created**: 2026-05-07
**Status**: Draft
**Input**: User description: "Git and GitHub integration built as a first-party extension using gh CLI, with a toggleable change sidebar, a full git view for staging/committing/PR creation, and configurable settings via workspace or global configuration."

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Toggle the Git Changes Sidebar (Priority: P1)

A developer working inside a project that is a git repository wants a quick glance at which files have changed without leaving the terminal view. They toggle a right sidebar that lists all modified, untracked, and staged files for the current working directory.

**Why this priority**: This is the lowest-friction entry point into the git workflow. It delivers immediate value with minimal UI surface and is the gateway to all deeper git interactions.

**Independent Test**: Open a git repository in the terminal, enable the Git Changes sidebar from the View menu (or keyboard shortcut), and confirm the sidebar appears showing current changed files with their status indicators. Can be tested entirely without the full git view.

**Acceptance Scenarios**:

1. **Given** a project directory that is a git repository, **When** the user toggles the git sidebar on, **Then** a right sidebar appears listing all changed files with their git status (modified, untracked, staged, deleted).
2. **Given** the sidebar is visible, **When** the user toggles it off, **Then** the sidebar collapses and the terminal view expands to fill the space.
3. **Given** the sidebar is open and files change on disk, **When** the filesystem changes, **Then** the sidebar refreshes automatically within a few seconds.
4. **Given** the project directory is not a git repository, **When** the user tries to open the sidebar, **Then** the sidebar shows a clear message explaining git is not detected and git operations are unavailable.
5. **Given** the sidebar is open, **When** the user resizes the application window, **Then** the sidebar width adapts gracefully without breaking layout.

---

### User Story 2 — Stage Files and Commit from the Git View (Priority: P2)

A developer has made changes across several files and wants to selectively stage some of them and write a commit message — all without leaving the application. They open the dedicated git view, review individual file diffs, select files to stage, write a commit message, and commit.

**Why this priority**: Staging and committing is the core git workflow. Once the sidebar exists, the next most critical capability is acting on those changes without context-switching to a separate terminal.

**Independent Test**: Open the git view panel, click a changed file to see its diff, check the checkbox next to specific files to stage them, enter a commit message, and click "Commit". Verify the commit appears in git log and staged files are cleared. Fully testable without GitHub/PR functionality.

**Acceptance Scenarios**:

1. **Given** the git view is open, **When** the user clicks on a changed file, **Then** a diff view opens showing added lines (green), removed lines (red), and context lines with line numbers.
2. **Given** the git view is open with changed files listed, **When** the user checks the checkbox next to a file, **Then** that file is visually marked as staged and reflected in a "Staged" vs "Unstaged" grouping.
3. **Given** at least one file is staged, **When** the user enters a commit message and clicks "Commit", **Then** a commit is created containing only the staged files, the staged list clears, and a success confirmation is shown.
4. **Given** the user clicks "Commit" with no files staged, **Then** the action is blocked with a clear explanation that at least one file must be staged.
5. **Given** the user clicks "Commit" with an empty commit message, **Then** the action is blocked with a prompt to enter a message.
6. **Given** a commit succeeds, **When** the user returns to the sidebar or git view, **Then** the committed files no longer appear as changed.

---

### User Story 3 — Open a Pull Request via gh CLI (Priority: P3)

A developer has committed their changes to a feature branch and wants to open a pull request on GitHub directly from the application. They use the "Open Pull Request" action in the git view, fill in the PR title and body, and submit. The gh CLI handles the GitHub communication.

**Why this priority**: PR creation is the natural end of the commit workflow and a key productivity win. It depends on P2 (commits) and requires gh CLI to be installed, so it is scoped later.

**Independent Test**: On a branch with at least one commit ahead of the base branch, open the PR creation dialog, enter a title and description, confirm the base branch, and click "Create PR". Verify a PR URL is returned and opened in the browser. Requires gh CLI authenticated against GitHub.

**Acceptance Scenarios**:

1. **Given** the current branch has commits not present on the base branch and gh CLI is authenticated, **When** the user clicks "Open Pull Request", **Then** a dialog appears pre-filled with the branch name as title and a summary of commits as the description.
2. **Given** the PR dialog is open, **When** the user edits the title and body and clicks "Create PR", **Then** a pull request is created on GitHub and the PR URL is displayed in-app with an option to open it in the browser.
3. **Given** gh CLI is not installed or not authenticated, **When** the user attempts to create a PR, **Then** a clear error message explains the missing prerequisite and links to setup instructions.
4. **Given** the current branch is the default branch (e.g., main/master), **When** the user clicks "Open Pull Request", **Then** a warning is shown advising against opening PRs from the default branch.
5. **Given** a PR already exists for the current branch, **When** the user clicks "Open Pull Request", **Then** a message informs them of the existing PR with a link to view it instead of creating a duplicate.

---

### User Story 4 — Configure the Extension via Settings (Priority: P4)

A developer wants to customize how the git integration behaves — for example, disabling the auto-refresh interval, changing the default sidebar state, or specifying a custom gh CLI path — both globally and per workspace.

**Why this priority**: Configurability is essential for adoption across diverse environments, but it is layered on top of the core functionality and does not block basic use.

**Independent Test**: Open global settings, find the Git Integration section, change the sidebar auto-refresh interval to a custom value, save, and verify the sidebar respects the new interval. Then create a workspace-level override and verify it takes precedence. Testable without GitHub connectivity.

**Acceptance Scenarios**:

1. **Given** the extension is installed, **When** the user opens global settings, **Then** a "Git Integration" section is present with all configurable options documented with descriptions and defaults.
2. **Given** a workspace-level settings file exists with a git integration key, **When** the extension loads, **Then** workspace settings take precedence over global settings for that key.
3. **Given** the user sets `git.sidebar.defaultOpen` to `true` in global settings, **When** they open a git repository project, **Then** the sidebar opens automatically without manual toggling.
4. **Given** the user sets `git.ghCliPath` to a custom binary path, **When** a PR action is triggered, **Then** the extension uses the specified binary rather than the system PATH lookup.
5. **Given** the user disables the extension (`git.enabled: false`) in workspace settings, **When** the project opens, **Then** no git sidebar or git view controls are shown for that workspace.

---

### Edge Cases

- What happens when a git operation (status, diff, commit) takes longer than expected? A loading indicator is shown; if the operation times out, an error message appears without crashing the view.
- What happens when the user modifies files while a diff is displayed? The diff view shows a stale indicator and offers a "Refresh" action.
- How does the system handle binary files in the diff view? Binary files are flagged as binary with no diff content shown, but they can still be staged/unstaged.
- What happens if gh CLI exits with a non-zero status during PR creation? The full error output from gh is surfaced to the user in an error dialog.
- What happens when the repository has merge conflicts? Conflicted files are shown with a distinct indicator; staging them is blocked until conflicts are resolved.
- What happens when there is no remote configured for the current branch? The "Open Pull Request" button is disabled with a tooltip explaining no remote is configured.

---

## Requirements _(mandatory)_

### Functional Requirements

**Extension Architecture**

- **FR-001**: The git integration MUST be delivered as a self-contained extension that can be installed, uninstalled, and updated independently of the core application.
- **FR-002**: The extension MUST expose all its functionality through the application's existing extension/plugin API, using only documented public APIs.
- **FR-003**: The extension MUST register any new IPC channels, sidebar panels, view panels, menu items, and settings schemas through the extension API — not by modifying core application code.
- **FR-004**: The git integration extension MUST ship pre-bundled with the application and be manageable (enable/disable/uninstall) from within the application's extension management UI. The extension management UI MUST also support installing additional extensions from a local directory path or package file.

**Git Sidebar Panel**

- **FR-005**: The extension MUST add a toggleable right sidebar panel showing all changed files in the current project's working directory.
- **FR-006**: The sidebar MUST display each file with its git status (modified, untracked, staged, deleted, renamed) using distinct visual indicators.
- **FR-007**: The sidebar MUST refresh its file list automatically when file changes are detected. The primary mechanism MUST be OS-level filesystem watch events; when the filesystem does not support watch events (e.g., network drives, Docker volumes), the sidebar MUST fall back to configurable-interval polling. The fallback polling interval MUST be configurable in settings.
- **FR-008**: The sidebar MUST be dismissible via a keyboard shortcut and a menu item in the View menu.
- **FR-009**: The sidebar MUST gracefully handle non-git directories by displaying a clear "not a git repository" message.
- **FR-009a**: When the number of changed files exceeds a configurable maximum (default: 500), the sidebar and git view MUST cap the displayed file list at that limit and show a prominent banner explaining the cap and recommending a `.gitignore` review. The cap MUST be adjustable via `git.maxDisplayedFiles` in settings.

**Git View Panel**

- **FR-010**: The extension MUST provide a dedicated git view panel (accessible from the top menu bar within the project view) that shows all changed files grouped into "Staged" and "Unstaged" sections.
- **FR-011**: Users MUST be able to click any changed file in the git view to see its diff rendered with added/removed line highlighting and line numbers.
- **FR-012**: Users MUST be able to stage or unstage individual files by toggling a checkbox next to each file.
- **FR-013**: Users MUST be able to stage all or unstage all files with a single action.
- **FR-014**: Users MUST be able to enter a commit message and commit staged changes without leaving the application.
- **FR-015**: The commit action MUST be blocked (with explanation) if no files are staged or if the commit message is empty.

**GitHub Integration via gh CLI**

- **FR-016**: The extension MUST use the `gh` CLI for all GitHub API operations (PR creation, PR status lookup).
- **FR-017**: The extension MUST detect whether `gh` CLI is installed and authenticated before offering GitHub-specific actions.
- **FR-018**: Users MUST be able to create a pull request from the current branch via the git view, providing a title, description, and a "Create as Draft" toggle.
- **FR-019**: The PR creation dialog MUST pre-populate the title from the branch name and the description from a summary of recent commit messages. The "Create as Draft" toggle MUST default to off.
- **FR-020**: Upon successful PR creation, the extension MUST display the PR URL in-app and offer to open it in the default browser. The displayed URL MUST indicate if the PR was created as a draft.
- **FR-021**: The extension MUST check whether a PR already exists for the current branch before offering to create one.

**Extension API Requirements**

- **FR-022**: The extension API MUST expose a mechanism for extensions to register sidebar panel components with a defined panel slot (e.g., right sidebar).
- **FR-023**: The extension API MUST expose a mechanism for extensions to register top-bar menu items within the project view.
- **FR-024**: The extension API MUST expose an IPC bridge allowing extensions to invoke shell commands in the main process and receive structured results. Execution MUST be sandboxed: filesystem access is restricted to the current project directory, and outbound network access is limited to the `gh` CLI. Extensions MUST NOT be able to escape the project root or make arbitrary network calls.
- **FR-025**: The extension API MUST expose a settings registry allowing extensions to declare their configuration schema, defaults, descriptions, and whether a setting is workspace-scoped or global.
- **FR-026**: The extension API MUST expose a notification/toast API so extensions can surface errors and confirmations through the standard UI feedback system.
- **FR-027**: The extension API MUST expose file system watch events scoped to the current project directory so extensions can react to file changes. The API MUST use OS-level watch events as the primary mechanism and automatically fall back to polling when watch events are unavailable, transparently to the extension consumer.

**Settings & Configuration**

- **FR-028**: All extension settings MUST be configurable at both global and workspace levels, with workspace settings taking precedence.
- **FR-029**: The extension MUST support at minimum the following settings: `git.enabled`, `git.sidebar.defaultOpen`, `git.sidebar.refreshIntervalMs`, `git.ghCliPath`, `git.commit.signOff`, `git.maxDisplayedFiles`.
- **FR-030**: The extension API MUST expose a mechanism for extensions to add items to the application's native View menu, so extensions can surface toggle actions (e.g., show/hide sidebar) at the OS menu level alongside the keyboard shortcut.

### Key Entities

- **GitStatus**: Represents the current git status of the working directory — lists of staged, unstaged, untracked, and conflicted files with their status codes.
- **FileDiff**: Represents the diff for a single file — hunk headers, added/removed/context lines, old and new file paths, and binary flag.
- **CommitPayload**: A staged set of files plus a commit message and optional sign-off flag, forming the inputs to a git commit operation.
- **PullRequest**: A GitHub PR record — title, body, base branch, head branch, URL, and current open/closed/draft state.
- **ExtensionSettings**: The resolved configuration for the extension — merged global and workspace values with defaults applied.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Developers can view all changed files in the current project within 2 seconds of opening the git sidebar, without leaving the application.
- **SC-002**: Developers can complete the full stage-and-commit workflow (select files, write message, commit) in under 60 seconds.
- **SC-003**: Developers can open a pull request on GitHub from within the application in under 90 seconds, assuming gh CLI is installed and authenticated.
- **SC-004**: The extension installs and uninstalls cleanly — no residual UI elements, settings, or IPC handlers remain after uninstallation.
- **SC-005**: Workspace settings override global settings for every configurable option without requiring an application restart.
- **SC-006**: The sidebar auto-refresh detects file changes and updates the display within the configured interval (default: 3 seconds).
- **SC-007**: All error states (gh not installed, not a git repo, commit blocked) present a human-readable explanation — no raw error codes or stack traces shown to the user.
- **SC-008**: The extension contributes no measurable startup delay to the host application when `git.enabled` is set to `false`.

---

## Clarifications

### Session 2026-05-07

- Q: What is the security model for the IPC shell execution bridge (FR-024)? → A: Sandboxed execution — extensions may invoke allowlisted shell commands (`git` and `gh` only), scoped to the project directory with filesystem access limited to the project root and outbound network access limited to the `gh` CLI. Arbitrary shell commands are NOT permitted.
- Q: Should the sidebar use filesystem watch events, polling, or both for detecting file changes? → A: Filesystem watch with polling fallback — use OS-level watch events when available; fall back to configurable-interval polling when the filesystem does not support watch events (e.g., network drives, Docker mounts).
- Q: How should the sidebar/git view handle repositories with very large numbers of changed files? → A: Cap with warning — display up to a configurable maximum (default 500 files) and show a banner advising the user to review their `.gitignore`. The cap is configurable via settings.
- Q: How are extensions distributed and installed? → A: Bundled + local install — first-party extensions (including the git integration) ship pre-bundled with the application; additional extensions are installed by providing a local directory path or package file via the extension management UI. No hosted registry in v1.
- Q: Should the PR creation flow support creating draft pull requests? → A: Yes — a "Create as Draft" toggle is included in the PR creation dialog; when checked, the PR is created as a draft on GitHub.

---

## Assumptions

- The application already has an extension/plugin framework capable of registering UI panels, menu items, IPC handlers, and settings — this spec requires several new APIs to be added to that framework (FR-022 through FR-027), which will be designed and built as part of this feature.
- The `git` CLI is assumed to be present on the user's PATH; the extension does not bundle git.
- The `gh` CLI is an optional dependency — GitHub-specific features (PR creation) degrade gracefully when it is absent.
- The git sidebar and git view target the project's root directory as determined by the application's current project context.
- Diff rendering uses the text output of `git diff` parsed server-side; no third-party diff library is assumed.
- Workspace settings are stored in a `.terminator/settings.json` file (or equivalent project-local config) consistent with how the host application already manages workspace configuration.
- The initial release targets the most common git workflows (status, stage, commit, PR). Advanced operations (rebase, cherry-pick, conflict resolution) are out of scope for this iteration.
- The PR creation flow supports GitHub only; GitLab and Bitbucket are out of scope.

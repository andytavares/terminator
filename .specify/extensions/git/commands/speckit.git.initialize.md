---
description: 'Initialize a Git repository with an initial commit'
---

# Initialize Git Repository

Initialize a Git repository in the current project directory if none exists.

## Execution

Run the script from the project root:

- **Bash**: `.specify/extensions/git/scripts/bash/initialize-repo.sh`
- **PowerShell**: `.specify/extensions/git/scripts/powershell/initialize-repo.ps1`

If the extension scripts do not exist, use these commands:

- **Bash**: `git init && git add . && git commit -m "Initial commit from Specify template"`
- **PowerShell**: `git init; git add .; git commit -m "Initial commit from Specify template"`

The script runs all checks itself:

- Skips if Git is not available
- Skips if already inside a Git repository
- Runs `git init`, `git add .`, and `git commit` with an initial commit message

## Customization

Replace the script to add Git initialization steps for the project:

- Custom `.gitignore` templates
- Default branch naming (`git config init.defaultBranch`)
- Git LFS setup
- Git hooks installation
- Commit signing configuration
- Git Flow initialization

## Output

On success:

- `✓ Git repository initialized`

## Graceful Degradation

If Git is not installed:

- Warn the user
- Skip repository initialization
- The project works without Git (you can still create specs under `specs/`)

If Git is installed but `git init`, `git add .`, or `git commit` fails:

- Show the error to the user
- Stop this command. Do not continue with a partially initialized repository

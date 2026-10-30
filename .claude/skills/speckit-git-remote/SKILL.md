---
name: speckit-git-remote
description: Detect Git remote URL for GitHub integration
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: extension:git
user-invocable: true
disable-model-invocation: false
---

# Git Remote Skill

# Detect Git Remote URL

Detect the Git remote URL for integration with GitHub services (for example, issue creation).

## Prerequisites

- Run `git rev-parse --is-inside-work-tree 2>/dev/null` to check that Git is available
- If Git is not available, output this warning and return an empty result:
  ```
  [specify] Warning: Git repository not detected; cannot determine remote URL
  ```

## Execution

Run this command to get the remote URL:

```bash
git config --get remote.origin.url
```

## Output

Parse the remote URL and find:

1. **Repository owner**: Take from the URL (for example `github` from `https://github.com/github/spec-kit.git`)
2. **Repository name**: Take from the URL (for example `spec-kit` from `https://github.com/github/spec-kit.git`)
3. **Is GitHub**: Whether the remote points to a GitHub repository

Supported URL formats:

- HTTPS: `https://github.com/<owner>/<repo>.git`
- SSH: `git@github.com:<owner>/<repo>.git`

> [!CAUTION]
> ONLY report a GitHub repository if the remote URL points to github.com.
> Do NOT assume the remote is GitHub if the URL format does not match.

## Graceful Degradation

If Git is not installed, the directory is not a Git repository, or no remote is configured:

- Return an empty result
- Do NOT raise an error. Other workflows continue without Git remote information

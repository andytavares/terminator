# IPC channels — code review revamp

Registered by `extensions/git-integration` (`src/ipc/github.ipc.ts`, `src/ipc/review-agent.ipc.ts`, `src/index.ts`). A `repoRoot` of the form `gh:owner/name` means no local checkout: gh runs with `GH_REPO`, and local-only steps return nulls.

| Channel                          | Payload                                                                                          | Returns                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `github:dashboard-search`        | `{}`                                                                                             | `{ prs: DashboardPR[], login, fetchedAt }`                 |
| `github:pr-inline-comments`      | `{ repoRoot, prNumber }`                                                                         | `{ comments, resolvedCommentIds: number[] }`               |
| `github:file-viewed-set`         | `{ repoRoot, prNumber, path, viewed }`                                                           | `{ ok: true }`                                             |
| `github:pr-compare`              | `{ repoRoot, fromSha, toSha }`                                                                   | `{ rewritten, commits, files: [{ path, status, patch }] }` |
| `github:pr-review-submit`        | adds `comments?: [{ path, line, startLine, side, body }]`                                        | unchanged                                                  |
| `github:tests-for-block`         | `{ repoRoot, headSHA, path, code, hunkHeader? }`                                                 | `{ symbols, locations: [{ path, line, symbol, text }] }`   |
| `github:clone-repo`              | `{ repo: 'owner/name', folder }`                                                                 | `{ repoRoot }`                                             |
| `github:review-settings`         | `{}`                                                                                             | `{ cloneFolder }`                                          |
| `github:pr-review-detail`        | unchanged                                                                                        | `pr` gains `readingOrder`, `movedBlocks`, `insights`       |
| `review-agent:start`             | `{ repoRoot, prNumber, headSHA, baseRefName, title?, body?, scope, request, question?, model? }` | `{ run }`                                                  |
| `review-agent:cancel`            | `{ runId }`                                                                                      | `{ ok }`                                                   |
| `review-agent:list`              | `{ repoRoot, prNumber, headSHA }`                                                                | `{ runs }`                                                 |
| `review-agent:dismiss`           | `{ repoRoot, prNumber, headSHA, runId, findingId }`                                              | `{ ok }`                                                   |
| `review-agent:open-terminal`     | `{ runId }`                                                                                      | `{ ok }`                                                   |
| `review-agent:settings`          | `{}`                                                                                             | `{ model }`                                                |
| `review-agent:event` (broadcast) | —                                                                                                | `{ run }`                                                  |

Session keys moved from `repo:::pr:::headSHA` to `repo:::pr`; `github:sessions-for-repo` reads both and prefers the new one.

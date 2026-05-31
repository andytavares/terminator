# doc-index.json schema

```json
{
  "version": 1,
  "entries": [
    {
      "path": "docs/auth/oauth.md",
      "title": "OAuth flows",
      "summary": "Documents the OAuth 2.1 authorization-code and client-credentials flows used by the API gateway.",
      "owners": ["@auth-team"],
      "referenced_code_paths": ["services/gateway/auth/oauth.go", "services/gateway/auth/jwt.go"],
      "last_verified_commit": "abc1234",
      "staleness_score": 0
    }
  ]
}
```

`staleness_score` is bumped by the `post-edit-doc-mark` hook whenever a referenced code path is edited. The doc-keeper resets it to 0 after verification.

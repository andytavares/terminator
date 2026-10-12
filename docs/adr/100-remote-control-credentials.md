# ADR-100: Remote Control Credentials Are Hashed, Checked Once and Exchanged for a Session (Supersedes the credential parts of ADR-017)

**Status**: Accepted
**Date**: 2026-10-12
**Supersedes**: ADR-017's credential handling (the bcrypt password on every request, and the password stored for display). The rest of ADR-017 stands, including LAN exposure without TLS as an accepted risk.

## Decision

1. The password is stored only as a hash: `scrypt$cost$blockSize$parallelism$salt$key`, from Node's `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key) with a random 16-byte salt per password, compared with `crypto.timingSafeEqual`. `bcryptjs` and `@types/bcryptjs` are removed from `extensions/remote-control/package.json`.
2. The password is checked once, by `POST /api/login`. A correct password is exchanged for a `remote-session` cookie (256-bit random token, HttpOnly, SameSite=Strict, `Path=/`, 8 hours, held in the existing `SessionStore`). Every other `/api` route accepts that cookie and nothing else; an `Authorization: Bearer` header is no longer read. The existing per-IP `AuthRateLimiter` now guards the login route, where guesses are made; session tokens are not guessable, so the other routes do not count failures.
3. Nothing returns or displays the stored password. `remote:get-settings` reports `hasPassword`. `remote:update-password` returns a password only when it generated one, once, so the owner can copy it. Changing the password ends every session and closes every remote terminal, as before.
4. The QR code carries the address only. The existing `ConnectCode` component encoded `address#p=<password>`; it has no one-time-code mechanism (the one-time `app-ticket` and `mobile-ticket` are issued to an already-authenticated client and live 30 seconds, too short to sit in a QR code), so it falls back to the URL.
5. Remote Control does not start without a password. A first start used to generate one silently and store it in plain text; now `remote:toggle` answers `PASSWORD_REQUIRED` and the view says to set or generate one in Settings.

### Existing stored values

| Found at start                                | Action                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Plaintext password (with or without a bcrypt) | Hashed with scrypt, then the plaintext is overwritten with an empty string.    |
| Only a bcrypt hash                            | Cleared. Remote Control is turned off and says the password must be set again. |
| A scrypt hash, plus a leftover plaintext      | The plaintext is erased; the hash is kept.                                     |

A plaintext is migrated rather than discarded because the owner already knows it and every device they use has it typed in or remembered; discarding it would lock them out for no gain once it is erased. A bcrypt hash cannot be turned into a scrypt hash without the password, so the only safe options are to keep verifying with bcrypt (which needs the dependency this ADR removes) or to invalidate it. It is invalidated, with a message, because a one-off "set your password again" is cheaper than carrying a second algorithm indefinitely. The settings store (`electron-store`) rewrites its JSON file on every write, so the erased plaintext does not remain in it; copies of the file in backups are outside this change.

## Context

An audit found the password in plain text on disk (`terminator.remote-control.password`, kept so Settings could show it), in the browser's `localStorage` (`remote_token`), in an `Authorization` header on every request, and in the QR code (`#p=`). Each request also paid for a bcrypt comparison, and every request was a password guess as far as the rate limiter was concerned.

## Alternatives considered

| Alternative                                     | Why rejected                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Keep bcrypt, cache the comparison               | Still sends the password on every request and keeps it in `localStorage`.                                                              |
| argon2 or a native bcrypt                       | A native module per Electron version (Constitution IV); scrypt ships with Node and is a memory-hard function.                          |
| A one-time connect code in the QR               | Needs a new mint-and-redeem route and a login page that reads it. Left as a follow-up; the URL-only code loses nothing it had working. |
| Generate a password silently at first start     | The owner could not learn it once it is stored only as a hash.                                                                         |
| Cookie scoped to `/app` and `/mobile` as before | Those cookies never reach `/api`, which is why the password had to travel in a header.                                                 |

## Consequences

- **Not changed: no TLS.** The cookie and the login password cross the LAN in clear text, as the old header did (ADR-017's accepted risk). The cookie has no `Secure` flag for that reason; behind the ngrok tunnel the browser sees HTTPS and the cookie is protected in transit.
- **The browser client must change with this.** `src/renderer-remote/` (`App.tsx`, `api/remote-client.ts`, `electron-api-shim.ts`) still sends `Authorization: Bearer <password>` and keeps it in `localStorage`; the server no longer accepts that. The login page must `POST /api/login`, then call the ticket routes and every `/api` route with `credentials: 'same-origin'` and no header, and delete `remote_token`. `tests/e2e/remote-app.spec.ts`, which reads the password from `remote:get-settings`, changes the same way. This ADR's code is in `extensions/remote-control/` only; the client change is a separate unit.
- Sessions live in memory: restarting Remote Control signs every browser out, which is also what a password change does.
- There is no logout route; a session ends at its 8-hour limit, a restart, or a password change.
- `scripts/build-extensions.cjs` still lists `bcryptjs` as an external; with the dependency gone that entry does nothing and can be deleted.

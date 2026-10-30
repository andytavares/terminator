# ADR-100: Remote Control Credentials Are Hashed, Checked Once and Exchanged for a Session (Supersedes the credential parts of ADR-017)

**Status**: Accepted
**Date**: 2026-10-12
**Supersedes**: ADR-017's credential handling (the bcrypt password on every request, and the password stored for display). The rest of ADR-017 stands, including LAN exposure without TLS as an accepted risk.

## Decision

1. The app stores the password only as a hash: `scrypt$cost$blockSize$parallelism$salt$key`. The hash comes from `crypto.scrypt` of Node (N=16384, r=8, p=1, 64-byte key) with a random 16-byte salt per password. The comparison uses `crypto.timingSafeEqual`. `bcryptjs` and `@types/bcryptjs` are removed from `extensions/remote-control/package.json`.
2. `POST /api/login` checks the password once. A correct password is exchanged for a `remote-session` cookie. The cookie has these properties: a 256-bit random token, HttpOnly, SameSite=Strict, `Path=/`, 8 hours, held in the existing `SessionStore`. Every other `/api` route accepts that cookie and nothing else. The app no longer reads an `Authorization: Bearer` header. The existing per-IP `AuthRateLimiter` now guards the login route, where guesses are made. Session tokens are not guessable, so the other routes do not count failures.
3. Nothing returns or displays the stored password. `remote:get-settings` reports `hasPassword`. `remote:update-password` returns a password only when it generated one, and only once, so the owner can copy it. Changing the password ends every session and closes every remote terminal, as before.
4. The QR code carries the address only. The existing `ConnectCode` component encoded `address#p=<password>`. It has no one-time-code mechanism. The one-time `app-ticket` and `mobile-ticket` are issued to an already-authenticated client and live 30 seconds, which is too short to sit in a QR code. So `ConnectCode` falls back to the URL.
5. Remote Control does not start without a password. A first start used to generate a password silently and store it in plain text. Now `remote:toggle` answers `PASSWORD_REQUIRED`. The view says to set or generate a password in Settings.

### Existing stored values

| Found at start                                | Action                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Plaintext password (with or without a bcrypt) | Hashed with scrypt, then the plaintext is overwritten with an empty string.    |
| Only a bcrypt hash                            | Cleared. Remote Control is turned off and says the password must be set again. |
| A scrypt hash, plus a leftover plaintext      | The plaintext is erased; the hash is kept.                                     |

The app migrates a plaintext and does not discard it. The owner already knows the plaintext, and every device they use has it typed in or remembered. Discarding it would lock them out for no gain once the app erases it.

A bcrypt hash cannot become a scrypt hash without the password. There are two safe options. One is to keep verifying with bcrypt, which needs the dependency that this ADR removes. The other is to invalidate the hash. The app invalidates it, with a message. A one-off "set your password again" is cheaper than carrying a second algorithm indefinitely.

The settings store (`electron-store`) rewrites its JSON file on every write, so the erased plaintext does not remain in it. Copies of the file in backups are outside this change.

## Context

An audit found the password in these places:

- in plain text on disk (`terminator.remote-control.password`, kept so Settings could show it)
- in the `localStorage` of the browser (`remote_token`)
- in an `Authorization` header on every request
- in the QR code (`#p=`)

Each request also paid for a bcrypt comparison. For the rate limiter, every request was a password guess.

## Alternatives considered

| Alternative                                     | Why rejected                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Keep bcrypt, cache the comparison               | Still sends the password on every request and keeps it in `localStorage`.                                                              |
| argon2 or a native bcrypt                       | A native module per Electron version (Constitution IV); scrypt ships with Node and is a memory-hard function.                          |
| A one-time connect code in the QR               | Needs a new mint-and-redeem route and a login page that reads it. Left as a follow-up; the URL-only code loses nothing it had working. |
| Generate a password silently at first start     | The owner could not learn it once it is stored only as a hash.                                                                         |
| Cookie scoped to `/app` and `/mobile` as before | Those cookies never reach `/api`, which is why the password had to travel in a header.                                                 |

## Consequences

- **Not changed: no TLS.** The cookie and the login password cross the LAN in clear text, as the old header did (accepted risk of ADR-017). For that reason the cookie has no `Secure` flag. Behind the ngrok tunnel the browser sees HTTPS, and the cookie is protected in transit.
- **The browser client uses the session.** `src/renderer-remote/` posts the password to `/api/login` once. It then sends every request with `credentials: 'same-origin'` and no `Authorization` header. A 401 sends the page back to the login screen. The client no longer writes `remote_token`, and it removes a value from an older version on load.
- Sessions live in memory. Restarting Remote Control signs every browser out. A password change does the same.
- There is no logout route, because the client has no logout control. A session ends at its 8-hour limit, a restart, or a password change.

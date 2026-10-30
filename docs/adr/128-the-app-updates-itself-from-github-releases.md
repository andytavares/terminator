# ADR 128: The app updates itself from GitHub Releases

**Status**: Accepted

**Date**: 2026-10-26

## Context

Every release meant a manual download: open the GitHub release, download the DMG, drag Terminator into Applications. Releases come about once a day (five between 2026-10-21 and 2026-10-25). A copy in `/Applications` went stale without notice. Someone proposed Sparkle, since it is the usual updater for native Mac apps.

## Decision

1. **electron-updater with the GitHub provider.** `src/main/app-updater.ts` checks GitHub Releases at launch and every four hours in the packaged app. It downloads a newer version and hands the zip to Squirrel.Mac, the own Mac updater of Electron. An unpackaged app (dev, e2e) never checks. A test run of a packaged build never checks either (`TERMINATOR_RUN_IN_BACKGROUND=1`, set by `scripts/smoke-start.mjs`).
2. **Install on quit by default.** A restart closes every terminal and agent, so the app never restarts by itself. The `updateReady` notification offers "Restart now". A click on the notification only brings the window forward, because `clickHandler()` would otherwise run the first action.
3. **The release ships the feed.** `electron-builder.cjs` adds a `zip` target and a `publish` section, so each build writes `latest-mac.yml` and `app-update.yml`. `release.yml` uploads the zip, the blockmaps and `latest-mac.yml`, and fails when they are missing.
4. **Terminator > Check for Updates…** checks on demand and answers in a dialog: no update, the check failed, or the update is ready with "Restart now" and "Later". A notification can be off for every kind (`defaultTargets: []`), and then the click showed nothing (amended 2026-10-26).

## Alternatives considered

- **Sparkle.** Its docs cover Cocoa apps built in Xcode and do not mention Electron. It needs a native addon for each Electron ABI, `Sparkle.framework` re-signed into the bundle, an EdDSA key pair and a hosted appcast. Squirrel.Mac gives the same result.
- **Electron `autoUpdater` with update.electronjs.org.** It needs less code. But a third-party service sits in the update path, and its dialog bypasses the notifications of the app.
- **Homebrew cask.** It still needs a manual `brew upgrade`, and a tap to maintain.

## Consequences

- electron-updater 6 does not sign `latest-mac.yml`. Integrity rests on HTTPS from GitHub, the sha512 in the feed and the code signature of the app. electron-builder 27 makes signed manifests the default. Generate the key with `electron-builder create-update-key` when you upgrade.
- Squirrel.Mac replaces the app where it is. An app run from the DMG or from Downloads cannot update.
- Test the move to a G2 Developer ID certificate with a live update before 2027-02-01.

# ADR 117: Extensions send Home data; core draws it

**Status**: Accepted

**Date**: 2026-10-18

**Relates to**: [ADR 114](114-extension-views-are-frames-in-the-window.md), [ADR 116](116-extensions-can-add-a-home-section.md)

## Context

ADR 116 let an extension draw a section of Home as a frame. A frame is a separate page: it cannot share one queue of things waiting on the user, one idea of what the user is focused on, or one count with the sections beside it. Two extensions each showing "what needs you" show two lists and two totals, and Home cannot rank, merge or count across them.

## Decision

Extensions publish typed data and core renders it. `api.home.publish(feed)` replaces everything the extension shows; `api.home.onAction(handler)` receives `(itemId, actionId)` when the user presses one of an item's actions. A feed has four parts: `asks` (things waiting on the user), `facets` (the state of a piece of work, keyed by `WorkKey`), `measures` and optional `focus` candidates.

- The feed is validated at the boundary with `src/shared/schemas/home-feed.schema.ts`. An invalid feed is logged with the extension id and the failing field, and the previous feed stays; nothing is thrown into the extension.
- `src/main/home/home-feed.ts` keeps one feed per extension id, clears it when the extension's api disposables run, and pushes the merged feed, each item tagged with `source`, on every change.
- Core-only channels `home:feed-get`, `home:feed-action` and `home:feed-changed` carry it to the renderer (`useHomeFeedStore`). They are `remote: 'omit'` and never exposed to extension views.

## Consequences

- Home can rank and count across extensions, because the data is in one place.
- Extensions lose control of Home's look; they choose only the data and its action labels.
- An action reaches only the extension that published the item; an extension with no handler registered answers an error to the click.
- ADR 116 home sections became Insights sections: `contributes.homeSection` is now `contributes.insightsSection`, drawn on Home's Insights view.

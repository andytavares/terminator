# ADR 117: Extensions send Home data; core draws it

**Status**: Accepted

**Date**: 2026-10-18

**Relates to**: [ADR 114](114-extension-views-are-frames-in-the-window.md), [ADR 116](116-extensions-can-add-a-home-section.md)

## Context

ADR 116 let an extension draw a section of Home as a frame. A frame is a separate page. It cannot share one queue of things that wait on the user, one idea of what the user is focused on, or one count with the sections beside it. Two extensions that each show "what needs you" show two lists and two totals. Home cannot rank, merge or count across them.

## Decision

Extensions publish typed data, and core renders it. `api.home.publish(feed)` replaces everything the extension shows. `api.home.onAction(handler)` receives `(itemId, actionId)` when the user presses one of the actions of an item. A feed has four parts: `asks` (things that wait on the user), `facets` (the state of a piece of work, keyed by `WorkKey`), `measures` and optional `focus` candidates.

- `src/shared/schemas/home-feed.schema.ts` validates the feed at the boundary. The app logs an invalid feed with the extension id and the failing field, and the previous feed stays. The app throws nothing into the extension.
- `src/main/home/home-feed.ts` keeps one feed per extension id. It clears the feed when the api disposables of the extension run. On every change, it pushes the merged feed, with each item tagged with `source`.
- Core-only channels `home:feed-get`, `home:feed-action` and `home:feed-changed` carry it to the renderer (`useHomeFeedStore`). They are `remote: 'omit'`, and the app never exposes them to extension views.

## Consequences

- Home can rank and count across extensions, because the data is in one place.
- Extensions lose control of the look of Home. They choose only the data and its action labels.
- An action reaches only the extension that published the item. An extension with no registered handler answers the click with an error.
- ADR 116 home sections became Insights sections: `contributes.homeSection` is now `contributes.insightsSection`, drawn on Home's Insights view.
- Core gives some ids a meaning, so they are part of the SDK contract and not private names of an extension. These ids are the measure ids in `HOME_MEASURES` and the ask action `SEND_TO_AGENT_ACTION` (`packages/extension-sdk/src/home-contract.ts`). The manifest contribution `contributes.startWorkOptions` is also part of the contract. Through it, an extension adds a "Run it as" choice to Start work. Core never names an own id of an extension.

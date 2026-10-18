import {
  HomeFeedSchema,
  type HomeFeed,
  type MergedHomeFeed,
  type Sourced,
} from '../../shared/schemas/home-feed.schema.js'
import { logger } from '../logger.js'

// What each extension has published for Home, one feed per extension id (ADR 117).

type ActionHandler = (itemId: string, actionId: string) => Promise<void>

const feeds = new Map<string, HomeFeed>()
const actionHandlers = new Map<string, ActionHandler>()
const listeners = new Set<(merged: MergedHomeFeed) => void>()

function tagged<Item>(source: string, items: Item[] | undefined): Sourced<Item>[] {
  return (items ?? []).map((item) => ({ ...item, source }))
}

export function getMergedFeed(): MergedHomeFeed {
  const merged: MergedHomeFeed = { asks: [], facets: [], measures: [], focus: [] }
  for (const [source, feed] of feeds) {
    merged.asks.push(...tagged(source, feed.asks))
    merged.facets.push(...tagged(source, feed.facets))
    merged.measures.push(...tagged(source, feed.measures))
    merged.focus.push(...tagged(source, feed.focus))
  }
  return merged
}

function notifyChange(): void {
  const merged = getMergedFeed()
  for (const listener of listeners) listener(merged)
}

/** Replaces everything `extensionId` shows on Home. An invalid feed is logged and dropped. */
export function publishFeed(extensionId: string, feed: HomeFeed): void {
  const parsed = HomeFeedSchema.safeParse(feed)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    logger.error(
      `Extension ${extensionId} published an invalid Home feed at ${issue.path.join('.')}: ${issue.message}`
    )
    return
  }
  feeds.set(extensionId, parsed.data)
  notifyChange()
}

export function clearFeed(extensionId: string): void {
  if (feeds.delete(extensionId)) notifyChange()
}

/** One handler per extension; a second registration replaces the first. Returns its disposer. */
export function setActionHandler(extensionId: string, handler: ActionHandler): () => void {
  actionHandlers.set(extensionId, handler)
  return () => {
    if (actionHandlers.get(extensionId) === handler) actionHandlers.delete(extensionId)
  }
}

export async function runAction(
  extensionId: string,
  itemId: string,
  actionId: string
): Promise<void> {
  const handler = actionHandlers.get(extensionId)
  if (handler === undefined) throw new Error(`Extension ${extensionId} handles no Home actions`)
  await handler(itemId, actionId)
}

export function onFeedChange(listener: (merged: MergedHomeFeed) => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

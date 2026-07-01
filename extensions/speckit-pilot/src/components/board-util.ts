import { STAGE_ORDER } from '../types/speckit.types.js'
import type { BoardStage, CardSummary } from '../types/speckit.types.js'

/** Group cards by their board stage, preserving STAGE_ORDER for the columns. */
export function bucketCards(cards: CardSummary[]): Record<BoardStage, CardSummary[]> {
  const buckets = Object.fromEntries(STAGE_ORDER.map((s) => [s, []])) as Record<
    BoardStage,
    CardSummary[]
  >
  for (const card of cards) {
    ;(buckets[card.stage] ?? buckets.backlog).push(card)
  }
  return buckets
}

/**
 * Resolve a drag drop onto a column into a move request, or null if the drop is a
 * no-op (dropped on the card's current column) or the card is unknown. The user may
 * move a card to any stage — the board is theirs to organize.
 */
export function resolveDrop(
  cards: CardSummary[],
  activeFeatureDir: string,
  overStage: BoardStage
): { featureDir: string; toStage: BoardStage } | null {
  const card = cards.find((c) => c.featureDir === activeFeatureDir)
  if (!card) return null
  if (card.stage === overStage) return null
  return { featureDir: activeFeatureDir, toStage: overStage }
}

// The one shape every review decision reads: whether there is anything to
// review at all, and whether the change is big enough to grade up.
/** What a run changed, as every consumer of it needs. */
export interface DiffSummary {
  readonly files: number
  readonly added: number
  readonly removed: number
}

export type SortMode = 'oldest' | 'closest' | 'started'

export interface SortablePr {
  openedAt: string
  isDraft: boolean
  reviewDecision?: 'approved' | 'changes-requested' | 'review-required' | 'none'
  approvalCount?: number
  ciStatus: 'passing' | 'failing' | 'pending' | 'none'
  mergeStateStatus?: 'clean' | 'behind' | 'dirty' | 'unknown'
  sessionStatus?: 'not-started' | 'in-progress' | 'paused'
  viewedFileCount?: number
  fileCount: number
}

/** Lower is closer to merging: 0 ready, 1 approved but blocked, 2 awaiting review, 3 changes requested, 4 draft. */
export function mergeReadiness(pr: SortablePr): number {
  if (pr.isDraft) return 4
  if (pr.reviewDecision === 'changes-requested') return 3
  const approved = pr.reviewDecision === 'approved' || (pr.approvalCount ?? 0) > 0
  if (!approved) return 2
  const ciClear = pr.ciStatus === 'passing' || pr.ciStatus === 'none'
  return ciClear && pr.mergeStateStatus !== 'dirty' ? 0 : 1
}

const hasSession = (pr: SortablePr) =>
  pr.sessionStatus === 'in-progress' || pr.sessionStatus === 'paused'

const viewedFraction = (pr: SortablePr) =>
  pr.fileCount > 0 ? (pr.viewedFileCount ?? 0) / pr.fileCount : 0

/** Dashboard rows name their age `createdAt`; pass this as `toSortable` to sort them. */
export function dashboardToSortable<T extends { createdAt: string }>(
  row: T
): Omit<T, 'createdAt'> & { openedAt: string } {
  return { ...row, openedAt: row.createdAt }
}

/** Returns a new array; ties always fall back to the oldest first. */
export function sortPrs<T>(
  prs: T[],
  mode: SortMode,
  toSortable: (pr: T) => SortablePr = (pr) => pr as unknown as SortablePr
): T[] {
  const byAge = (a: SortablePr, b: SortablePr) => a.openedAt.localeCompare(b.openedAt)
  const compare = (a: SortablePr, b: SortablePr): number => {
    if (mode === 'closest') return mergeReadiness(a) - mergeReadiness(b) || byAge(a, b)
    if (mode === 'started') {
      return (
        Number(hasSession(b)) - Number(hasSession(a)) ||
        viewedFraction(b) - viewedFraction(a) ||
        byAge(a, b)
      )
    }
    return byAge(a, b)
  }
  return [...prs].sort((a, b) => compare(toSortable(a), toSortable(b)))
}

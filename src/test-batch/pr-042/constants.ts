export const BATCH_ID = 42 as const
export const BATCH_KEY = 'batch-042' as const
export const DEFAULT_PAGE_SIZE = 27
export const MAX_ITEMS = 520
export const RETRY_LIMIT = 3
export const TIMEOUT_MS = 5200

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 3) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP

export const BATCH_ID = 39 as const
export const BATCH_KEY = 'batch-039' as const
export const DEFAULT_PAGE_SIZE = 24
export const MAX_ITEMS = 490
export const RETRY_LIMIT = 5
export const TIMEOUT_MS = 4900

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 5) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP

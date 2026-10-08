export const BATCH_ID = 40 as const
export const BATCH_KEY = 'batch-040' as const
export const DEFAULT_PAGE_SIZE = 25
export const MAX_ITEMS = 500
export const RETRY_LIMIT = 1
export const TIMEOUT_MS = 5000

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 1) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP

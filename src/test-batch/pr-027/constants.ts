export const BATCH_ID = 27 as const
export const BATCH_KEY = 'batch-027' as const
export const DEFAULT_PAGE_SIZE = 12
export const MAX_ITEMS = 370
export const RETRY_LIMIT = 3
export const TIMEOUT_MS = 3700

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

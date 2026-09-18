export const BATCH_ID = 32 as const
export const BATCH_KEY = 'batch-032' as const
export const DEFAULT_PAGE_SIZE = 17
export const MAX_ITEMS = 420
export const RETRY_LIMIT = 3
export const TIMEOUT_MS = 4200

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

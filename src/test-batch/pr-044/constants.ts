export const BATCH_ID = 44 as const
export const BATCH_KEY = 'batch-044' as const
export const DEFAULT_PAGE_SIZE = 29
export const MAX_ITEMS = 540
export const RETRY_LIMIT = 5
export const TIMEOUT_MS = 5400

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

export const BATCH_ID = 4 as const
export const BATCH_KEY = 'batch-004' as const
export const DEFAULT_PAGE_SIZE = 14
export const MAX_ITEMS = 140
export const RETRY_LIMIT = 5
export const TIMEOUT_MS = 1400

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

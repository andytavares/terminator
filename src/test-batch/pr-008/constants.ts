export const BATCH_ID = 8 as const
export const BATCH_KEY = 'batch-008' as const
export const DEFAULT_PAGE_SIZE = 18
export const MAX_ITEMS = 180
export const RETRY_LIMIT = 4
export const TIMEOUT_MS = 1800

export const BATCH_LABELS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
].slice(0, 4) as const

export const STATUS_MAP = {
  pending: 'Pending review',
  active: 'Active',
  archived: 'Archived',
  deleted: 'Deleted',
} as const

export type BatchStatus = keyof typeof STATUS_MAP

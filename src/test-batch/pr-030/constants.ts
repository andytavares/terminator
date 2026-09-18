export const BATCH_ID = 30 as const
export const BATCH_KEY = 'batch-030' as const
export const DEFAULT_PAGE_SIZE = 15
export const MAX_ITEMS = 400
export const RETRY_LIMIT = 1
export const TIMEOUT_MS = 4000

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

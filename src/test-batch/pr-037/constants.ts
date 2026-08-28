export const BATCH_ID = 37 as const
export const BATCH_KEY = 'batch-037' as const
export const DEFAULT_PAGE_SIZE = 22
export const MAX_ITEMS = 470
export const RETRY_LIMIT = 3
export const TIMEOUT_MS = 4700

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

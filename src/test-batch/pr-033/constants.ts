export const BATCH_ID = 33 as const
export const BATCH_KEY = 'batch-033' as const
export const DEFAULT_PAGE_SIZE = 18
export const MAX_ITEMS = 430
export const RETRY_LIMIT = 4
export const TIMEOUT_MS = 4300

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

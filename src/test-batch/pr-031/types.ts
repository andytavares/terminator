export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface BatchItem31 {
  id: string
  index: number
  priority: Priority
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>
}

export interface BatchResult31 {
  items: BatchItem31[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface BatchFilter31 {
  priority?: Priority
  tags?: string[]
  fromDate?: Date
  toDate?: Date
  search?: string
}

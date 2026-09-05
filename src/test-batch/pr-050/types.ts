export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface BatchItem50 {
  id: string
  index: number
  priority: Priority
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>
}

export interface BatchResult50 {
  items: BatchItem50[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface BatchFilter50 {
  priority?: Priority
  tags?: string[]
  fromDate?: Date
  toDate?: Date
  search?: string
}

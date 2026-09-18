export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface BatchItem7 {
  id: string
  index: number
  priority: Priority
  tags: string[]
  createdAt: Date
  metadata: Record<string, unknown>
}

export interface BatchResult7 {
  items: BatchItem7[]
  totalCount: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface BatchFilter7 {
  priority?: Priority
  tags?: string[]
  fromDate?: Date
  toDate?: Date
  search?: string
}

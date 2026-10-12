import { createToastStore, type QueuedToast } from '@terminator/extension-ui'

export type Toast = QueuedToast

export const useToastStore = createToastStore()

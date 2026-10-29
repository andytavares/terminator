import { defineChannel, type ChannelSpec, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable } from './invoke-table.js'
import { getUsageStore } from '../usage/usage-store.js'
import {
  UsageDeclareInputSchema,
  UsageRecordInputSchema,
  UsageReportInputSchema,
} from '../../shared/schemas/usage.schema.js'

// Core-only: extension views never reach these (the frame bridge refuses `usage:`).

const usageChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'usage:record',
    schema: UsageRecordInputSchema,
    invalid: validationError,
    run: async (input) => {
      await getUsageStore().recordUse(input)
      return { data: true }
    },
    onError: (error) => ({ error: 'failed', message: String(error) }),
  }),
  defineChannel({
    channel: 'usage:declare',
    schema: UsageDeclareInputSchema,
    invalid: validationError,
    run: async ({ features }) => {
      await getUsageStore().declare(features)
      return { data: true }
    },
    onError: (error) => ({ error: 'failed', message: String(error) }),
  }),
  defineChannel({
    channel: 'usage:report',
    schema: UsageReportInputSchema,
    invalid: validationError,
    run: async ({ from }) => ({ data: await getUsageStore().report(from) }),
    onError: (error) => ({ error: 'failed', message: String(error) }),
  }),
]

export function registerUsageHandlers(): void {
  registerInvokeTable(usageChannels)
}

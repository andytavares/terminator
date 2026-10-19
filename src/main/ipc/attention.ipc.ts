import { defineChannel, type ChannelSpec, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable } from './invoke-table.js'
import { listIntervals, recordState } from '../home/attention-log.js'
import { attentionMeasures } from '../../shared/home/attention-measures.js'
import {
  MeasuresInputSchema,
  RecordStateInputSchema,
} from '../../shared/schemas/attention.schema.js'

// Core-only. The renderer derives each session's state, so it reports every
// transition here; Home asks for the measures over the log those build.

const attentionChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'attention:record',
    schema: RecordStateInputSchema,
    invalid: validationError,
    run: async (report) => {
      await recordState(report)
      return { data: true }
    },
    onError: (error) => ({ error: 'failed', message: String(error) }),
  }),
  defineChannel({
    channel: 'attention:measures',
    schema: MeasuresInputSchema,
    invalid: validationError,
    run: ({ window }) => ({ data: attentionMeasures(listIntervals(), window, Date.now()) }),
  }),
]

export function registerAttentionHandlers(): void {
  registerInvokeTable(attentionChannels)
}

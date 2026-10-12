import { defineChannel, noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { modelCatalog } from '../state/model-catalog.js'

import { foundryChannel } from './channel.js'
import { AskModelSetPayload, ModelSetPayload } from './payloads.js'
import { ASK_MODELS } from '../forge/converge.js'

import { reg } from './register.js'
import {
  MODEL_SETTING_KEY,
  ASK_MODEL_SETTING_KEY,
  askModel,
  defaultModel,
} from '../state/settings.js'

/** Which model runs launch with, and which one answers an ask. */
export function registerModelChannels(api: ExtensionAPI): void {
  reg(
    api,
    // What can go in the model box, and which one is chosen. Asked for rather
    // than hardcoded in the view, where the last list sat naming a superseded
    // generation until somebody noticed.
    //
    // `selected` comes back with the list because the two must not drift: the
    // settings view keeps its own copy for rendering, and a copy that disagrees
    // with what the runs are actually launched with is worse than no setting.
    foundryChannel('foundry:models-list', noPayload, async () => ({
      models: await modelCatalog(),
      selected: defaultModel(api),
    })),
    // Persisted where the main process can read it, which is the only place that
    // matters: the launch command is built here, not in the renderer.
    defineChannel({
      channel: 'foundry:model-set',
      schema: ModelSetPayload,
      invalid: { error: 'model must be a string' },
      run: ({ model }) => {
        api.settings.set(MODEL_SETTING_KEY, model)
        return { ok: true, selected: model }
      },
    }),
    // What answers an ask: a narrow amendment, so Sonnet unless overridden.
    foundryChannel('foundry:ask-model', noPayload, () => ({ selected: askModel(api) })),
    defineChannel({
      channel: 'foundry:ask-model-set',
      schema: AskModelSetPayload,
      invalid: { error: `model must be one of ${ASK_MODELS.join(', ')}` },
      run: ({ model }) => {
        api.settings.set(ASK_MODEL_SETTING_KEY, model)
        return { ok: true, selected: model }
      },
    })
  )
}

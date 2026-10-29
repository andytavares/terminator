import { describe, it, expect } from 'vitest'
import {
  roleSettings,
  type RoleFacts,
} from '../../../../extensions/foundry/src/runtime/role-settings'
import { AUTONOMY_LEVELS } from '../../../../extensions/foundry/src/gates/autonomy'
import { availableAdapterModes } from '../../../support/acp-modes'

// Foundry once asked for `dontAsk`, which the adapter never offers, and every read-only role failed
// to start. The fakes now share the adapter's list; this proves Foundry only asks for those modes.
const BOOLEANS = [false, true]

function* everyFactCombination(): Generator<RoleFacts> {
  for (const readOnly of BOOLEANS)
    for (const docsOnly of BOOLEANS)
      for (const restrictedWrites of BOOLEANS)
        for (const outputsDir of [null, '/outputs'])
          for (const autonomy of AUTONOMY_LEVELS)
            for (const letModeDecide of BOOLEANS)
              yield {
                readOnly,
                docsOnly,
                restrictedWrites,
                autonomy,
                letModeDecide,
                outputPath: null,
                outputsDir,
                skillsMount: null,
                mayUseTool: () => true,
                probedCommands: [],
                readOnlyTools: [],
              }
}

describe('the Claude ACP adapter contract', () => {
  it('offers every permission mode Foundry asks for', () => {
    const offered = availableAdapterModes()
    const unavailable = [...everyFactCombination()]
      .map((facts) => ({ mode: roleSettings(facts).permissionMode, facts }))
      .filter(({ mode }) => !offered.includes(mode))
    expect(unavailable, `modes the adapter does not offer (${offered.join(', ')})`).toEqual([])
  })
})

import { describe, it, expect, vi } from 'vitest'
import { MODEL_ALIASES, modelCatalog } from '../../src/state/model-catalog.js'
import type { AgentConfigOption, AgentsAPI } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'

const modelOption = (options: AgentConfigOption['options']): AgentConfigOption => ({
  id: 'model',
  name: 'Model',
  currentValue: 'default',
  options,
})
const agentsOffering = (answer: AgentConfigOption | null) =>
  partialFake<Pick<AgentsAPI, 'models'>>({ models: vi.fn().mockResolvedValue(answer) })

/**
 * The picker used to be three `<option>` tags typed into the settings view,
 * naming a generation that had already shipped its successor. What matters
 * here is that the list cannot go stale by sitting in the source, and that an
 * agent that cannot say is a shorter list rather than a broken settings page.
 */
describe('the model catalog', () => {
  it('leads with an empty id, which means "pass no model at all"', () => {
    expect(MODEL_ALIASES[0].id).toBe('')
  })

  it('asks the Claude agent which models it offers', async () => {
    const agents = agentsOffering(null)
    await modelCatalog(agents)
    expect(agents.models).toHaveBeenCalledWith('claude')
  })

  it('appends what the agent offers, under its display name', async () => {
    const models = await modelCatalog(
      agentsOffering(modelOption([{ value: 'claude-opus-5', name: 'Claude Opus 5' }]))
    )
    expect(models.at(-1)).toEqual({ id: 'claude-opus-5', label: 'Claude Opus 5', floating: false })
  })
})

describe('the model catalog — ordering and degrading', () => {
  it('keeps the aliases first, so the list does not depend on the agent', async () => {
    const models = await modelCatalog(agentsOffering(modelOption([{ value: 'x', name: 'X' }])))
    expect(models.slice(0, MODEL_ALIASES.length)).toEqual([...MODEL_ALIASES])
  })

  it('never lists an alias twice when the agent happens to offer one', async () => {
    const models = await modelCatalog(
      agentsOffering(modelOption([{ value: 'opus', name: 'Opus' }]))
    )
    expect(models.filter((model) => model.id === 'opus')).toHaveLength(1)
  })

  it('drops an entry with no id rather than offering a blank row', async () => {
    const models = await modelCatalog(agentsOffering(modelOption([{ value: '', name: 'Default' }])))
    expect(models).toEqual([...MODEL_ALIASES])
  })

  it('offers the aliases alone when the agent has no model option', async () => {
    expect(await modelCatalog(agentsOffering(null))).toEqual([...MODEL_ALIASES])
  })

  // Nobody asked for this list; a settings page that shows an error for a
  // background read is worse than one that quietly offers less.
  it('offers the aliases alone when asking the agent fails', async () => {
    const agents = partialFake<Pick<AgentsAPI, 'models'>>({
      models: vi.fn().mockRejectedValue(new Error('no agent')),
    })
    expect(await modelCatalog(agents)).toEqual([...MODEL_ALIASES])
  })
})

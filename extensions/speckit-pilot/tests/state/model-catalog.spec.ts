import { describe, it, expect, vi } from 'vitest'
import { MODEL_ALIASES, fetchLiveModels, modelCatalog } from '../../src/state/model-catalog.js'

/**
 * The picker used to be three `<option>` tags typed into the settings view,
 * naming a generation that had already shipped its successor — and nothing
 * read the value anyway. What matters here is that the list cannot go stale by
 * sitting in the source, and that a failure to reach the API is a shorter list
 * rather than a broken settings page.
 */
describe('the model catalog', () => {
  const noCredentials: NodeJS.ProcessEnv = {}
  const withKey: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-test' }

  const respond = (body: unknown, ok = true): typeof fetch =>
    vi.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch

  it('offers the aliases with no credential, because they need none', async () => {
    const models = await modelCatalog(noCredentials, respond({}))
    expect(models).toEqual([...MODEL_ALIASES])
  })

  it('leads with an empty id, which means "pass no --model at all"', async () => {
    // The correct default for a console wrapping somebody else's CLI: follow
    // whatever their own configuration says.
    expect(MODEL_ALIASES[0].id).toBe('')
  })

  it('makes no request at all without a credential', async () => {
    const fetchImpl = respond({})
    await modelCatalog(noCredentials, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends an API key as x-api-key and a token as a bearer', async () => {
    const keyed = respond({ data: [] })
    await fetchLiveModels({ ANTHROPIC_API_KEY: 'sk-test' }, keyed)
    expect((keyed as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers).toMatchObject({
      'x-api-key': 'sk-test',
    })

    const tokened = respond({ data: [] })
    await fetchLiveModels({ ANTHROPIC_AUTH_TOKEN: 'oat-test' }, tokened)
    expect((tokened as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers).toMatchObject(
      {
        authorization: 'Bearer oat-test',
      }
    )
  })

  it('appends what the account can reach, under its display name', async () => {
    const models = await modelCatalog(
      withKey,
      respond({ data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5' }] })
    )
    expect(models.at(-1)).toEqual({
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      floating: false,
    })
  })

  it('keeps the aliases first, so the list does not depend on an env var', async () => {
    const models = await modelCatalog(withKey, respond({ data: [{ id: 'claude-opus-5' }] }))
    expect(models.slice(0, MODEL_ALIASES.length)).toEqual([...MODEL_ALIASES])
  })

  it('never lists an alias twice when the API happens to return one', async () => {
    const models = await modelCatalog(withKey, respond({ data: [{ id: 'opus' }] }))
    expect(models.filter((model) => model.id === 'opus')).toHaveLength(1)
  })

  it('degrades to the aliases when the API refuses, rather than reporting an error', async () => {
    // Nobody asked for this list; a settings page that shows an error for a
    // background fetch is worse than one that quietly offers less.
    expect(await modelCatalog(withKey, respond({}, false))).toEqual([...MODEL_ALIASES])
  })

  it('degrades to the aliases when the network throws', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    expect(await modelCatalog(withKey, boom)).toEqual([...MODEL_ALIASES])
  })

  it('degrades to the aliases when the response is not the shape it claims', async () => {
    expect(await modelCatalog(withKey, respond({ data: 'nope' }))).toEqual([...MODEL_ALIASES])
  })

  it('drops entries with no usable id rather than offering a blank row', async () => {
    const models = await fetchLiveModels(withKey, respond({ data: [{ id: '' }, { id: 42 }] }))
    expect(models).toEqual([])
  })

  it('honours a base URL override, for a gateway or a proxy', async () => {
    const fetchImpl = respond({ data: [] })
    await fetchLiveModels({ ...withKey, ANTHROPIC_BASE_URL: 'https://gw.example/' }, fetchImpl)
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://gw.example/v1/models?limit=100'
    )
  })

  it('ignores a credential that is only whitespace', async () => {
    const fetchImpl = respond({ data: [] })
    await fetchLiveModels({ ANTHROPIC_API_KEY: '   ' }, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

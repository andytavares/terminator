import { describe, it, expect } from 'vitest'
import { changedExtensions } from '../../../scripts/bump-extension-versions.mjs'

const EXTENSIONS = ['foundry', 'foundry-lab', 'notepad']

describe('changedExtensions', () => {
  it('names each extension with a changed file once', () => {
    expect(
      changedExtensions(EXTENSIONS, [
        'extensions/foundry/src/index.js',
        'extensions/foundry/manifest.json',
        'extensions/notepad/README.md',
      ])
    ).toEqual(['foundry', 'notepad'])
  })

  it('does not take a change in a longer folder name for the shorter one', () => {
    expect(changedExtensions(EXTENSIONS, ['extensions/foundry-lab/src/index.js'])).toEqual([
      'foundry-lab',
    ])
  })

  it('ignores files outside an extension folder', () => {
    expect(changedExtensions(EXTENSIONS, ['extensions/CLAUDE.md', 'src/main/index.ts'])).toEqual([])
  })
})

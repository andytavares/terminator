import { describe, it, expect } from 'vitest'
import { readBeside } from '../../support/files'

// Constitution XIII: nothing is fetched at run time to render the UI. A font
// requested from a CDN is missing offline and falls back to another face.

const DOCUMENTS = [
  '../../../src/renderer/index.html',
  '../../../src/renderer-remote/index.html',
  '../../../src/renderer-remote/mobile.html',
]

describe('fonts ship with the app', () => {
  it.each(DOCUMENTS)('%s requests nothing from a font service', (path) => {
    expect(readBeside(import.meta.url, path)).not.toMatch(/https?:\/\//)
  })
})

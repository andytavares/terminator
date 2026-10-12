import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Constitution XIII: nothing is fetched at run time to render the UI. A font
// requested from a CDN is missing offline and falls back to another face.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const DOCUMENTS = [
  '../../../src/renderer/index.html',
  '../../../src/renderer-remote/index.html',
  '../../../src/renderer-remote/mobile.html',
]

describe('fonts ship with the app', () => {
  it.each(DOCUMENTS)('%s requests nothing from a font service', (path) => {
    expect(read(path)).not.toMatch(/https?:\/\//)
  })
})

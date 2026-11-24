import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// The WebGL renderer draws each glyph on a 2D canvas with this font string: style, weight, size
// in device pixels, family. Upright text leaves the style empty, so the string starts with a
// space. Electron 45.2.3's Chromium rejected it and drew every glyph in 10px sans-serif.
const TERMINAL_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace'
const UPRIGHT_GLYPH_FONT = ` normal 26px ${TERMINAL_FONT_FAMILY}`

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('the canvas the terminal draws glyphs on takes the terminal font', async () => {
  const appliedFont = await handle.page.evaluate((font) => {
    const context = document.createElement('canvas').getContext('2d')!
    context.font = font
    return context.font
  }, UPRIGHT_GLYPH_FONT)

  expect(appliedFont).toBe(`26px ${TERMINAL_FONT_FAMILY}`)
})

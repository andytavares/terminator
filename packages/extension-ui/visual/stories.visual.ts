import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

interface IndexEntry {
  id: string
  type: 'story' | 'docs'
}

// The story list comes from the built site, so a new story is screenshot
// without anyone adding it here. Run `npm run build-storybook` first.
const index = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../storybook-static/index.json'),
    'utf8'
  )
) as { entries: Record<string, IndexEntry> }

const stories = Object.values(index.entries).filter((entry) => entry.type === 'story')

for (const { id } of stories) {
  test(id, async ({ page }) => {
    await page.goto(`/iframe.html?id=${id}&viewMode=story`)
    // A story with a play function is pictured after it has played.
    await page.waitForFunction(() => {
      const preview = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
        .__STORYBOOK_PREVIEW__
      return ['completed', 'finished'].includes(preview?.currentRender?.phase ?? '')
    })
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot(`${id}.png`)
  })
}

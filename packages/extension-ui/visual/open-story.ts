import type { Page } from '@playwright/test'

/** Opens a story and waits until it has rendered and, when it has one, played. */
export async function openStory(page: Page, id: string): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`)
  await page.waitForFunction(() => {
    const preview = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
      .__STORYBOOK_PREVIEW__
    return ['completed', 'finished'].includes(preview?.currentRender?.phase ?? '')
  })
}

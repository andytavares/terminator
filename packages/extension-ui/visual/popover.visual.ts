import { test, expect, type Page } from '@playwright/test'

// What a popover and a menu leave to the browser, driven with real input: a story's play function
// sends scripted events, which no browser answers with light dismiss or a focus return.

async function openStory(page: Page, id: string): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`)
  await page.waitForFunction(() => {
    const preview = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
      .__STORYBOOK_PREVIEW__
    return ['completed', 'finished'].includes(preview?.currentRender?.phase ?? '')
  })
}

test('Escape closes a popover, as light dismiss', async ({ page }) => {
  await openStory(page, 'components-popover--default')
  const surface = page.getByRole('group', { name: 'Branch actions' })
  await expect(surface).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(surface).toBeHidden()
})

test('a click outside closes a menu', async ({ page }) => {
  await openStory(page, 'components-menu--default')
  await page.mouse.click(8, 8)
  await expect(page.getByRole('menu')).toBeHidden()
})

test('a menu opened by a right click stays open, though the button is still down', async ({
  page,
}) => {
  await openStory(page, 'components-menu--context-menu-opened-by-right-click')
  await page.getByRole('button', { name: 'Right-click me' }).click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Row actions' })).toBeVisible()
})

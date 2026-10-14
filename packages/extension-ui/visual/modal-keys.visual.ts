import { test, expect, type Page } from '@playwright/test'

// What a modal shell leaves to the browser, driven with real keys: a story's play function sends
// scripted events, which no browser answers with a close request or a move of focus.

async function openStory(page: Page, id: string): Promise<void> {
  await page.goto(`/iframe.html?id=components-modalshell--${id}&viewMode=story`)
  await page.waitForFunction(() => {
    const preview = (window as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
      .__STORYBOOK_PREVIEW__
    return ['completed', 'finished'].includes(preview?.currentRender?.phase ?? '')
  })
}

test('Escape dismisses the shell and focus returns to what opened it', async ({ page }) => {
  await openStory(page, 'focus-returns-to-the-opener')
  const opener = page.getByRole('button', { name: 'Open settings' })
  // Opened from the keyboard: Safari does not focus a button that is clicked.
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('Tab never reaches the page behind the shell', async ({ page }) => {
  await openStory(page, 'default')
  const behind = page.getByRole('button', { name: 'Behind the shell', includeHidden: true })
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    await expect(behind).not.toBeFocused()
  }
})

// The second Escape with no click between cannot be prevented: the browser closes the dialog.
for (const id of ['default', 'not-dismissible']) {
  test(`a shell its caller keeps mounted stays open through two Escapes (${id})`, async ({
    page,
  }) => {
    await openStory(page, id)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    expect(await page.locator('dialog:modal').count()).toBe(1)
  })
}

test('a press on the backdrop dismisses; one on the shell does not', async ({ page }) => {
  await openStory(page, 'focus-returns-to-the-opener')
  await page.getByRole('button', { name: 'Open settings' }).click()
  const shell = page.getByRole('dialog', { name: 'Settings' })
  await shell.click({ position: { x: 4, y: 4 } })
  await expect(shell).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(shell).toHaveCount(0)
})

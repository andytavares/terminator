// [DEBUG-f0c5] throwaway probe: where does focus go after the Overview icon is focused?
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test('[DEBUG-f0c5] focus after Overview', async () => {
  const handle = await launchApp()
  const { page } = handle
  try {
    await page.evaluate(() => {
      const log: string[] = ((window as unknown as { __f: string[] }).__f = [])
      const t0 = performance.now()
      const name = (el: Element | null) =>
        el ? `${el.tagName}.${el.className}[${el.getAttribute('aria-label') ?? el.getAttribute('src') ?? ''}]` : 'null'
      document.addEventListener('focusin', (e) => log.push(`${Math.round(performance.now() - t0)} in ${name(e.target as Element)}`), true)
      document.addEventListener('focusout', (e) => log.push(`${Math.round(performance.now() - t0)} out ${name(e.target as Element)} -> ${name((e as FocusEvent).relatedTarget as Element)}`), true)
      window.addEventListener('blur', () => log.push(`${Math.round(performance.now() - t0)} window blur, active=${name(document.activeElement)}`))
    })
    await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible()
    await page.evaluate(() => (window as unknown as { __f: string[] }).__f.push(`tasks visible, active=${document.activeElement?.tagName}.${document.activeElement?.className}`))
    await page.keyboard.press('Shift')
    await page.getByRole('button', { name: 'Overview' }).focus()
    await page.waitForTimeout(4000)
    const log = await page.evaluate(() => [...(window as unknown as { __f: string[] }).__f, `final active=${document.activeElement?.tagName}.${document.activeElement?.className} hasFocus=${document.hasFocus()}`])
    console.log('[DEBUG-f0c5]\n' + log.join('\n'))
  } finally {
    await closeApp(handle)
  }
})

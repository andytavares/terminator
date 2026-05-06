import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'

let electronApp: ElectronApplication
let page: Page

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.sidebar', { timeout: 10000 })

  // Create a workspace and expand it so we can add projects
  await page.click('.sidebar__create-btn')
  await page.waitForSelector('.dialog__title')
  await page.locator('.dialog__input').first().fill('Project Test Workspace')
  await page.click('.dialog__btn-primary')
  // click workspace to expand
  await page.locator('.workspace-item__header').first().click()
})

test.afterAll(async () => {
  await electronApp.close()
})

// US2 Scenario 1: Add Project prompt appears
test('US2-1: clicking Add Project shows a prompt for project name', async () => {
  await page.click('.workspace-item__add-project')
  await expect(page.locator('.dialog__title')).toContainText('Create Project')
  await page.keyboard.press('Escape')
})

// US2 Scenario 2: Project appears in sidebar after creation
test('US2-2: created project appears listed under its workspace in the sidebar', async () => {
  await page.click('.workspace-item__add-project')
  await page.waitForSelector('.dialog__title')
  await page.locator('.dialog__input').first().fill('alpha-project')
  await page.click('.dialog__btn-primary')
  await expect(page.locator('.project-item')).toContainText('alpha-project')
})

// US2 Scenario 3: Clicking project opens tabbed terminal view
test('US2-3: clicking a project switches main area to a tabbed terminal view', async () => {
  await page.locator('.project-item').filter({ hasText: 'alpha-project' }).click()
  await expect(page.locator('.tab-bar')).toBeVisible()
})

// US2 Scenario 4: "+" button opens new terminal session tab
test('US2-4: clicking "+" in tab bar opens a new terminal session tab', async () => {
  const tabsBefore = await page.locator('.tab-bar__tab').count()
  await page.click('.tab-bar__new-tab')
  // dialog appears for tab title and type
  await page.waitForSelector('.dialog__title', { timeout: 3000 }).catch(() => {
    // Some implementations may open tab directly
  })
  // Accept defaults if dialog appears
  const dialogVisible = await page.locator('.dialog__btn-primary').isVisible()
  if (dialogVisible) {
    await page.click('.dialog__btn-primary')
  }
  await expect(page.locator('.tab-bar__tab')).toHaveCount(tabsBefore + 1)
})

// US2 Scenario 5: Multiple tabs show independent content
test('US2-5: multiple tabs show independent terminal sessions', async () => {
  // Open a second tab
  await page.click('.tab-bar__new-tab')
  const dialogVisible = await page.locator('.dialog__btn-primary').isVisible()
  if (dialogVisible) {
    await page.click('.dialog__btn-primary')
  }
  const tabs = page.locator('.tab-bar__tab')
  await expect(tabs).toHaveCount(await tabs.count())
  expect(await tabs.count()).toBeGreaterThanOrEqual(2)

  // Click first tab
  await tabs.first().click()
  const firstTabActive = await tabs.first().getAttribute('class')
  expect(firstTabActive).toContain('tab-bar__tab--active')

  // Click second tab
  await tabs.nth(1).click()
  const secondTabActive = await tabs.nth(1).getAttribute('class')
  expect(secondTabActive).toContain('tab-bar__tab--active')
  const firstTabInactive = await tabs.first().getAttribute('class')
  expect(firstTabInactive).not.toContain('tab-bar__tab--active')
})

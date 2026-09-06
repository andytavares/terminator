import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'
import { CONTRAST_PROBE, type Probe } from './contrast-probe'

/**
 * MergeFlow, against a real merge conflict.
 *
 * The 036 audit flagged this surface as the one it could not check: it was read
 * from source and never seen running, because it needs populated git state
 * nobody had set up. So it was edited — icons, tokens, both themes — on the
 * strength of unit tests alone. This is that state, set up.
 */

let handle: AppHandle
let repo: string

/** A repository mid-merge, with one file genuinely conflicted. */
function makeConflictedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'terminator-e2e-conflict-'))
  const run = (c: string) => execSync(c, { cwd: dir })
  run('git init -b main')
  run('git config user.email "test@test.com"')
  run('git config user.name "Test"')
  writeFileSync(join(dir, 'app.ts'), 'export const greeting = "hello"\nexport const count = 1\n')
  run('git add -A')
  run('git commit -m "initial"')
  run('git checkout -b feature')
  writeFileSync(join(dir, 'app.ts'), 'export const greeting = "hi there"\nexport const count = 1\n')
  run('git commit -am "feature: reword the greeting"')
  run('git checkout main')
  writeFileSync(join(dir, 'app.ts'), 'export const greeting = "good day"\nexport const count = 1\n')
  run('git commit -am "main: reword the greeting"')
  try {
    run('git merge feature')
  } catch {
    // The conflict is the point of the fixture.
  }
  return dir
}

/** Run a script inside the git-integration view matching `viewParam`. */
function inGit<T>(viewParam: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { param, src }) => {
      const v = webContents
        .getAllWebContents()
        .find(
          (w) =>
            !w.isDestroyed() &&
            w.getURL().includes('git-integration') &&
            w.getURL().includes(`view=${param}`)
        )
      if (!v) throw new Error(`no git-integration view for view=${param}`)
      return v.executeJavaScript(src) as Promise<unknown>
    },
    { param: viewParam, src: script }
  ) as Promise<T>
}

test.beforeAll(async () => {
  repo = makeConflictedRepo()
  handle = await launchApp()
  await createWorkspace(handle.page, 'Conflict Workspace', repo)
  await handle.page.locator('.branch-row').first().click()
  await handle.page.waitForTimeout(1500)
})

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

test('the sidebar names the conflict and refuses to commit, saying why', async () => {
  await handle.page.keyboard.press('Meta+Shift+G')
  await handle.page.waitForTimeout(2500)
  const text = await inGit<string>('sidebar', 'document.body.innerText')

  // The file's state is a word, not a porcelain code (FR-036).
  expect(text).toContain('Conflict')
  expect(text).not.toMatch(/\bUU\b/)
  // One primary commit control, and it says what would enable it (FR-037).
  expect(text).toContain('Commit & push')
  expect(text).toMatch(/Stage a file/)
  // Where the branch stands, in words.
  expect(text).toContain('No upstream branch yet')
})

test('MergeFlow opens on a real conflict and reads in both themes', async () => {
  // The Git project tab is where MergeFlow renders; the sidebar's button asks
  // the host to bring it up.
  await handle.page
    .locator('.tab-bar--primary .tab-bar__tab')
    .filter({ hasText: 'Git' })
    .first()
    .click()
  await expect(
    handle.page.locator(
      '[data-extension-panel="terminator.git-integration"][data-view-param="project"]'
    )
  ).toBeVisible({ timeout: 15000 })
  await handle.page.waitForTimeout(2000)

  await inGit<boolean>(
    'project',
    `(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /resolve conflicts/i.test(x.textContent || '')
      )
      if (b) b.click()
      return !!b
    })()`
  )
  await handle.page.waitForTimeout(2500)

  const text = await inGit<string>('project', 'document.body.innerText')
  // ConflictHub's own headings, in sentence case rather than the caps they were.
  expect(text).toMatch(/Files conflicted|Total conflicts|Needs your attention/)
  expect(text).not.toMatch(/FILES CONFLICTED|TOTAL CONFLICTS|NEEDS YOUR ATTENTION/)

  // Every glyph that used to stand for a state is a lucide icon now, so the
  // characters themselves must be gone from the rendered text (Principle XII).
  expect(text).not.toMatch(/[✓✕↺▸▾]/)
})

/**
 * FR-001. The guard that was missing: with focus on a button rather than a
 * text field, the text-field guard does not apply and only the open-surface
 * count stands between Escape and losing the merge.
 */
test('double Escape inside MergeFlow does not close the extension', async () => {
  const before = await handle.page.evaluate(
    () =>
      document.querySelector('[data-extension-panel]')?.getAttribute('data-extension-panel') ?? null
  )
  expect(before).not.toBeNull()

  await inGit<string>(
    'project',
    `(() => {
      const b = document.querySelector('button')
      if (b) b.focus()
      return document.activeElement.tagName
    })()`
  )
  await handle.app.evaluate(async ({ webContents }) => {
    const v = webContents
      .getAllWebContents()
      .find(
        (w) =>
          !w.isDestroyed() &&
          w.getURL().includes('git-integration') &&
          w.getURL().includes('view=project')
      )
    if (!v) return
    for (let i = 0; i < 2; i++) {
      v.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      v.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await new Promise((r) => setTimeout(r, 100))
    }
  })
  await handle.page.waitForTimeout(1200)

  const after = await handle.page.evaluate(
    () =>
      document.querySelector('[data-extension-panel]')?.getAttribute('data-extension-panel') ?? null
  )
  expect(after).toBe(before)
})

/**
 * SC-012, for the extension the other harness cannot reach.
 *
 * `extension-themes.spec.ts` opens each extension from its global tab button.
 * Git Integration has no global tab — it contributes a sidebar panel and
 * project/workspace tabs — and its merge surfaces do not exist at all until a
 * repository is mid-merge. So its contrast is measured here, where that state
 * has already been built, rather than left unmeasured because the harness
 * shape did not fit.
 */
async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  await handle.page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    window.electronAPI.extension.setTheme('${theme}')
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await handle.page.waitForTimeout(500)
}

/** The project view only exists while its tab is selected. */
async function openGitProjectTab(): Promise<void> {
  const panel = handle.page.locator(
    '[data-extension-panel="terminator.git-integration"][data-view-param="project"]'
  )
  if ((await panel.count()) === 0) {
    await handle.page
      .locator('.tab-bar--primary .tab-bar__tab')
      .filter({ hasText: 'Git' })
      .first()
      .click()
    await expect(panel).toBeVisible({ timeout: 15000 })
    await handle.page.waitForTimeout(1500)
  }
}

for (const viewParam of ['sidebar', 'project'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    test(`Git Integration (${viewParam}) meets WCAG AA in the ${theme} theme`, async () => {
      if (viewParam === 'project') await openGitProjectTab()
      await setTheme(theme)
      const probes = await inGit<Probe[]>(viewParam, CONTRAST_PROBE)
      expect(probes.length, `${viewParam} rendered no text to measure`).toBeGreaterThan(0)
      const failures = probes.filter((p) => p.ratio < p.required)
      const report = failures
        .map((f) => `  ${f.ratio}:1 (needs ${f.required}) ${f.selector} — "${f.text}"`)
        .join('\n')
      expect(failures, `git-integration / ${viewParam} / ${theme}:\n${report}`).toHaveLength(0)
    })
  }
}

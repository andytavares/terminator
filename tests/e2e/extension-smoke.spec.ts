import { test, expect, type Frame } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  openSettingsSection,
  closeSettingsPanel,
  projectGroup,
} from './helpers'
import { findExtensionFrame, type ExtensionView } from './extension-page'
import { CONTRAST_PROBE, type Probe } from './contrast-probe'
import { misalignedOn } from './control-alignment'
import { openVault, goToSection } from './task-vault-harness'
import { openNotepad } from './notepad-harness'

// Each surface is measured where it is drawn: only a browser computes the composite colours
// (rgba over an inherited surface, color-mix) and the geometry, so none of this can be read
// from the stylesheets.

let handle: AppHandle

// A second repo with a longer name: a count in the sidebar must not follow the name.
const LONG_REPO = 'A Much Longer Repo Name'
const TERMINAL_BRANCH = 'aligned'

test.beforeAll(async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'terminator', process.cwd())
  await createWorkspace(page, LONG_REPO, process.cwd())
  await createWorkspace(page, 'Align', e2eTempDir('align-'))
  await addAndSelectProject(page, 'Align', TERMINAL_BRANCH)
  await expect(page.locator('.repo-header__count')).toHaveCount(3)
})

test.afterAll(async () => {
  await closeApp(handle)
})

interface Surface {
  id: string
  label: string
  part: string
  /** The control that opens a disclosure: what is behind it is a surface too. */
  expand?: string
  /** Whether its contrast is measured: Reviews has its own contrast spec. */
  themed: boolean
}

const SURFACES: Surface[] = [
  {
    id: 'terminator.remote-control',
    label: 'Remote Control',
    part: 'remote-control',
    expand: 'settings',
    themed: true,
  },
  { id: 'terminator.notepad', label: 'Notes', part: 'notepad', themed: true },
  { id: 'terminator.task-vault', label: 'Task Vault', part: 'task-vault', themed: true },
  { id: 'terminator.foundry', label: 'Foundry', part: 'foundry', themed: true },
  // Its other views (the Git project tab, the review window) share the URL, so
  // the view parameter is what tells this one apart.
  { id: 'terminator.git-integration', label: 'Reviews', part: 'view=reviews', themed: false },
]

/** The surface's frame, once loaded; runs `script` in it. */
async function inView<T>(part: string, script: string): Promise<T> {
  const frame = await findExtensionFrame(handle, part)
  return frame.evaluate(script) as Promise<T>
}

/** True once the surface's frame has loaded and drawn its view, which may be a lazy chunk. */
async function viewDrawn(part: string): Promise<boolean> {
  const frame = handle.page
    .frames()
    .find((f) => f.url().startsWith('ext://') && f.url().includes(part))
  if (!frame) return false
  const loaded = await frame.evaluate(() => document.readyState === 'complete').catch(() => false)
  return loaded && (await frame.evaluate<number>('document.body.innerText.length')) > 20
}

/** Opens the surface's panel, unless it is up (its band button toggles), and waits for it to draw. */
async function openSurface({ id, label, part }: Surface): Promise<void> {
  const panel = handle.page.locator(`[data-extension-panel="${id}"]`)
  if ((await panel.count()) === 0) {
    // The band, or the repo header's action where the surface lives there; any repo will do.
    await handle.page.locator(`button[aria-label="${label}"]`).first().click()
  }
  await expect(panel).toHaveCount(1)
  await expect
    .poll(() => viewDrawn(part), {
      message: `${label} view never finished loading`,
    })
    .toBe(true)
}

/** From now on, the view keeps every error it throws in window.__thrown. */
async function recordErrors(part: string): Promise<void> {
  await inView(
    part,
    `(() => {
        window.__thrown = []
        window.addEventListener('error', (e) => window.__thrown.push(String(e.message)))
        return true
      })()`
  )
}

/** Clicks the control that opens the disclosure, and waits for the screen to change. */
async function openDisclosure({ label, part, expand }: Surface): Promise<void> {
  const before = await inView<number>(part, 'document.body.innerText.length')
  const opened = await inView<boolean>(
    part,
    `(function () {
          var all = document.querySelectorAll('button')
          for (var i = 0; i < all.length; i++) {
            var text = (all[i].textContent || '') + ' ' + (all[i].getAttribute('aria-label') || '')
            if (/${expand}/i.test(text)) { all[i].click(); return true }
          }
          return false
        })()`
  )
  // A test that cannot reach the surface must say so rather than pass on the default screen —
  // which is how a crashing settings panel and two unstyled inputs both went unnoticed.
  expect(opened, `${label}: found no control matching /${expand}/i to open`).toBe(true)
  await expect
    .poll(() => inView<number>(part, 'document.body.innerText.length'), {
      message: `${label}: opening "${expand}" changed nothing on screen`,
    })
    .not.toBe(before)
}

interface StyleReport {
  thrown: string[]
  bodyLength: number
  unstyledInputs: string[]
  oversizedIcons: string[]
  bareButtons: string[]
  sideScrollers: string[]
}

/** Run in the view: what it threw, and every input, button, dialog and icon it
 * drew with nothing styling it. */
const STYLE_REPORT = `(() => {
        const unstyled = []
        for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select')) {
          const r = el.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) continue
          const cs = getComputedStyle(el)
          // What a control looks like when nothing has styled it: Chromium
          // paints a white field with an inset border. A transparent input on
          // a styled bar is a deliberate pattern and passes.
          const whiteField = cs.backgroundColor === 'rgb(255, 255, 255)'
          const insetBorder = cs.borderTopStyle === 'inset'
          if (whiteField || insetBorder) {
            unstyled.push(
              (el.className || el.tagName) + ' [' + cs.backgroundColor + ' / ' + cs.borderTopStyle + ']'
            )
          }
        }
        // No button renders the browser's native control. A modifier that
        // forgets a background used to produce a white pill on a dark panel.
        const bareButtons = []
        for (const el of document.querySelectorAll('button')) {
          const r = el.getBoundingClientRect()
          if (r.width < 1 || r.height < 1) continue
          const cs = getComputedStyle(el)
          if (cs.appearance === 'auto' || cs.borderTopStyle === 'outset') {
            bareButtons.push((el.className || el.getAttribute('aria-label') || 'button').toString().split(' ')[0])
          }
        }
        // A dialog scrolls down, never sideways — its own title and close
        // control are the first things to leave when it does.
        const sideScrollers = []
        for (const el of document.querySelectorAll('dialog, [role=dialog]')) {
          if (el.scrollWidth - el.clientWidth > 1) {
            sideScrollers.push(
              (el.className || 'dialog') + ' overflows by ' + (el.scrollWidth - el.clientWidth) + 'px'
            )
          }
        }
        const oversized = []
        for (const svg of document.querySelectorAll('svg')) {
          const r = svg.getBoundingClientRect()
          // 24px is lucide's fallback when nothing sized it. A deliberate
          // 36px empty-state glyph is a choice; this looks for the absence of one.
          if (Math.round(r.height) === 24) {
            oversized.push((svg.parentElement?.className || svg.tagName) + ' 24px')
          }
        }
        return {
          bareButtons,
          sideScrollers,
          thrown: window.__thrown || [],
          bodyLength: document.body.innerText.length,
          unstyledInputs: unstyled,
          oversizedIcons: oversized,
        }
      })()`

function expectStyled(label: string, report: StyleReport): void {
  expect(report.thrown, `${label} threw while rendering`).toHaveLength(0)
  expect(report.bodyLength, `${label} rendered an empty document`).toBeGreaterThan(20)
  const unstyled: [string, string[]][] = [
    ['controls with browser-default styling', report.unstyledInputs],
    ["buttons rendering the browser's native control", report.bareButtons],
    ['a dialog that scrolls sideways', report.sideScrollers],
    ["icons at lucide's 24px fallback (nothing sized them)", report.oversizedIcons],
  ]
  for (const [what, found] of unstyled) {
    expect(found, `${label} has ${what}: ${found.join(', ')}`).toHaveLength(0)
  }
}

// ── Themes ───────────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light'

/** Switches the app's theme through the API the settings panel uses. */
async function switchAppTheme(theme: Theme): Promise<void> {
  await handle.page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    window.electronAPI.extension.setTheme('${theme}')
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await expect
    .poll(() => handle.page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(theme)
}

/** Waits for the view to take `theme`: the frame shim hears it as a message after the app's own
 * switch. Dark is the absence of the attribute, so light is the only value to match against. */
async function expectViewTheme(part: string, theme: Theme): Promise<void> {
  await expect
    .poll(
      () => inView<string | null>(part, "document.documentElement.getAttribute('data-theme')"),
      {
        message: `${part} view never adopted the ${theme} theme`,
      }
    )
    .toBe(theme === 'light' ? 'light' : null)
}

/** Many colours are declared with a CSS transition, so the computed colour right after a theme
 * flip can be mid-interpolation: this waits for the view's own transitions to finish. */
async function transitionsSettled(part: string): Promise<void> {
  await inView(
    part,
    `(async () => {
      for (let i = 0; i < 60; i++) {
        if (document.getAnimations().length === 0) break
        await new Promise((r) => requestAnimationFrame(r))
      }
    })()`
  )
}

async function themeOn(part: string, theme: Theme): Promise<void> {
  await switchAppTheme(theme)
  await expectViewTheme(part, theme)
  await transitionsSettled(part)
}

/** Dark's base is #0c0c0f and light's #f0f0f5: the attribute is only useful if it repaints. */
async function viewFollowsTheAppIntoLight(): Promise<void> {
  const foundry = SURFACES.find((s) => s.label === 'Foundry')!
  await openSurface(foundry)
  const background = () =>
    inView<string>(foundry.part, 'getComputedStyle(document.body).backgroundColor')
  await themeOn(foundry.part, 'light')
  const light = await background()
  await themeOn(foundry.part, 'dark')
  expect(light).not.toBe(await background())
}

async function expectContrastMeetsAA({ label, part }: Surface, theme: Theme): Promise<void> {
  await themeOn(part, theme)
  const probes = await inView<Probe[]>(part, CONTRAST_PROBE)
  expect(probes.length, `${label} rendered no text to measure`).toBeGreaterThan(0)
  const failures = probes.filter((p) => p.ratio < p.required)
  const report = failures
    .map((f) => `  ${f.ratio}:1 (needs ${f.required}) ${f.selector} — "${f.text}"`)
    .join('\n')
  expect(failures, `${label} / ${theme}:\n${report}`).toHaveLength(0)
}

async function expectLinedUp(view: Pick<Frame, 'evaluate'>, screen: string): Promise<void> {
  await expect.poll(() => misalignedOn(view, screen)).toEqual([])
}

/** One surface, opened once: its contrast in both themes, then lined up and styled in dark. */
async function surfaceReadsWell(surface: Surface): Promise<void> {
  await openSurface(surface)
  await recordErrors(surface.part)
  if (surface.themed) {
    for (const theme of ['dark', 'light'] as const) {
      await test.step(`its text meets WCAG AA in the ${theme} theme`, () =>
        expectContrastMeetsAA(surface, theme))
    }
    await themeOn(surface.part, 'dark')
  }
  // On its first screen: Remote Control's Settings disclosure has a 28px field beside a 22px
  // button, a known misalignment this audit does not yet cover.
  await test.step('controls side by side line up', async () =>
    expectLinedUp(await findExtensionFrame(handle, surface.part), surface.label))
  await test.step('it renders, and everything on it is styled', async () => {
    // Anything behind a disclosure is a surface too, and the one that broke.
    if (surface.expand) await openDisclosure(surface)
    expectStyled(surface.label, await inView<StyleReport>(surface.part, STYLE_REPORT))
  })
}

// ── Lining up, with content on screen ────────────────────────────────────────

/** A project with a task, its card open, as the project card's add row is seen. */
async function projectCardWithATask(vault: ExtensionView): Promise<string[]> {
  await goToSection(vault, 'Projects')
  await vault.getByRole('button', { name: '+ New project' }).click()
  const found = await misalignedOn(vault, 'Task Vault: new project form')
  const form = vault.locator('.create-project-form')
  await form.getByPlaceholder('Project name').fill('Launch the website')
  await form.getByRole('button', { name: 'Create project' }).click()
  const card = vault.locator('.projects-browser__card').first()
  await card.getByRole('button', { name: /Show tasks tagged/ }).click()
  await card.getByPlaceholder(/Add task to/).fill('Write the landing copy')
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(card.locator('.projects-browser__task-text')).toHaveCount(1)
  return [...found, ...(await misalignedOn(vault, 'Task Vault: project card'))]
}

/** Today with a task, its add row open, then the task in edit. */
async function todayWithATask(vault: ExtensionView): Promise<string[]> {
  await goToSection(vault, 'Today')
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  const input = vault.locator('.daily-log__add-row input')
  await input.fill('Call the printer')
  await input.press('Enter')
  await expect(vault.locator('.daily-log__task-text')).toHaveCount(1)
  const found = await misalignedOn(vault, 'Task Vault: today')
  await vault.locator('.daily-log__task-text').dblclick({ position: { x: 4, y: 4 } })
  await expect(vault.locator('.daily-log__task-edit')).toBeVisible()
  found.push(...(await misalignedOn(vault, 'Task Vault: editing a task')))
  await vault.keyboard.press('Escape')
  return found
}

async function taskVaultLinesUpWithContent(): Promise<void> {
  const vault = await openVault(handle)
  const found = [...(await projectCardWithATask(vault)), ...(await todayWithATask(vault))]
  for (const section of ['Inbox', 'Areas', 'History', 'Weekly review']) {
    await goToSection(vault, section)
    found.push(...(await misalignedOn(vault, `Task Vault: ${section}`)))
  }
  expect(found).toEqual([])
}

async function notepadNewItemLinesUp(): Promise<void> {
  const notepad = await openNotepad(handle)
  await notepad.getByRole('button', { name: /^New/ }).first().click()
  const found = await misalignedOn(notepad, 'Notepad: new item')
  await notepad.keyboard.press('Escape')
  expect(found).toEqual([])
}

async function coreScreensLineUp(): Promise<void> {
  const { page } = handle
  // A sidebar click dismisses the extension surface and shows the branch's terminal.
  await projectGroup(page, TERMINAL_BRANCH).click()
  await expect(page.getByRole('textbox', { name: 'Terminal input' }).first()).toBeVisible()
  const found = await misalignedOn(page, 'terminal')
  await page.getByRole('button', { name: /^Home/ }).click()
  found.push(...(await misalignedOn(page, 'Home desk')))
  await page.getByRole('radio', { name: 'Insights' }).click()
  found.push(...(await misalignedOn(page, 'Home insights')))
  await page.getByRole('button', { name: 'Overview' }).click()
  found.push(...(await misalignedOn(page, 'Overview')))
  expect(found).toEqual([])
}

async function settingsSectionsLineUp(): Promise<void> {
  const { page } = handle
  const found: string[] = []
  for (const section of [
    'Appearance & Terminal',
    'Workspace Settings',
    'Integrations',
    'Extensions',
  ]) {
    await openSettingsSection(page, section)
    found.push(...(await misalignedOn(page, `Settings: ${section}`)))
  }
  await closeSettingsPanel(page)
  expect(found).toEqual([])
}

// ── The sidebar's columns ────────────────────────────────────────────────────

const COUNTS =
  '.repo-header__count, .branch-row__count, .branch-row__age, .unified-sidebar__scratch-count'

/** Each count's right edge and its type: one column, one type, whatever the repo's name. */
async function countsShareOneEdgeAndType(): Promise<void> {
  const counts = await handle.page.evaluate((selector) => {
    const shown = [...document.querySelectorAll(selector)].filter(
      (el) => el.getBoundingClientRect().width >= 1
    )
    const type = (el: Element) => {
      const cs = getComputedStyle(el)
      return `${cs.fontSize}/${cs.fontFamily.split(',')[0]}`
    }
    return {
      rights: [...new Set(shown.map((el) => Math.round(el.getBoundingClientRect().right)))],
      types: [...new Set(shown.map(type))],
    }
  }, COUNTS)
  expect(counts.rights, `counts sit at different right edges: ${counts.rights}`).toHaveLength(1)
  expect(counts.types, `counts are set in different types: ${counts.types}`).toHaveLength(1)
}

async function newControlsShareOneColumn(): Promise<void> {
  const rights = await handle.page.evaluate(() => {
    // Reveal the hover groups: they are in flow at rest, but transparent.
    for (const el of document.querySelectorAll<HTMLElement>(
      '.repo-header__hover, .branch-row__hover, .unified-sidebar__scratch-add'
    )) {
      el.style.opacity = '1'
    }
    const controls = [
      ...document.querySelectorAll(
        '.repo-header__action, .branch-row__action, .unified-sidebar__scratch-add'
      ),
    ].filter(
      (el) =>
        /^New /.test(el.getAttribute('aria-label') || '') && el.getBoundingClientRect().width >= 1
    )
    return [...new Set(controls.map((el) => Math.round(el.getBoundingClientRect().right)))]
  })
  expect(rights, `the + controls sit at different edges: ${rights}`).toHaveLength(1)
}

async function chevronsDrawnAtRestInOneColumn(): Promise<void> {
  const chevrons = await handle.page.evaluate(() =>
    [...document.querySelectorAll('.repo-header__chevron')].map((e) => ({
      left: Math.round(e.getBoundingClientRect().left),
      opacity: Number(getComputedStyle(e).opacity),
    }))
  )
  expect(chevrons.length).toBeGreaterThan(0)
  for (const c of chevrons)
    expect(c.opacity, 'the chevron must be drawn at rest').toBeGreaterThan(0)
  expect(new Set(chevrons.map((c) => c.left)).size, 'chevrons must share one column').toBe(1)
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const SURFACE_STEPS: Steps = [
  ['an extension view follows the app into the light theme', viewFollowsTheAppIntoLight],
  ...SURFACES.map((surface): Steps[number] => [
    `${surface.label}: renders styled${surface.themed ? ', reads at AA in both themes' : ''} and lines up`,
    () => surfaceReadsWell(surface),
  ]),
  ['every Task Vault section lines up, with content in it', taskVaultLinesUpWithContent],
  ["Notepad's new item dialog lines up", notepadNewItemLinesUp],
  ['Home, Overview and the terminal line up', coreScreensLineUp],
  ['every Settings section lines up', settingsSectionsLineUp],
  ['every count in the sidebar shares one right edge, in one type', countsShareOneEdgeAndType],
  ['every "new" control in the sidebar shares one column', newControlsShareOneColumn],
  [
    'a repo header says whether it is collapsed without being pointed at',
    chevronsDrawnAtRestInOneColumn,
  ],
]

test('every extension view and core screen renders styled, reads in both themes and lines up', async () => {
  for (const [title, body] of SURFACE_STEPS) await test.step(title, body)
})

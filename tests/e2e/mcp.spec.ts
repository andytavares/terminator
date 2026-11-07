import { test, expect, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { closeApp, e2eTempDir, launchApp, openSettingsSection, type AppHandle } from './helpers'
import { sealedAppEnvironment } from './e2e-environment'
import { openHome } from './session-views'
import { mcpSocketPath } from '../../src/main/mcp/socket-path'

// The Terminator MCP server (ADR 145): a client starts the relay as Claude Code would, over the
// app's own Electron in node mode, and each tool it calls shows on screen.

let handle: AppHandle
let client: Client | undefined

const ALERT = {
  title: 'pants-mono#4 is ready to merge',
  message: 'No conflicts.',
  source: 'Scheduled run · Check my PRs',
}

test.beforeAll(async () => {
  handle = await launchApp(e2eTempDir('mcp-'))
})

test.afterAll(async () => {
  await client?.close()
  await closeApp(handle)
})

/** Starts the relay the way Claude Code's registration does, once the app has written it. */
async function connectLikeClaudeCode(): Promise<Client> {
  const relayPath = join(handle.userDataDir, 'mcp', 'mcp-relay.cjs')
  const appTemp = await handle.app.evaluate(({ app }) => app.getPath('temp'))
  const socketPath = mcpSocketPath(handle.userDataDir, appTemp)
  await expect.poll(() => existsSync(relayPath) && existsSync(socketPath)).toBe(true)
  const electronBinary = await handle.app.evaluate(() => process.execPath)
  const environment = sealedAppEnvironment({
    home: e2eTempDir('mcp-home-'),
    tmpdir: e2eTempDir('mcp-tmp-'),
  })
  const transport = new StdioClientTransport({
    command: electronBinary,
    args: [relayPath, socketPath],
    env: { ...environment, ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_SESSION_ID: 'e2e-session' },
  })
  const connected = new Client({ name: 'e2e', version: '1.0.0' })
  await connected.connect(transport)
  return connected
}

async function callTool(name: string, args: Record<string, unknown>): Promise<void> {
  const result = await client!.callTool({ name, arguments: args })
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false)
}

async function toolsAreListed(): Promise<void> {
  const { tools } = await client!.listTools()
  const names = tools.map((tool) => tool.name)
  expect(names).toEqual(
    expect.arrayContaining(['alert', 'start_work', 'list_workspaces', 'install_update'])
  )
  const installUpdate = tools.find((tool) => tool.name === 'install_update')
  expect(installUpdate?._meta?.['anthropic/requiresUserInteraction']).toBe(true)
}

async function alertShowsInNeedsYou(page: Page): Promise<void> {
  await callTool('alert', ALERT)
  await openHome(page)
  const row = page.getByRole('region', { name: 'Needs you' }).getByText(ALERT.title)
  await expect(row).toBeVisible()
  await expect(page.getByRole('region', { name: 'Needs you' })).toContainText(ALERT.source)
}

async function startWorkOpensAScratchTerminal(page: Page): Promise<void> {
  await callTool('start_work', { prompt: 'echo hello', runAs: 'claude-terminal' })
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Terminal input' }).first()).toBeVisible()
}

async function quickActionOpensSettings(page: Page): Promise<void> {
  await callTool('run_quick_action', { id: 'core.open-settings' })
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await openSettingsSection(page, 'Integrations')
  // A background run never registers with Claude Code, so the block says it is disconnected.
  await expect(settings.getByText('Claude Code', { exact: true })).toBeVisible()
  await expect(
    settings.getByText('Disconnected. Claude sessions cannot use Terminator tools.')
  ).toBeVisible()
}

test('a Claude session drives Terminator through its MCP server', async () => {
  const { page } = handle
  await test.step('a client connects through the relay', async () => {
    client = await connectLikeClaudeCode()
  })
  await test.step('the tools are listed, install_update asks for the person', toolsAreListed)
  await test.step('alert shows a row in Needs you on Home', () => alertShowsInNeedsYou(page))
  await test.step('start_work opens a Claude terminal in Scratch', () =>
    startWorkOpensAScratchTerminal(page))
  await test.step('run_quick_action opens Settings, whose Integrations shows Claude Code', () =>
    quickActionOpensSettings(page))
})

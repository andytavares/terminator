import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { BrowserWindow } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { readHarness, writeHarness } from './core/harness.js'
import { appendHistoryEntry, readHistory, deleteHistoryEntry } from './core/history.js'
import {
  getStatus,
  createCheckpoint,
  stashChanges,
  revertFiles,
  getDiffForFile,
  removeWorktree,
  mergeWorktreeBranch,
  getDefaultBranch,
  getRemoteUrl,
  commitWorktreeChanges,
  pushBranch,
  listBranches,
  createWorktreeFromBranch,
} from './core/git.js'
import { cleanupLegacySessions } from './core/session-cleanup.js'
import { runSensor, runAllSensors } from './core/sensors.js'
import { isAvailable as keychainAvailable, storeKey, deleteKey } from './core/keychain.js'
import { validateDag, topoSort } from './core/dag.js'
import {
  healthEvents,
  trackSensorResult,
  trackGateDecision,
  trackStaleRefs,
  resolveHealthEvent,
  setHealthChangedCallback,
  resetHealthState,
} from './core/health.js'
export { trackSensorResult, trackGateDecision }
import type {
  Run,
  RunLogEntry,
  RunLogKind,
  Harness,
  HarnessHealthEvent,
} from './types/foundry.types.js'
import { ClaudeAdapter } from './providers/claude.js'
import { ClaudeCodeAdapter } from './providers/claude-code.js'
import { OpenAIAdapter } from './providers/openai.js'
import { GeminiAdapter } from './providers/gemini.js'
import { OllamaAdapter } from './providers/ollama.js'
import type { ProviderAdapter } from './providers/adapter.js'
import { readProviders, writeProviders } from './core/providers.js'
import type { StoredProvider } from './core/providers.js'

const disposables: Disposable[] = []

// In-memory active run registry: workspaceRoot → Run
const activeRuns = new Map<string, Run>()

// ─── Session persistence ──────────────────────────────────────────────────────
// Persists the active run + its logs so they survive app restarts.

async function saveSession(workspaceRoot: string, run: Run): Promise<void> {
  try {
    const dir = path.join(workspaceRoot, '.foundry')
    await fs.mkdir(dir, { recursive: true })
    const agentMap = subAgentLogs.get(run.id)
    const subAgentLogsObj: Record<string, RunLogEntry[]> = {}
    if (agentMap) {
      for (const [agentId, entries] of agentMap.entries()) {
        subAgentLogsObj[agentId] = entries
      }
    }
    const session = {
      run,
      logs: runLogs.get(run.id) ?? [],
      subAgentLogs: subAgentLogsObj,
    }
    const tmp = path.join(dir, 'session.json.tmp')
    await fs.writeFile(tmp, JSON.stringify(session), 'utf-8')
    await fs.rename(tmp, path.join(dir, 'session.json'))
  } catch {
    // non-fatal — session just won't persist
  }
}

// Saves a permanent log archive for a completed run so logs survive app restarts.
// Also persists subAgents so re-runs can skip replanning.
async function saveRunLogs(workspaceRoot: string, run: Run): Promise<void> {
  const runId = run.id
  try {
    const logsDir = path.join(workspaceRoot, '.foundry', 'logs')
    await fs.mkdir(logsDir, { recursive: true })
    const agentMap = subAgentLogs.get(runId)
    const subAgentLogsObj: Record<string, RunLogEntry[]> = {}
    if (agentMap) {
      for (const [agentId, entries] of agentMap.entries()) {
        subAgentLogsObj[agentId] = entries
      }
    }
    const data = {
      runLogs: runLogs.get(runId) ?? [],
      subAgentLogs: subAgentLogsObj,
      subAgents: run.subAgents ?? [],
    }
    await fs.writeFile(path.join(logsDir, `${runId}.json`), JSON.stringify(data), 'utf-8')
  } catch {
    // non-fatal
  }
}

async function deleteRunLogs(workspaceRoot: string, runId: string): Promise<void> {
  try {
    await fs.unlink(path.join(workspaceRoot, '.foundry', 'logs', `${runId}.json`))
  } catch {
    // file may not exist
  }
}

async function loadSession(
  workspaceRoot: string
): Promise<{ run: Run; logs: RunLogEntry[] } | null> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, '.foundry', 'session.json'), 'utf-8')
    return JSON.parse(raw) as { run: Run; logs: RunLogEntry[] }
  } catch {
    return null
  }
}

async function clearSession(workspaceRoot: string): Promise<void> {
  try {
    await fs.unlink(path.join(workspaceRoot, '.foundry', 'session.json'))
  } catch {
    // file may not exist
  }
}

// Per-run log buffer: runId → entries (capped at 2000 to avoid unbounded growth)
const runLogs = new Map<string, RunLogEntry[]>()
const RUN_LOG_CAP = 2000

// Per-sub-agent log buffer: runId → agentId → entries
const subAgentLogs = new Map<string, Map<string, RunLogEntry[]>>()

// Co-pilot conversation history: runId → messages
interface CopilotConvMsg {
  role: 'user' | 'assistant'
  content: string
}
const copilotHistory = new Map<string, CopilotConvMsg[]>()

// Co-pilot per-turn file tracking: runId → filePaths modified in current turn
const copilotTurnFiles = new Map<string, string[]>()

function appendLog(runId: string, kind: RunLogKind, message: string) {
  let entries = runLogs.get(runId)
  if (!entries) {
    entries = []
    runLogs.set(runId, entries)
  }
  if (entries.length >= RUN_LOG_CAP) entries.shift()
  const entry: RunLogEntry = { ts: new Date().toISOString(), kind, message }
  entries.push(entry)
  broadcast('foundry:run-log', { runId, entry })
}

function appendSubAgentLog(runId: string, agentId: string, kind: RunLogKind, message: string) {
  let agentMap = subAgentLogs.get(runId)
  if (!agentMap) {
    agentMap = new Map()
    subAgentLogs.set(runId, agentMap)
  }
  let entries = agentMap.get(agentId)
  if (!entries) {
    entries = []
    agentMap.set(agentId, entries)
  }
  if (entries.length >= RUN_LOG_CAP) entries.shift()
  const entry: RunLogEntry = { ts: new Date().toISOString(), kind, message }
  entries.push(entry)
  // Also append to parent run log with role prefix for the console view
  appendLog(runId, kind, message)
  broadcast('foundry:subagent-log', { runId, agentId, entry })
}

function runDurationMs(run: Run): number {
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now()
  return Math.max(0, end - new Date(run.createdAt).getTime())
}

function broadcastAndSave(run: Run) {
  broadcast('foundry:run-status-changed', { runId: run.id, status: run.status })
  void saveSession(run.workspaceRoot, run)
}

function cleanupWorktree(run: Run, workspaceRoot: string): void {
  if (!run.worktreePath || !run.featureBranch) return
  const { worktreePath, featureBranch } = run
  void removeWorktree(workspaceRoot, worktreePath, featureBranch)
  broadcast('foundry:worktree-removed', {
    runId: run.id,
    workspaceRoot,
    worktreePath,
    terminalProjectId: run.terminalProjectId,
  })
}

function broadcast(channel: string, payload: unknown) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  } catch {
    // BrowserWindow unavailable outside Electron runtime
  }
}

function reg(
  api: ExtensionAPI,
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) {
  disposables.push(api.ipc.registerHandler(channel, handler))
}

// ─── Provider adapter factory ───────────────────────────────────────────────

function buildAdapter(provider: StoredProvider, _workspaceRoot: string): ProviderAdapter | null {
  const retries = provider.maxRetries ?? undefined
  const delay = provider.requestDelayMs ?? undefined
  switch (provider.type) {
    case 'claude-code':
      return new ClaudeCodeAdapter(provider.id, provider.model || '')
    case 'claude':
      if (!provider.keychainKey) return null
      return new ClaudeAdapter(provider.id, provider.model, provider.keychainKey, retries, delay)
    case 'openai':
      if (!provider.keychainKey) return null
      return new OpenAIAdapter(provider.id, provider.model, provider.keychainKey, retries, delay)
    case 'gemini':
      if (!provider.keychainKey) return null
      return new GeminiAdapter(provider.id, provider.model, provider.keychainKey, retries, delay)
    case 'ollama':
      return new OllamaAdapter(
        provider.id,
        provider.model,
        provider.endpoint ?? 'http://localhost:11434',
        retries,
        delay
      )
    default:
      return null
  }
}

// ─── Orchestrate execution ────────────────────────────────────────────────────

const PLAN_PROMPT = `You are a software orchestration planner. Decompose the following task into a DAG of specialized sub-agents (2–6 agents). Agents with no dependencies run in parallel.

Return ONLY valid JSON, no other text:
{"agents":[{"id":"agent-1","role":"schema agent","task":"specific task","dependsOn":[]},{"id":"agent-2","role":"impl agent","task":"specific task","dependsOn":["agent-1"]}]}

Rules: max 6 agents, short role names (2–3 words), no cycles.

Task: `

type PlanAgent = { id: string; role: string; task: string; dependsOn: string[] }

async function planOrchestration(
  taskDescription: string,
  adapter: import('./providers/adapter.js').ProviderAdapter,
  workspaceRoot: string
): Promise<{ agents: PlanAgent[] } | { error: string }> {
  let planBuffer = ''
  try {
    for await (const event of adapter.run({
      mode: 'spec-to-code',
      providerId: '',
      model: '',
      prompt: PLAN_PROMPT + taskDescription,
      workspaceRoot,
      agentsMdContent: '',
      iterationLimit: 1,
    })) {
      if (event.type === 'token') planBuffer += event.token
      if (event.type === 'error') return { error: `Planning failed: ${event.message}` }
    }
  } catch (err) {
    return { error: `Planning error: ${String(err)}` }
  }

  const jsonMatch = planBuffer.match(/```json\s*([\s\S]*?)```/) ?? planBuffer.match(/(\{[\s\S]*\})/)
  let rawJson = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : planBuffer.trim()
  rawJson = rawJson.replace(/```[\s\S]*$/, '').trim()

  try {
    const parsed = JSON.parse(rawJson) as { agents?: PlanAgent[] }
    const agents = parsed.agents ?? []
    if (agents.length === 0) return { error: 'Orchestration plan returned 0 agents.' }
    return { agents }
  } catch {
    return { error: `Could not parse orchestration plan. Raw response: ${rawJson.slice(0, 300)}` }
  }
}

async function executeOrchestrate(
  run: Run,
  harness: Harness,
  adapter: import('./providers/adapter.js').ProviderAdapter,
  provider: StoredProvider,
  workspaceRoot: string,
  runRoot: string,
  agentsMdContent: string,
  workspaceListing: string
): Promise<void> {
  // Build a fully-contextualized prompt for a sub-agent
  function buildAgentPrompt(
    subAgent: import('./types/foundry.types.js').SubAgent,
    taskText: string
  ): string {
    const parts: string[] = [taskText]

    // Include completed upstream agents so this agent knows what's already been done
    const upstream = (subAgent.dependsOn ?? [])
      .map((id) => run.subAgents!.find((a) => a.agentId === id))
      .filter((a) => a && a.status === 'done')
    if (upstream.length > 0) {
      parts.push('\n## Completed upstream steps')
      for (const up of upstream) {
        if (!up) continue
        const upTask = up.task && up.task !== up.role ? `${up.role}: ${up.task}` : up.role
        parts.push(`- ${upTask}`)
      }
    }

    // Include worktree file listing so the agent can see the current state
    if (workspaceListing) {
      parts.push(`\n## Current worktree state\n${workspaceListing}`)
    }

    // Append retry feedback last so the model treats it as the most specific instruction
    if (subAgent.retryFeedback) {
      parts.push(
        `\n## Code review feedback — address these issues specifically\n${subAgent.retryFeedback}`
      )
    }

    return parts.join('\n')
  }

  // Skip AI planning if the user provided a manual DAG
  if (run.subAgents && run.subAgents.length > 0) {
    appendLog(
      run.id,
      'system',
      `Using manual flow: ${run.subAgents.length} agents — ${run.subAgents.map((a) => a.role).join(', ')}`
    )
    broadcastAndSave(run)
    const tiers = topoSort(run.subAgents)
    for (const tier of tiers) {
      if (activeRuns.get(workspaceRoot)?.id !== run.id) return
      await Promise.all(
        tier.map(async (agentId) => {
          const subAgent = run.subAgents!.find((a) => a.agentId === agentId)
          if (!subAgent) return
          // Skip agents that already completed successfully (retry-from support)
          if (subAgent.status === 'done') return
          subAgent.status = 'running'
          broadcastAndSave(run)
          const taskText = subAgent.task ?? subAgent.role
          const manualPrompt = buildAgentPrompt(subAgent, taskText)
          appendSubAgentLog(run.id, agentId, 'system', `${subAgent.role} — starting`)
          if (subAgent.retryFeedback)
            appendSubAgentLog(
              run.id,
              agentId,
              'system',
              `Retry feedback: ${subAgent.retryFeedback}`
            )
          try {
            for await (const event of adapter.run({
              mode: 'spec-to-code',
              providerId: run.providerId,
              model: run.model,
              prompt: manualPrompt,
              workspaceRoot: runRoot,
              agentsMdContent,
              iterationLimit: 1,
            })) {
              if (activeRuns.get(workspaceRoot)?.id !== run.id) return
              if (event.type === 'token') {
                if (event.token.trim()) appendSubAgentLog(run.id, agentId, 'agent', event.token)
              } else if (event.type === 'file-changed') {
                const existing = run.fileChanges.find((c) => c.filePath === event.filePath)
                if (!existing) run.fileChanges.push(event.change)
                else {
                  existing.linesAdded += event.change.linesAdded
                  existing.linesRemoved += event.change.linesRemoved
                }
                appendSubAgentLog(
                  run.id,
                  agentId,
                  'file',
                  `${event.change.status === 'new' ? '+' : '~'} ${event.filePath.replace(workspaceRoot + '/', '')}`
                )
              } else if (event.type === 'error') {
                appendSubAgentLog(run.id, agentId, 'error', event.message)
                subAgent.status = 'rejected'
                return
              }
            }
            subAgent.status = 'done'
            subAgent.retryFeedback = undefined
            appendSubAgentLog(run.id, agentId, 'ok', `${subAgent.role} complete`)
          } catch (err) {
            subAgent.status = 'rejected'
            appendSubAgentLog(run.id, agentId, 'error', String(err))
          }
          broadcastAndSave(run)
        })
      )
    }
    if (harness.sensors.length > 0) {
      const sensorResults = await runAllSensors(harness.sensors, runRoot)
      run.sensorResults = sensorResults
      for (const r of sensorResults) {
        appendLog(run.id, 'sensor', `${r.pass ? '✓' : '✗'} ${r.sensorName} (${r.durationMs}ms)`)
        if (!r.pass) {
          const detail = [r.stderrExcerpt, r.stdoutExcerpt].filter(Boolean).join('\n').trim()
          if (detail) appendLog(run.id, 'error', detail.slice(0, 300))
        }
        trackSensorResult(r.sensorName, r.pass, workspaceRoot)
      }
      const allPassed = sensorResults.every((r) => r.pass)
      if (harness.gateDefaults.sensorsMustPassBeforeGate && !allPassed) {
        appendLog(
          run.id,
          'error',
          'Sensors failed — fix the issues above or disable "sensors must pass before gate" in harness settings.'
        )
        run.status = 'paused-error'
        broadcastAndSave(run)
        return
      }
    }
    const anyRejected = run.subAgents.some((a) => a.status === 'rejected')
    if (anyRejected) {
      run.status = 'paused-error'
      run.completedAt = new Date().toISOString()
      appendLog(run.id, 'error', 'Flow completed with errors')
      broadcastAndSave(run)
      return
    }
    // Always gate orchestrate runs — user reviews changes before merging
    appendLog(run.id, 'ok', 'All agents complete — review changes before merging')
    run.status = 'gate'
    broadcastAndSave(run)
    return
    return
  }

  appendLog(run.id, 'system', `Planning sub-agents for: ${(run.prompt ?? '').slice(0, 80)}…`)

  const planResult = await planOrchestration(run.prompt ?? '', adapter, runRoot)
  if ('error' in planResult) {
    appendLog(run.id, 'error', planResult.error)
    run.status = 'paused-error'
    broadcastAndSave(run)
    return
  }
  const parsedAgents = planResult.agents

  // Map to SubAgent type and attach to run — store task so retries have the full prompt
  run.subAgents = parsedAgents.map((a) => ({
    agentId: a.id,
    role: a.role,
    task: a.task,
    dependsOn: a.dependsOn,
    inputFrom: a.dependsOn,
    outputArtifacts: [],
    status: 'pending' as const,
  }))
  appendLog(
    run.id,
    'system',
    `Plan: ${run.subAgents.length} agents — ${run.subAgents.map((a) => a.role).join(', ')}`
  )
  broadcastAndSave(run)

  // Phase 2: execute in topological tiers
  const tiers = topoSort(run.subAgents)
  appendLog(run.id, 'system', `Executing ${tiers.length} tier(s) in order…`)

  for (const tier of tiers) {
    if (activeRuns.get(workspaceRoot)?.id !== run.id) return
    appendLog(
      run.id,
      'system',
      `Tier: [${tier.map((id) => run.subAgents!.find((a) => a.agentId === id)?.role ?? id).join(', ')}]`
    )

    await Promise.all(
      tier.map(async (agentId) => {
        const subAgent = run.subAgents!.find((a) => a.agentId === agentId)
        if (!subAgent) return
        // Skip agents that already completed successfully (retry-from support)
        if (subAgent.status === 'done') return
        subAgent.status = 'running'
        broadcastAndSave(run)

        const agentData = parsedAgents.find((a) => a.id === agentId)
        const baseTask = subAgent.task ?? agentData?.task ?? subAgent.role
        const agentPrompt = buildAgentPrompt(subAgent, baseTask)

        appendSubAgentLog(run.id, agentId, 'system', `${subAgent.role} — starting`)
        if (subAgent.retryFeedback)
          appendSubAgentLog(run.id, agentId, 'system', `Retry feedback: ${subAgent.retryFeedback}`)
        try {
          for await (const event of adapter.run({
            mode: 'spec-to-code',
            providerId: run.providerId,
            model: run.model,
            prompt: agentPrompt,
            workspaceRoot: runRoot,
            agentsMdContent,
            iterationLimit: 1,
          })) {
            if (activeRuns.get(workspaceRoot)?.id !== run.id) return
            if (event.type === 'token') {
              if (event.token.trim()) appendSubAgentLog(run.id, agentId, 'agent', event.token)
            } else if (event.type === 'file-changed') {
              const existing = run.fileChanges.find((c) => c.filePath === event.filePath)
              if (!existing) run.fileChanges.push(event.change)
              else {
                existing.linesAdded += event.change.linesAdded
                existing.linesRemoved += event.change.linesRemoved
              }
              appendSubAgentLog(
                run.id,
                agentId,
                'file',
                `${event.change.status === 'new' ? '+' : '~'} ${event.filePath.replace(workspaceRoot + '/', '')}`
              )
            } else if (event.type === 'error') {
              appendSubAgentLog(run.id, agentId, 'error', `error: ${event.message}`)
              subAgent.status = 'rejected'
              return
            }
          }
          subAgent.status = 'done'
          subAgent.retryFeedback = undefined
          appendSubAgentLog(run.id, agentId, 'ok', `${subAgent.role} complete`)
        } catch (err) {
          subAgent.status = 'rejected'
          appendSubAgentLog(run.id, agentId, 'error', `failed: ${String(err)}`)
        }
        broadcastAndSave(run)
      })
    )
  }

  // All tiers done — run sensors and open gate (or auto-approve)
  if (harness.sensors.length > 0) {
    appendLog(run.id, 'system', `Running ${harness.sensors.length} sensor(s)…`)
    const sensorResults = await runAllSensors(harness.sensors, runRoot)
    run.sensorResults = sensorResults
    for (const r of sensorResults) {
      appendLog(run.id, 'sensor', `${r.pass ? '✓' : '✗'} ${r.sensorName} (${r.durationMs}ms)`)
      if (!r.pass) {
        const detail = [r.stderrExcerpt, r.stdoutExcerpt].filter(Boolean).join('\n').trim()
        if (detail) appendLog(run.id, 'error', detail.slice(0, 300))
      }
      trackSensorResult(r.sensorName, r.pass, workspaceRoot)
    }
    const allPassed = sensorResults.every((r) => r.pass)
    if (harness.gateDefaults.sensorsMustPassBeforeGate && !allPassed) {
      appendLog(
        run.id,
        'error',
        'Sensors failed — fix the issues above or disable "sensors must pass before gate" in harness settings.'
      )
      run.status = 'paused-error'
      broadcastAndSave(run)
      return
    }
  }

  const anyRejected = run.subAgents.some((a) => a.status === 'rejected')
  if (anyRejected) {
    run.status = 'paused-error'
    run.completedAt = new Date().toISOString()
    appendLog(run.id, 'error', 'Orchestration completed with errors')
    broadcastAndSave(run)
    return
  }

  if (harness.gateDefaults.requireGateAfterEachIteration) {
    appendLog(
      run.id,
      'system',
      `Gate open — ${run.subAgents.length} agents done, awaiting your review`
    )
    run.status = 'gate'
    broadcastAndSave(run)
    return
  }

  // Always gate orchestrate runs — user reviews changes before merging
  appendLog(
    run.id,
    'ok',
    `All ${run.subAgents.length} agents complete — review changes before merging`
  )
  run.status = 'gate'
  broadcastAndSave(run)
}

// ─── Run execution loop ──────────────────────────────────────────────────────

const LISTING_IGNORE = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.gradle',
])

async function buildWorktreeListing(root: string, depth = 0, prefix = ''): Promise<string> {
  const MAX_DEPTH = 4
  const MAX_ENTRIES = 300
  const lines: string[] = []

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return ''
  }

  entries.sort((a, b) => {
    // Directories first, then files, alphabetically within each group
    if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name)
    return a.isDirectory() ? -1 : 1
  })

  for (const entry of entries) {
    if (lines.length >= MAX_ENTRIES) {
      lines.push(`${prefix}… (truncated)`)
      break
    }
    if (entry.name.startsWith('.') || LISTING_IGNORE.has(entry.name)) continue
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`)
      if (depth < MAX_DEPTH - 1) {
        const sub = await buildWorktreeListing(
          path.join(root, entry.name),
          depth + 1,
          prefix + '  '
        )
        if (sub) lines.push(sub)
      }
    } else {
      lines.push(`${prefix}${entry.name}`)
    }
  }

  return lines.join('\n')
}

async function executeRun(run: Run, harness: Harness): Promise<void> {
  const workspaceRoot = run.workspaceRoot
  const providers = await readProviders()
  const provider = providers.find((p) => p.id === run.providerId)

  if (!provider) {
    run.status = 'paused-error'
    appendLog(
      run.id,
      'error',
      `Provider "${run.providerId}" not found. Add it in Harness Settings.`
    )
    broadcastAndSave(run)
    return
  }

  const adapter = buildAdapter(provider, workspaceRoot)
  if (!adapter) {
    run.status = 'paused-error'
    appendLog(
      run.id,
      'error',
      `Cannot build adapter for provider "${provider.id}" — check that an API key is saved.`
    )
    broadcastAndSave(run)
    return
  }

  // Worktree is always created in foundry:run-create before this function runs.
  // run.worktreePath is always set at this point.
  const runRoot = run.worktreePath
  appendLog(run.id, 'system', `Worktree: ${runRoot}  (branch: ${run.featureBranch})`)
  appendLog(run.id, 'system', `Working directory: ${runRoot}`)

  // Read AGENTS.md for system context
  let agentsMdContent = ''
  try {
    agentsMdContent = await fs.readFile(path.join(runRoot, harness.agentsMdPath), 'utf-8')
    appendLog(run.id, 'system', `Loaded ${harness.agentsMdPath} (${agentsMdContent.length} chars)`)
  } catch {
    appendLog(
      run.id,
      'system',
      `No ${harness.agentsMdPath} found — running without feedforward context`
    )
  }

  // Build a recursive file tree of the worktree so the agent knows the full structure
  const workspaceListing = await buildWorktreeListing(runRoot)
  if (workspaceListing) {
    appendLog(
      run.id,
      'system',
      `Workspace snapshot: ${workspaceListing.split('\n').length} entries`
    )
  }

  // ─── Orchestrate mode: plan then execute tiers ──────────────────────────────
  if (run.mode === 'orchestrate') {
    await executeOrchestrate(
      run,
      harness,
      adapter,
      provider,
      workspaceRoot,
      runRoot,
      agentsMdContent,
      workspaceListing
    )
    return
  }

  // Build the user prompt — spec file content takes precedence, freeform prompt appended after
  let effectivePrompt = run.prompt ?? ''
  if (run.specPath) {
    try {
      const specFilePath = path.isAbsolute(run.specPath)
        ? run.specPath
        : path.join(workspaceRoot, run.specPath)
      const specContent = await fs.readFile(specFilePath, 'utf-8')
      effectivePrompt = specContent + (effectivePrompt ? `\n\n${effectivePrompt}` : '')
    } catch {
      appendLog(run.id, 'error', `Could not read spec file: ${run.specPath}`)
      run.status = 'paused-error'
      broadcastAndSave(run)
      return
    }
  }

  if (!effectivePrompt.trim()) {
    appendLog(run.id, 'error', 'No prompt or spec content — cannot start run')
    run.status = 'paused-error'
    broadcastAndSave(run)
    return
  }

  appendLog(run.id, 'system', `Calling ${provider.type} (${run.model})…`)

  let tokenBuffer = ''
  let tokenCountIn = 0
  let tokenCountOut = 0

  try {
    const request = {
      mode: run.mode,
      providerId: run.providerId,
      model: run.model,
      prompt: effectivePrompt,
      workspaceRoot: runRoot,
      agentsMdContent,
      workspaceListing,
      iterationLimit: run.iterationLimit,
    }

    for await (const event of adapter.run(request)) {
      // Bail if run was aborted/dismissed while streaming
      if (activeRuns.get(workspaceRoot)?.id !== run.id) return

      if (event.type === 'token') {
        // Tokens from the adapter are already line-granular — log each directly
        if (event.token.trim()) appendLog(run.id, 'agent', event.token)
        tokenBuffer += event.token
      } else if (event.type === 'file-changed') {
        // Adapter executed a tool that wrote a file — track the change
        const existing = run.fileChanges.find((c) => c.filePath === event.filePath)
        if (!existing) {
          run.fileChanges.push(event.change)
        } else {
          existing.linesAdded += event.change.linesAdded
          existing.linesRemoved += event.change.linesRemoved
        }
        appendLog(
          run.id,
          'file',
          `${event.change.status === 'new' ? '+' : '~'} ${event.filePath.replace(workspaceRoot + '/', '')}`
        )
        broadcast('foundry:run-event', {
          runId: run.id,
          event: { type: 'file-changed', filePath: event.filePath },
        })
      } else if (event.type === 'done') {
        if (tokenBuffer.trim()) {
          appendLog(run.id, 'agent', tokenBuffer)
          tokenBuffer = ''
        }
        tokenCountIn = event.tokenCountIn
        tokenCountOut = event.tokenCountOut
        // Accumulate on run object so gate-decision history entries can read them
        run.tokenCountIn = (run.tokenCountIn ?? 0) + tokenCountIn
        run.tokenCountOut = (run.tokenCountOut ?? 0) + tokenCountOut
        appendLog(
          run.id,
          'system',
          `Agent finished — ${tokenCountIn} in / ${tokenCountOut} out tokens`
        )
      } else if (event.type === 'error') {
        appendLog(run.id, 'error', `Provider error: ${event.message}`)
        run.status = 'paused-error'
        broadcastAndSave(run)
        return
      }
    }

    // Flush any remaining buffer
    if (tokenBuffer.trim()) appendLog(run.id, 'agent', tokenBuffer)

    // Run sensors before opening gate
    if (harness.sensors.length > 0) {
      appendLog(run.id, 'system', `Running ${harness.sensors.length} sensor(s) in ${runRoot}…`)
      const sensorResults = await runAllSensors(harness.sensors, runRoot)
      run.sensorResults = sensorResults
      for (const r of sensorResults) {
        const icon = r.pass ? '✓' : '✗'
        appendLog(run.id, 'sensor', `${icon} ${r.sensorName} (${r.durationMs}ms)`)
        if (!r.pass && r.stdoutExcerpt)
          appendLog(run.id, 'sensor', `  ${r.stdoutExcerpt.slice(0, 200)}`)
        trackSensorResult(r.sensorName, r.pass, workspaceRoot)
      }

      const allPassed = sensorResults.every((r) => r.pass)
      if (harness.gateDefaults.sensorsMustPassBeforeGate && !allPassed) {
        appendLog(
          run.id,
          'error',
          'Sensors failed — gate blocked. Fix issues or disable "sensors must pass" in settings.'
        )
        run.status = 'paused-error'
        broadcastAndSave(run)
        return
      }
    }

    if (harness.gateDefaults.requireGateAfterEachIteration) {
      appendLog(
        run.id,
        'system',
        `Gate open — awaiting your review (iteration ${run.currentIteration}/${run.iterationLimit})`
      )
      run.status = 'gate'
      broadcastAndSave(run)
    } else {
      // Auto-approve: merge worktree changes back (worktree kept per spec unless user opts in)
      appendLog(run.id, 'system', 'Merging changes back to workspace…')
      const mergeResult = await mergeWorktreeBranch(workspaceRoot, run.featureBranch)
      if ('error' in mergeResult) {
        appendLog(
          run.id,
          'system',
          `Merge note: ${mergeResult.error} — changes remain on branch ${run.featureBranch}`
        )
      }
      appendLog(run.id, 'ok', 'Run complete (auto-approved — no gate required)')
      run.status = 'done'
      run.completedAt = new Date().toISOString()
      activeRuns.delete(workspaceRoot)
      void saveRunLogs(workspaceRoot, run)
      void clearSession(workspaceRoot)
      // Do NOT delete runLogs here — RunConsole needs to read them after completion
      const sensorSummaryAuto =
        run.sensorResults && run.sensorResults.length > 0
          ? `${run.sensorResults.filter((r) => r.pass).length}/${run.sensorResults.length}`
          : '0/0'
      await appendHistoryEntry(workspaceRoot, {
        runId: run.id,
        mode: run.mode,
        providerId: run.providerId,
        providerLabel: provider.id,
        model: run.model,
        specPath: run.specPath,
        promptSummary: (run.prompt ?? '').slice(0, 200),
        status: 'done',
        tokenCountIn: run.tokenCountIn ?? tokenCountIn,
        tokenCountOut: run.tokenCountOut ?? tokenCountOut,
        sensorSummary: sensorSummaryAuto,
        gateDecisions: [],
        filesChangedCount: run.fileChanges.length,
        durationMs: Date.now() - new Date(run.createdAt).getTime(),
        createdAt: run.createdAt,
        completedAt: run.completedAt!,
        featureBranch: run.featureBranch,
        baseBranch: run.baseBranch,
        worktreePath: run.worktreePath,
        terminalProjectId: run.terminalProjectId,
      })
      broadcastAndSave(run)
    }
  } catch (err) {
    appendLog(run.id, 'error', `Unexpected error: ${String(err)}`)
    run.status = 'paused-error'
    broadcastAndSave(run)
  }
}

export function activate(api: ExtensionAPI): void {
  // Wire health broadcast callback
  setHealthChangedCallback(() => {
    broadcast('foundry:health-changed', { events: healthEvents })
  })

  // ─── Git ─────────────────────────────────────────────────────────────────────
  reg(api, 'foundry:branch-list', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    const result = await listBranches(workspaceRoot)
    if ('error' in result) return { error: result.error }
    return { branches: result.branches }
  })

  // ─── Harness ───────────────────────────────────────────────────────────────
  reg(api, 'foundry:harness-read', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    return readHarness(workspaceRoot)
  })

  reg(api, 'foundry:harness-write', async (payload: unknown) => {
    const { workspaceRoot, harness } = payload as {
      workspaceRoot: string
      harness: Parameters<typeof writeHarness>[1]
    }
    if (!workspaceRoot || !harness) return { error: 'workspaceRoot and harness required' }
    return writeHarness(workspaceRoot, harness)
  })

  reg(api, 'foundry:agents-md-read', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    try {
      const content = await fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf-8')
      return { content }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { notFound: true }
      return { error: String(err) }
    }
  })

  reg(api, 'foundry:agents-md-write', async (payload: unknown) => {
    const { workspaceRoot, content } = payload as { workspaceRoot: string; content: string }
    if (!workspaceRoot || content === undefined)
      return { error: 'workspaceRoot and content required' }
    try {
      await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), content, 'utf-8')
      return { ok: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  reg(api, 'foundry:agents-md-scan', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    try {
      const content = await fs.readFile(path.join(workspaceRoot, 'AGENTS.md'), 'utf-8')
      const staleRefs: Array<{ line: number; ref: string }> = []
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].matchAll(
          /`([^`]+\.[a-zA-Z]+[^`]*)`|(?:^|\s)((?:\.\.?\/|src\/|docs\/)\S+\.\w+)/g
        )
        for (const m of matches) {
          const ref = (m[1] || m[2]).trim()
          if (!ref) continue
          const absPath = path.isAbsolute(ref) ? ref : path.join(workspaceRoot, ref)
          try {
            await fs.access(absPath)
          } catch {
            staleRefs.push({ line: i + 1, ref })
          }
        }
      }
      // Emit stale-reference health event so FoundryPanel can display an alert
      trackStaleRefs(staleRefs)
      return { staleRefs }
    } catch (err) {
      // AGENTS.md doesn't exist — clear any stale-reference alert
      trackStaleRefs([])
      return { error: String(err) }
    }
  })

  // IPC to resolve (dismiss) a specific health event from the UI
  reg(api, 'foundry:health-resolve', (payload: unknown) => {
    const { kind, key } = payload as { kind: HarnessHealthEvent['kind']; key?: string }
    if (!kind) return { error: 'kind required' }
    resolveHealthEvent(kind, key)
    return { ok: true }
  })

  // ─── Provider ──────────────────────────────────────────────────────────────

  reg(api, 'foundry:provider-list', async () => {
    const providers = await readProviders()
    return { providers }
  })

  reg(api, 'foundry:provider-save', async (payload: unknown) => {
    const { provider, apiKey } = payload as {
      provider: StoredProvider
      apiKey?: string
    }
    if (!keychainAvailable() && apiKey) {
      return { error: 'OS encryption unavailable — cannot store API key securely' }
    }
    if (apiKey && provider.keychainKey) {
      await storeKey(provider.keychainKey, apiKey)
    }
    const providers = await readProviders()
    const idx = providers.findIndex((p) => p.id === provider.id)
    if (idx >= 0) providers[idx] = provider
    else providers.push(provider)
    await writeProviders(providers)
    return { provider }
  })

  reg(api, 'foundry:provider-delete', async (payload: unknown) => {
    const { providerId } = payload as { providerId: string }
    const providers = await readProviders()
    const idx = providers.findIndex((p) => p.id === providerId)
    if (idx >= 0) {
      const p = providers[idx]
      if (p.keychainKey) await deleteKey(p.keychainKey)
      providers.splice(idx, 1)
      await writeProviders(providers)
    }
    return { ok: true }
  })

  reg(api, 'foundry:provider-test', async (payload: unknown) => {
    const { providerId } = payload as { providerId: string }
    const providers = await readProviders()
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) return { error: 'Provider not found' }
    const adapter = buildAdapter(provider, '')
    if (!adapter) return { error: 'Cannot build adapter — check API key is saved' }
    return adapter.testConnection()
  })

  // ─── Sensor ────────────────────────────────────────────────────────────────
  reg(api, 'foundry:sensor-run', async (payload: unknown) => {
    const { sensorName, command, workspaceRoot } = payload as {
      sensorName: string
      command: string
      workspaceRoot: string
    }
    if (!sensorName || !command || !workspaceRoot)
      return { error: 'sensorName, command, workspaceRoot required' }
    const result = await runSensor({ name: sensorName, command }, workspaceRoot)
    return { result }
  })

  reg(api, 'foundry:sensors-run-all', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    const harnessResult = await readHarness(workspaceRoot)
    if ('error' in harnessResult || 'notFound' in harnessResult) return { results: [] }
    const results = await runAllSensors(harnessResult.harness.sensors, workspaceRoot)
    for (const r of results) trackSensorResult(r.sensorName, r.pass, workspaceRoot)
    return { results }
  })

  // Re-run sensors for an active run (uses the worktree if isolated)
  reg(api, 'foundry:run-sensors', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }
    const harnessResult = await readHarness(workspaceRoot)
    if ('error' in harnessResult || 'notFound' in harnessResult)
      return { error: 'Cannot read harness' }
    const runRoot = run.worktreePath ?? workspaceRoot
    appendLog(run.id, 'system', `Re-running ${harnessResult.harness.sensors.length} sensor(s)…`)
    const results = await runAllSensors(harnessResult.harness.sensors, runRoot)
    run.sensorResults = results
    for (const r of results) {
      appendLog(run.id, 'sensor', `${r.pass ? '✓' : '✗'} ${r.sensorName} (${r.durationMs}ms)`)
      trackSensorResult(r.sensorName, r.pass, workspaceRoot)
    }
    broadcastAndSave(run)
    return { results }
  })

  // ─── Git ───────────────────────────────────────────────────────────────────
  reg(api, 'foundry:git-status', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    return getStatus(workspaceRoot)
  })

  reg(api, 'foundry:git-checkpoint', async (payload: unknown) => {
    const { workspaceRoot, runId } = payload as { workspaceRoot: string; runId: string }
    return createCheckpoint(workspaceRoot, runId)
  })

  reg(api, 'foundry:git-stash', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    return stashChanges(workspaceRoot)
  })

  reg(api, 'foundry:git-revert-files', async (payload: unknown) => {
    const { workspaceRoot, filePaths } = payload as { workspaceRoot: string; filePaths: string[] }
    return revertFiles(workspaceRoot, filePaths ?? [])
  })

  reg(api, 'foundry:git-diff-file', async (payload: unknown) => {
    const { workspaceRoot, filePath } = payload as { workspaceRoot: string; filePath: string }
    const run = activeRuns.get(workspaceRoot)
    // If filePath is inside the worktree, use the worktree as the git root
    const worktreePath = run?.worktreePath
    const diffRoot =
      worktreePath && filePath.startsWith(worktreePath) ? worktreePath : workspaceRoot
    return getDiffForFile(diffRoot, filePath)
  })

  // ─── Run ───────────────────────────────────────────────────────────────────
  reg(api, 'foundry:run-create', async (payload: unknown) => {
    const {
      workspaceRoot,
      mode,
      providerId,
      model,
      baseBranch,
      featureBranch,
      existingWorktreePath,
      specPath,
      prompt,
      iterationLimit,
      manualDag,
    } = payload as {
      workspaceRoot: string
      mode: string
      providerId: string
      model: string
      baseBranch: string
      featureBranch: string
      /** When re-running a previous run, pass the existing worktree path to skip git worktree add */
      existingWorktreePath?: string
      specPath?: string
      prompt?: string
      iterationLimit?: number
      manualDag?: Array<{ id: string; role: string; task: string; dependsOn: string[] }>
    }
    if (!workspaceRoot || !mode || !providerId || !model)
      return { error: 'workspaceRoot, mode, providerId, model required' }
    if (!baseBranch) return { error: 'baseBranch required — select a base branch to start from' }
    if (!featureBranch) return { error: 'featureBranch required — provide a feature branch name' }

    const existing = activeRuns.get(workspaceRoot)
    if (existing && (existing.status === 'running' || existing.status === 'gate')) {
      return { error: 'A run is already active in this workspace' }
    }

    const harnessResult = await readHarness(workspaceRoot)
    if ('error' in harnessResult) return { error: `Cannot read harness: ${harnessResult.error}` }
    if ('notFound' in harnessResult) return { error: 'Harness not configured. Run setup first.' }

    // Resolve the worktree path — reuse an existing one if provided, otherwise create fresh
    let resolvedWorktreePath: string
    if (existingWorktreePath) {
      // Re-run: verify the worktree directory still exists, then reuse it
      try {
        await fs.access(existingWorktreePath)
        resolvedWorktreePath = existingWorktreePath
      } catch {
        return {
          error: `Worktree no longer exists at ${existingWorktreePath}. Delete the run and start fresh.`,
        }
      }
    } else {
      const worktreeResult = await createWorktreeFromBranch(
        workspaceRoot,
        featureBranch,
        baseBranch
      )
      if ('error' in worktreeResult) {
        return { error: `Could not create worktree: ${worktreeResult.error}` }
      }
      resolvedWorktreePath = worktreeResult.worktreePath
    }

    const run: Run = {
      id: crypto.randomUUID(),
      mode: mode as Run['mode'],
      providerId,
      model,
      specPath,
      prompt,
      status: 'running',
      createdAt: new Date().toISOString(),
      workspaceRoot,
      currentIteration: 1,
      iterationLimit: iterationLimit ?? harnessResult.harness.iterationLimit,
      iterations: [],
      fileChanges: [],
      baseBranch,
      featureBranch,
      worktreePath: resolvedWorktreePath,
    }

    // Broadcast worktree-created so renderer can create/reuse a Terminator project for it
    broadcast('foundry:worktree-created', {
      runId: run.id,
      workspaceRoot,
      worktreePath: resolvedWorktreePath,
      branch: featureBranch,
      label: featureBranch.replace(/\//g, '-'),
    })

    // Pre-populate subAgents if the user provided a manual DAG
    if (mode === 'orchestrate' && manualDag && manualDag.length > 0) {
      run.subAgents = manualDag.map((a) => ({
        agentId: a.id,
        role: a.role,
        task: a.task,
        dependsOn: a.dependsOn,
        inputFrom: a.dependsOn,
        outputArtifacts: [],
        status: 'pending' as const,
      }))
    }

    activeRuns.set(workspaceRoot, run)
    appendLog(run.id, 'system', `Run started — mode: ${run.mode}, model: ${run.model}`)
    if (run.checkpointCommit) appendLog(run.id, 'system', `Git checkpoint: ${run.checkpointCommit}`)
    if (run.specPath) appendLog(run.id, 'system', `Spec: ${run.specPath}`)
    broadcastAndSave(run)

    // Fire-and-forget: execute the run asynchronously so we return immediately
    void executeRun(run, harnessResult.harness)

    return { run }
  })

  reg(api, 'foundry:run-gate-decide', async (payload: unknown) => {
    const { runId, workspaceRoot, decision, note } = payload as {
      runId: string
      workspaceRoot: string
      decision: string
      note?: string
    }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }

    if (decision === 'reject') {
      appendLog(
        run.id,
        'system',
        `Gate decision: reject — reverting ${run.fileChanges.length} file(s) in worktree`
      )
      // Revert files in the worktree so the branch is clean for inspection
      const filePaths = run.fileChanges.map((c) => c.filePath)
      if (filePaths.length > 0) await revertFiles(run.worktreePath, filePaths)
      run.status = 'rejected'
      run.completedAt = new Date().toISOString()
      activeRuns.delete(workspaceRoot)
      void saveRunLogs(workspaceRoot, run)
      void clearSession(workspaceRoot)
      // Do NOT delete runLogs — RunConsole needs them after completion
      trackGateDecision(run.specPath ?? '', run.currentIteration, 'reject', workspaceRoot)
      const sensorSummaryReject =
        run.sensorResults && run.sensorResults.length > 0
          ? `${run.sensorResults.filter((r) => r.pass).length}/${run.sensorResults.length}`
          : '0/0'
      await appendHistoryEntry(workspaceRoot, {
        runId: run.id,
        mode: run.mode,
        providerId: run.providerId,
        providerLabel: run.providerId,
        model: run.model,
        specPath: run.specPath,
        promptSummary: (run.prompt ?? '').slice(0, 200),
        status: 'rejected',
        tokenCountIn: run.tokenCountIn ?? 0,
        tokenCountOut: run.tokenCountOut ?? 0,
        sensorSummary: sensorSummaryReject,
        gateDecisions: [
          {
            iterationNumber: run.currentIteration,
            decision: 'reject',
            note,
            decidedAt: new Date().toISOString(),
          },
        ],
        filesChangedCount: run.fileChanges.length,
        durationMs: runDurationMs(run),
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        featureBranch: run.featureBranch,
        baseBranch: run.baseBranch,
        worktreePath: run.worktreePath,
        terminalProjectId: run.terminalProjectId,
      })
      broadcastAndSave(run)
      return { run }
    }

    if (decision === 'approve') {
      const removeWorktreeAfterMerge = !!(payload as { removeWorktree?: boolean }).removeWorktree
      const skipMerge = !!(payload as { skipMerge?: boolean }).skipMerge
      if (skipMerge) {
        appendLog(run.id, 'ok', `Changes kept on branch ${run.featureBranch}`)
      } else {
        appendLog(run.id, 'ok', 'Gate approved — merging changes to workspace…')
        const mergeResult = await mergeWorktreeBranch(workspaceRoot, run.featureBranch)
        if ('error' in mergeResult) {
          appendLog(
            run.id,
            'system',
            `Merge note: ${mergeResult.error} — changes remain on branch ${run.featureBranch}`
          )
        } else {
          appendLog(run.id, 'ok', 'Changes merged into workspace')
          if (removeWorktreeAfterMerge) {
            cleanupWorktree(run, workspaceRoot)
          }
        }
      }
      run.status = 'done'
      run.completedAt = new Date().toISOString()
      activeRuns.delete(workspaceRoot)
      void saveRunLogs(workspaceRoot, run)
      void clearSession(workspaceRoot)
      // Do NOT delete runLogs — RunConsole needs them after completion
      trackGateDecision(run.specPath ?? '', run.currentIteration, 'approve', workspaceRoot)
      const sensorSummaryApprove =
        run.sensorResults && run.sensorResults.length > 0
          ? `${run.sensorResults.filter((r) => r.pass).length}/${run.sensorResults.length}`
          : '0/0'
      await appendHistoryEntry(workspaceRoot, {
        runId: run.id,
        mode: run.mode,
        providerId: run.providerId,
        providerLabel: run.providerId,
        model: run.model,
        specPath: run.specPath,
        promptSummary: (run.prompt ?? '').slice(0, 200),
        status: 'done',
        tokenCountIn: run.tokenCountIn ?? 0,
        tokenCountOut: run.tokenCountOut ?? 0,
        sensorSummary: sensorSummaryApprove,
        gateDecisions: [
          {
            iterationNumber: run.currentIteration,
            decision: 'approve',
            note,
            decidedAt: new Date().toISOString(),
          },
        ],
        filesChangedCount: run.fileChanges.length,
        durationMs: runDurationMs(run),
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        featureBranch: run.featureBranch,
        baseBranch: run.baseBranch,
        worktreePath: removeWorktreeAfterMerge ? undefined : run.worktreePath,
        terminalProjectId: run.terminalProjectId,
      })
      broadcastAndSave(run)
      return { run }
    }

    if (decision === 'request-changes') {
      appendLog(
        run.id,
        'system',
        `Gate: request-changes — starting iteration ${run.currentIteration + 1}${note ? ` — feedback: ${note}` : ''}`
      )
      // Revert previous iteration's files in the worktree so the next iteration starts clean
      const runRoot = run.worktreePath ?? workspaceRoot
      const prevFilePaths = run.fileChanges.map((c) => c.filePath)
      if (prevFilePaths.length > 0) {
        appendLog(
          run.id,
          'system',
          `Reverting ${prevFilePaths.length} file(s) before next iteration…`
        )
        await revertFiles(runRoot, prevFilePaths)
      }
      run.currentIteration++
      run.status = 'running'
      run.fileChanges = []
      if (note) run.prompt = `[FEEDBACK]: ${note}\n\n${run.prompt ?? ''}`
      broadcastAndSave(run)
      // Re-read harness and re-execute the next iteration
      const harnessResult = await readHarness(workspaceRoot)
      if (!('error' in harnessResult) && !('notFound' in harnessResult)) {
        void executeRun(run, harnessResult.harness)
      }
      return { run }
    }

    return { error: `Unknown decision: ${decision}` }
  })

  // ── foundry:run-merge — commit worktree changes and merge to default branch ──
  reg(api, 'foundry:run-merge', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }

    try {
      // Commit any uncommitted changes in the worktree
      const commitResult = await commitWorktreeChanges(
        run.worktreePath,
        `foundry: ${run.specPath ? path.basename(run.specPath, path.extname(run.specPath)) : 'run'}`
      )
      if ('error' in commitResult) {
        // Nothing to commit is fine — may already be clean
        if (!commitResult.error.includes('nothing to commit')) {
          return { error: `Could not commit: ${commitResult.error}` }
        }
      }
      // Merge the worktree branch into the default branch
      const defaultBranch = await getDefaultBranch(workspaceRoot)
      const mergeResult = await mergeWorktreeBranch(workspaceRoot, run.featureBranch)
      if ('error' in mergeResult) return { error: `Could not merge: ${mergeResult.error}` }

      appendLog(run.id, 'system', `Merged ${run.featureBranch} → ${defaultBranch}`)
      run.status = 'done'
      run.completedAt = new Date().toISOString()
      broadcastAndSave(run)
      return { ok: true, defaultBranch }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── foundry:run-create-pr — push branch and open GitHub PR ────────────────
  reg(api, 'foundry:run-create-pr', async (payload: unknown) => {
    const { runId, workspaceRoot, title, body } = payload as {
      runId: string
      workspaceRoot: string
      title?: string
      body?: string
    }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }

    try {
      // Commit any uncommitted changes first
      const commitResult = await commitWorktreeChanges(
        run.worktreePath,
        `foundry: ${run.specPath ? path.basename(run.specPath, path.extname(run.specPath)) : 'run'}`
      )
      if ('error' in commitResult && !commitResult.error.includes('nothing to commit')) {
        return { error: `Could not commit: ${commitResult.error}` }
      }
      // Push the worktree branch to origin
      const pushResult = await pushBranch(workspaceRoot, run.featureBranch)
      if ('error' in pushResult) return { error: `Could not push: ${pushResult.error}` }

      const defaultBranch = await getDefaultBranch(workspaceRoot)
      const remoteUrl = await getRemoteUrl(workspaceRoot)
      const prTitle =
        title ??
        `foundry: ${run.specPath ? path.basename(run.specPath, path.extname(run.specPath)) : run.id.slice(0, 8)}`
      const prBody = body ?? ''

      appendLog(run.id, 'system', `Pushed ${run.featureBranch} to origin`)
      return { ok: true, branch: run.featureBranch, defaultBranch, remoteUrl, prTitle, prBody }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── foundry:run-get-merge-info — check default branch and remote ──────────
  reg(api, 'foundry:run-get-merge-info', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    try {
      const [defaultBranch, remoteUrl] = await Promise.all([
        getDefaultBranch(workspaceRoot),
        getRemoteUrl(workspaceRoot),
      ])
      return { defaultBranch, remoteUrl }
    } catch (err) {
      return { error: String(err) }
    }
  })

  reg(api, 'foundry:run-abort', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }

    // Abort leaves the worktree intact — user can inspect it and delete later.
    // No file revert, no worktree removal. Just mark aborted.
    appendLog(run.id, 'system', 'Run aborted — worktree preserved for inspection')
    run.status = 'aborted'
    run.completedAt = new Date().toISOString()
    activeRuns.delete(workspaceRoot)
    void saveRunLogs(workspaceRoot, run)
    void clearSession(workspaceRoot)
    // Do NOT delete runLogs — RunConsole needs them after completion
    await appendHistoryEntry(workspaceRoot, {
      runId: run.id,
      mode: run.mode,
      providerId: run.providerId,
      providerLabel: run.providerId,
      model: run.model,
      specPath: run.specPath,
      promptSummary: (run.prompt ?? '').slice(0, 200),
      status: 'aborted',
      tokenCountIn: run.tokenCountIn ?? 0,
      tokenCountOut: run.tokenCountOut ?? 0,
      sensorSummary: '0/0',
      gateDecisions: [],
      filesChangedCount: run.fileChanges.length,
      durationMs: runDurationMs(run),
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      featureBranch: run.featureBranch,
      baseBranch: run.baseBranch,
      worktreePath: run.worktreePath,
      terminalProjectId: run.terminalProjectId,
    })
    broadcastAndSave(run)
    return { ok: true }
  })

  reg(api, 'foundry:run-delete', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }

    let worktreePath: string | undefined
    let featureBranch: string | undefined
    let terminalProjectId: string | undefined

    const activeRun = activeRuns.get(workspaceRoot)
    if (activeRun && activeRun.id === runId) {
      worktreePath = activeRun.worktreePath
      featureBranch = activeRun.featureBranch
      terminalProjectId = activeRun.terminalProjectId
      activeRun.status = 'aborted'
      activeRun.completedAt = activeRun.completedAt ?? new Date().toISOString()
      activeRuns.delete(workspaceRoot)
      runLogs.delete(runId)
      subAgentLogs.delete(runId)
      void deleteRunLogs(workspaceRoot, runId)
      void clearSession(workspaceRoot)
    } else {
      try {
        const { entries } = await readHistory(workspaceRoot, 0, 200)
        const entry = entries.find((e) => e.runId === runId)
        if (!entry) return { error: `Run "${runId}" not found` }
        worktreePath = entry.worktreePath
        featureBranch = entry.featureBranch
        terminalProjectId = entry.terminalProjectId
      } catch {
        return { error: `Run "${runId}" not found` }
      }
    }

    if (worktreePath && featureBranch) {
      await removeWorktree(workspaceRoot, worktreePath, featureBranch).catch(() => undefined)
    }

    await deleteHistoryEntry(workspaceRoot, runId).catch(() => undefined)

    if (terminalProjectId) {
      broadcast('foundry:worktree-removed', {
        runId,
        workspaceRoot,
        worktreePath,
        terminalProjectId,
      })
    }

    return { ok: true }
  })

  reg(api, 'foundry:run-dismiss', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    // Dismiss removes the run from memory and clears its log buffer.
    // Worktree is NOT cleaned up — user must use foundry:run-delete for that.
    const activeRun = activeRuns.get(workspaceRoot)
    if (activeRun && activeRun.id === runId) {
      const finalStatus =
        activeRun.status === 'done' || activeRun.status === 'rejected'
          ? activeRun.status
          : 'aborted'
      activeRun.status = finalStatus
      activeRun.completedAt = activeRun.completedAt ?? new Date().toISOString()

      // Write to history if the run wasn't already recorded (done/rejected are written at completion)
      if (finalStatus === 'aborted') {
        await appendHistoryEntry(workspaceRoot, {
          runId: activeRun.id,
          mode: activeRun.mode,
          providerId: activeRun.providerId,
          providerLabel: activeRun.providerId,
          model: activeRun.model,
          specPath: activeRun.specPath,
          promptSummary: (activeRun.prompt ?? '').slice(0, 200),
          status: 'aborted',
          tokenCountIn: activeRun.tokenCountIn ?? 0,
          tokenCountOut: activeRun.tokenCountOut ?? 0,
          sensorSummary: activeRun.sensorResults
            ? `${activeRun.sensorResults.filter((r) => r.pass).length}/${activeRun.sensorResults.length}`
            : '0/0',
          gateDecisions: [],
          filesChangedCount: activeRun.fileChanges.length,
          durationMs: runDurationMs(activeRun),
          createdAt: activeRun.createdAt,
          completedAt: activeRun.completedAt,
          featureBranch: activeRun.featureBranch,
          baseBranch: activeRun.baseBranch,
          worktreePath: activeRun.worktreePath,
          terminalProjectId: activeRun.terminalProjectId,
        })
      }

      activeRuns.delete(workspaceRoot)
      runLogs.delete(runId)
      subAgentLogs.delete(runId)
      void deleteRunLogs(workspaceRoot, runId)
      void clearSession(workspaceRoot)
      broadcast('foundry:run-status-changed', { runId, status: finalStatus })
    }
    return { ok: true }
  })

  reg(api, 'foundry:run-logs', async (payload: unknown) => {
    const { runId, workspaceRoot: ws } = payload as { runId: string; workspaceRoot?: string }
    const inMemory = runLogs.get(runId)
    if (inMemory) return { entries: inMemory }
    if (ws) {
      try {
        const raw = await fs.readFile(path.join(ws, '.foundry', 'logs', `${runId}.json`), 'utf-8')
        const data = JSON.parse(raw) as { runLogs?: RunLogEntry[] }
        return { entries: data.runLogs ?? [] }
      } catch {
        // log archive not found
      }
    }
    return { entries: [] }
  })

  reg(api, 'foundry:subagent-logs', async (payload: unknown) => {
    const {
      runId,
      agentId,
      workspaceRoot: ws,
    } = payload as { runId: string; agentId: string; workspaceRoot?: string }
    const inMemory = subAgentLogs.get(runId)?.get(agentId)
    if (inMemory) return { entries: inMemory }
    if (ws) {
      try {
        const raw = await fs.readFile(path.join(ws, '.foundry', 'logs', `${runId}.json`), 'utf-8')
        const data = JSON.parse(raw) as { subAgentLogs?: Record<string, RunLogEntry[]> }
        return { entries: data.subAgentLogs?.[agentId] ?? [] }
      } catch {
        // log archive not found
      }
    }
    return { entries: [] }
  })

  // Returns saved subAgents for a completed run so re-runs can skip replanning
  reg(api, 'foundry:history-get-agents', async (payload: unknown) => {
    const { runId, workspaceRoot: ws } = payload as { runId: string; workspaceRoot: string }
    try {
      const raw = await fs.readFile(path.join(ws, '.foundry', 'logs', `${runId}.json`), 'utf-8')
      const data = JSON.parse(raw) as { subAgents?: SubAgent[] }
      return { subAgents: data.subAgents ?? [] }
    } catch {
      return { subAgents: [] }
    }
  })

  reg(api, 'foundry:run-retry', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }
    if (run.status !== 'paused-error') return { error: 'Run is not in a retryable state' }
    run.status = 'running'
    appendLog(run.id, 'system', 'Retrying run…')
    broadcastAndSave(run)
    const harnessResult = await readHarness(workspaceRoot)
    if ('error' in harnessResult || 'notFound' in harnessResult) {
      run.status = 'paused-error'
      appendLog(run.id, 'error', 'Cannot read harness — cannot retry')
      broadcastAndSave(run)
      return { error: 'Cannot read harness' }
    }
    void executeRun(run, harnessResult.harness)
    return { ok: true }
  })

  reg(api, 'foundry:orchestrate-retry-from', async (payload: unknown) => {
    const { runId, workspaceRoot, agentId, feedback } = payload as {
      runId: string
      workspaceRoot: string
      agentId: string
      feedback?: string
    }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }
    if (run.status !== 'paused-error') return { error: 'Run is not in a retryable state' }
    if (!run.subAgents) return { error: 'No sub-agents on this run' }

    const targetAgent = run.subAgents.find((a) => a.agentId === agentId)
    if (!targetAgent) return { error: `Agent "${agentId}" not found` }

    // Find all agents that depend on the target (transitively) — they must also be reset
    function findDownstream(id: string, agents: typeof run.subAgents!): Set<string> {
      const result = new Set<string>()
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()!
        for (const a of agents) {
          if (a.dependsOn.includes(current) && !result.has(a.agentId)) {
            result.add(a.agentId)
            queue.push(a.agentId)
          }
        }
      }
      return result
    }

    const downstream = findDownstream(agentId, run.subAgents)

    // Reset target and downstream agents to pending
    for (const a of run.subAgents) {
      if (a.agentId === agentId || downstream.has(a.agentId)) {
        a.status = 'pending'
        if (a.agentId === agentId && feedback) a.retryFeedback = feedback
      }
    }

    run.status = 'running'
    appendLog(run.id, 'system', `Retrying from agent "${targetAgent.role}"…`)
    broadcastAndSave(run)

    const harnessResult = await readHarness(workspaceRoot)
    if ('error' in harnessResult || 'notFound' in harnessResult) {
      run.status = 'paused-error'
      appendLog(run.id, 'error', 'Cannot read harness — cannot retry')
      broadcastAndSave(run)
      return { error: 'Cannot read harness' }
    }
    void executeRun(run, harnessResult.harness)
    return { ok: true }
  })

  reg(api, 'foundry:run-switch-provider', async (payload: unknown) => {
    const { runId, workspaceRoot, providerId, model } = payload as {
      runId: string
      workspaceRoot: string
      providerId: string
      model: string
    }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }
    if (run.status !== 'paused-error')
      return { error: 'Can only switch provider on a paused-error run' }
    run.providerId = providerId
    run.model = model
    run.status = 'running'
    appendLog(run.id, 'system', `Switched provider to ${providerId} (${model}) — retrying…`)
    broadcastAndSave(run)
    const harnessResultSP = await readHarness(workspaceRoot)
    if (!('error' in harnessResultSP) && !('notFound' in harnessResultSP)) {
      void executeRun(run, harnessResultSP.harness)
    }
    return { run }
  })

  // Store the Terminator project ID created by the renderer for this worktree
  reg(api, 'foundry:set-project-id', (payload: unknown) => {
    const { runId, workspaceRoot, projectId } = payload as {
      runId: string
      workspaceRoot: string
      projectId: string
    }
    const run = activeRuns.get(workspaceRoot)
    if (run?.id === runId) {
      run.terminalProjectId = projectId
      void saveSession(workspaceRoot, run)
    }
    return { ok: true }
  })

  reg(api, 'foundry:run-list', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }

    // Boot-time cleanup: detect and wipe legacy session.json files (old format without featureBranch)
    await cleanupLegacySessions(workspaceRoot)

    // Restore a persisted session if the app restarted with an active run in progress
    if (!activeRuns.has(workspaceRoot)) {
      const session = await loadSession(workspaceRoot)
      if (session) {
        const { run, logs } = session
        if (run.workspaceRoot !== workspaceRoot) {
          void clearSession(workspaceRoot)
        } else if (!run.featureBranch) {
          // Legacy session without featureBranch — clean it up
          void clearSession(workspaceRoot)
        } else {
          const isResumable = run.status === 'gate' || run.status === 'paused-error'
          const wasRunning = run.status === 'running'
          if (isResumable || wasRunning) {
            if (wasRunning) {
              run.status = 'paused-error'
              logs.push({
                ts: new Date().toISOString(),
                kind: 'system',
                message: 'App restarted — run paused. Use ↺ Retry to resume.',
              })
            }
            activeRuns.set(workspaceRoot, run)
            runLogs.set(run.id, logs)
            // Restore per-agent logs if present in session
            const savedSubAgentLogs = (session as { subAgentLogs?: Record<string, RunLogEntry[]> })
              .subAgentLogs
            if (savedSubAgentLogs) {
              const agentMap = new Map<string, RunLogEntry[]>()
              for (const [agentId, entries] of Object.entries(savedSubAgentLogs)) {
                agentMap.set(agentId, entries)
              }
              subAgentLogs.set(run.id, agentMap)
            }
            void saveSession(workspaceRoot, run)
          } else {
            void clearSession(workspaceRoot)
          }
        }
      }
    }

    const active = activeRuns.get(workspaceRoot)
    // Read recent completed runs from history so they persist across restarts
    let historicalRuns: Array<{
      id: string
      mode: string
      status: string
      model: string
      specPath?: string
      prompt?: string
      createdAt: string
      completedAt?: string
      fileChanges: []
      currentIteration: number
      iterationLimit: number
      iterations: []
      providerId: string
      workspaceRoot: string
      featureBranch?: string
      baseBranch?: string
      worktreePath?: string
    }> = []
    try {
      const { entries } = await readHistory(workspaceRoot, 0, 50)
      historicalRuns = entries.map((e) => ({
        id: e.runId,
        mode: e.mode,
        status: e.status,
        model: e.model,
        specPath: e.specPath,
        prompt: e.promptSummary,
        createdAt: e.createdAt,
        completedAt: e.completedAt,
        fileChanges: [],
        currentIteration: e.gateDecisions.length,
        iterationLimit: 0,
        iterations: [],
        providerId: e.providerId,
        workspaceRoot,
        featureBranch: e.featureBranch,
        baseBranch: e.baseBranch,
        worktreePath: e.worktreePath,
      }))
    } catch {
      // history file may not exist yet
    }
    // Active run takes precedence; exclude from history list to avoid duplicates
    const activeId = active?.id
    const filtered = historicalRuns.filter((r) => r.id !== activeId)
    return { runs: active ? [active, ...filtered] : filtered }
  })

  // ─── File picker / reader (renderer can't use dialog directly) ────────────
  reg(api, 'foundry:open-file', async (payload: unknown) => {
    const { filters, multiSelect } = (payload ?? {}) as {
      filters?: Array<{ name: string; extensions: string[] }>
      multiSelect?: boolean
    }
    try {
      const { dialog, BrowserWindow: BW } = await import('electron')
      const win = BW.getFocusedWindow()
      const result = await dialog.showOpenDialog(win, {
        properties: multiSelect ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: filters ?? [{ name: 'All files', extensions: ['*'] }],
      })
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true }
      return multiSelect ? { filePaths: result.filePaths } : { filePath: result.filePaths[0] }
    } catch (err) {
      return { error: String(err) }
    }
  })

  reg(api, 'foundry:read-file', async (payload: unknown) => {
    const { filePath } = payload as { filePath: string }
    if (!filePath) return { error: 'filePath required' }
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return { content, filePath }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ─── Orchestrate ───────────────────────────────────────────────────────────
  reg(api, 'foundry:orchestrate-plan', async (payload: unknown) => {
    const { workspaceRoot, taskDescription, providerId } = payload as {
      workspaceRoot: string
      taskDescription: string
      providerId: string
    }
    if (!workspaceRoot || !taskDescription || !providerId)
      return { error: 'workspaceRoot, taskDescription, providerId required' }
    const providers = await readProviders()
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) return { error: `Provider "${providerId}" not found` }
    const adapter = buildAdapter(provider, workspaceRoot)
    if (!adapter) return { error: 'Cannot build adapter — check that an API key is saved.' }
    return planOrchestration(taskDescription, adapter, workspaceRoot)
  })

  reg(api, 'foundry:dag-validate', (payload: unknown) => {
    const { subAgents } = payload as { subAgents: Parameters<typeof validateDag>[0] }
    if (!subAgents) return { valid: false, cycleNodes: [] }
    return validateDag(subAgents)
  })

  // ─── Co-pilot ──────────────────────────────────────────────────────────────
  reg(api, 'foundry:copilot-send', async (payload: unknown) => {
    const { runId, workspaceRoot, message } = payload as {
      runId: string
      workspaceRoot: string
      message: string
    }
    if (!runId || !workspaceRoot || !message)
      return { error: 'runId, workspaceRoot, message required' }

    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }

    const providers = await readProviders()
    const provider = providers.find((p) => p.id === run.providerId)
    if (!provider) return { error: `Provider "${run.providerId}" not found` }
    if (!provider.supportsStreaming) {
      return {
        error:
          'Co-pilot requires a streaming-capable provider (Claude, OpenAI, or Gemini). Ollama is not supported.',
      }
    }

    const adapter = buildAdapter(provider, workspaceRoot)
    if (!adapter) return { error: 'Cannot build adapter — check that an API key is saved.' }

    // Load AGENTS.md for system context
    let agentsMdContent = ''
    try {
      const harnessResult = await readHarness(workspaceRoot)
      if (!('error' in harnessResult) && !('notFound' in harnessResult)) {
        agentsMdContent = await fs
          .readFile(path.join(workspaceRoot, harnessResult.harness.agentsMdPath), 'utf-8')
          .catch(() => '')
      }
    } catch {
      // no harness — proceed without feedforward context
    }

    // Build conversation history for this run
    const history = copilotHistory.get(runId) ?? []
    history.push({ role: 'user', content: message })
    copilotHistory.set(runId, history)

    // Reset per-turn file tracking
    copilotTurnFiles.set(runId, [])

    // Stream asynchronously — return immediately so UI is not blocked waiting
    void (async () => {
      try {
        const conversationHistory = history.slice(0, -1).map((m) => ({
          id: crypto.randomUUID(),
          role: m.role === 'user' ? ('user' as const) : ('agent' as const),
          content: m.content,
          timestamp: new Date().toISOString(),
        }))

        let assistantText = ''
        for await (const event of adapter.run({
          mode: 'co-pilot',
          providerId: run.providerId,
          model: run.model,
          prompt: message,
          workspaceRoot,
          agentsMdContent,
          iterationLimit: 1,
          conversationHistory,
        })) {
          if (event.type === 'token') {
            assistantText += event.token
            broadcast('foundry:copilot-event', { runId, event })
          } else if (event.type === 'file-changed') {
            const turnFiles = copilotTurnFiles.get(runId) ?? []
            if (!turnFiles.includes(event.filePath)) {
              turnFiles.push(event.filePath)
              copilotTurnFiles.set(runId, turnFiles)
            }
            const existing = run.fileChanges.find((c) => c.filePath === event.filePath)
            if (!existing) {
              run.fileChanges.push(event.change)
            } else {
              existing.linesAdded += event.change.linesAdded
              existing.linesRemoved += event.change.linesRemoved
            }
            broadcast('foundry:copilot-event', { runId, event })
          } else if (event.type === 'done') {
            if (assistantText.trim()) {
              history.push({ role: 'assistant', content: assistantText })
              copilotHistory.set(runId, history)
            }
            broadcast('foundry:copilot-event', { runId, event })
          } else if (event.type === 'error') {
            broadcast('foundry:copilot-event', { runId, event })
          }
        }
      } catch (err) {
        broadcast('foundry:copilot-event', {
          runId,
          event: { type: 'error', message: String(err) },
        })
      }
    })()

    return { ok: true }
  })

  reg(api, 'foundry:copilot-revert-file', async (payload: unknown) => {
    const { runId, workspaceRoot, filePath } = payload as {
      runId: string
      workspaceRoot: string
      filePath: string
    }
    // Remove from run's fileChanges tracking
    const run = activeRuns.get(workspaceRoot)
    if (run && run.id === runId) {
      run.fileChanges = run.fileChanges.filter((c) => c.filePath !== filePath)
    }
    // Remove from turn tracking too
    if (runId) {
      const turnFiles = copilotTurnFiles.get(runId) ?? []
      copilotTurnFiles.set(
        runId,
        turnFiles.filter((f) => f !== filePath)
      )
    }
    return revertFiles(workspaceRoot, [filePath])
  })

  reg(api, 'foundry:copilot-accept-all', async (payload: unknown) => {
    const { runId, workspaceRoot } = (payload ?? {}) as { runId?: string; workspaceRoot?: string }
    // Clear turn-level file tracking (files stay on disk — acceptance means we keep them)
    if (runId) copilotTurnFiles.set(runId, [])
    const run = runId && workspaceRoot ? activeRuns.get(workspaceRoot) : null
    if (run && run.id === runId) run.fileChanges = []
    return { ok: true }
  })

  reg(api, 'foundry:copilot-abort', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    // Use server-tracked turn files (not client-provided) to avoid BUG-7
    const turnFiles = runId ? (copilotTurnFiles.get(runId) ?? []) : []
    if (turnFiles.length > 0) {
      await revertFiles(workspaceRoot, turnFiles)
    }
    if (runId) copilotTurnFiles.set(runId, [])
    const run = workspaceRoot ? activeRuns.get(workspaceRoot) : null
    if (run && run.id === runId) {
      // Remove turn-modified files from run.fileChanges
      run.fileChanges = run.fileChanges.filter((c) => !turnFiles.includes(c.filePath))
    }
    return { ok: true }
  })

  // ─── History ───────────────────────────────────────────────────────────────
  reg(api, 'foundry:history-load', async (payload: unknown) => {
    const {
      workspaceRoot,
      offset = 0,
      limit = 200,
    } = payload as { workspaceRoot: string; offset?: number; limit?: number }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    return readHistory(workspaceRoot, offset, limit)
  })

  reg(api, 'foundry:open-run-console', (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot?: string }
    if (!runId) return { error: 'runId required' }
    api.window.openAuxiliary('foundry-run', { runId, repoRoot: workspaceRoot ?? '' })
    return { ok: true }
  })

  reg(api, 'foundry:history-compare', async (payload: unknown) => {
    const { workspaceRoot, runIdA, runIdB } = payload as {
      workspaceRoot: string
      runIdA: string
      runIdB: string
    }
    const { entries } = await readHistory(workspaceRoot, 0, 10000)
    const runA = entries.find((e) => e.runId === runIdA)
    const runB = entries.find((e) => e.runId === runIdB)
    if (!runA) return { error: `Run ${runIdA} not found` }
    if (!runB) return { error: `Run ${runIdB} not found` }
    return { runA, runB }
  })

  // ─── File system watch for active run file-change detection ───────────────
  disposables.push(
    api.fs.watch((event) => {
      // Bail immediately when no runs are active — this fires on every file change
      // in the project (including Vite HMR artifacts) so must be extremely cheap.
      if (activeRuns.size === 0 || !event.filename) return
      for (const [workspaceRoot, run] of activeRuns) {
        if (run.status !== 'running') continue
        if (!event.projectRoot.startsWith(workspaceRoot)) continue
        const filePath = path.join(event.projectRoot, event.filename)
        const existing = run.fileChanges.find((c) => c.filePath === filePath)
        if (!existing) {
          run.fileChanges.push({
            filePath,
            status: 'modified',
            linesAdded: 0,
            linesRemoved: 0,
            unifiedDiff: '',
          })
          appendLog(run.id, 'file', `~ ${filePath.replace(workspaceRoot, '').replace(/^\//, '')}`)
        }
        broadcast('foundry:run-event', { runId: run.id, event: { type: 'file-changed', filePath } })
      }
    })
  )

  // ─── Terminal session close → reset co-pilot ──────────────────────────────
  if (api.terminal?.onSessionClose) {
    disposables.push(
      api.terminal.onSessionClose(() => {
        broadcast('foundry:copilot-reset', {})
      })
    )
  }

  // ─── Settings ──────────────────────────────────────────────────────────────
  disposables.push(
    api.settings.register({
      label: 'Foundry',
      properties: {
        'terminator.foundry.enabled': {
          type: 'boolean',
          label: 'Enable Foundry',
          default: true,
          workspaceScoped: false,
        },
        'terminator.foundry.defaultProviderId': {
          type: 'string',
          label: 'Default Provider ID',
          default: '',
          workspaceScoped: false,
        },
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
  activeRuns.clear()
  copilotHistory.clear()
  copilotTurnFiles.clear()
  resetHealthState()
}

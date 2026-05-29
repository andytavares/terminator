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
  createWorktree,
  removeWorktree,
  mergeWorktreeBranch,
} from './core/git.js'
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
    const session = {
      run,
      logs: runLogs.get(run.id) ?? [],
    }
    const tmp = path.join(dir, 'session.json.tmp')
    await fs.writeFile(tmp, JSON.stringify(session), 'utf-8')
    await fs.rename(tmp, path.join(dir, 'session.json'))
  } catch {
    // non-fatal — session just won't persist
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
  if (!run.worktreePath || !run.worktreeBranch) return
  const { worktreePath, worktreeBranch } = run
  void removeWorktree(workspaceRoot, worktreePath, worktreeBranch)
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
  agentsMdContent: string
): Promise<void> {
  // Skip AI planning if the user provided a manual DAG
  if (run.subAgents && run.subAgents.length > 0) {
    appendLog(
      run.id,
      'system',
      `Using manual flow: ${run.subAgents.length} agents — ${run.subAgents.map((a) => a.role).join(', ')}`
    )
    broadcastAndSave(run)
    // Jump straight to execution using stored parsedAgents-like data
    const manualAgents = run.subAgents.map((a) => ({
      id: a.agentId,
      role: a.role,
      task: a.role,
      dependsOn: a.dependsOn,
    }))
    const tiers = topoSort(run.subAgents)
    for (const tier of tiers) {
      if (activeRuns.get(workspaceRoot)?.id !== run.id) return
      await Promise.all(
        tier.map(async (agentId) => {
          const subAgent = run.subAgents!.find((a) => a.agentId === agentId)
          const agentData = manualAgents.find((a) => a.id === agentId)
          if (!subAgent || !agentData) return
          subAgent.status = 'running'
          broadcastAndSave(run)
          appendSubAgentLog(run.id, agentId, 'system', `${subAgent.role} — starting`)
          try {
            for await (const event of adapter.run({
              mode: 'spec-to-code',
              providerId: run.providerId,
              model: run.model,
              prompt: agentData.task,
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
        appendLog(run.id, 'sensor', `${r.pass ? '✓' : '✗'} ${r.sensorName}`)
        trackSensorResult(r.sensorName, r.pass, workspaceRoot)
      }
    }
    const anyRejected = run.subAgents.some((a) => a.status === 'rejected')
    run.status = anyRejected ? 'paused-error' : 'done'
    run.completedAt = new Date().toISOString()
    if (run.status === 'done') activeRuns.delete(workspaceRoot)
    appendLog(
      run.id,
      anyRejected ? 'error' : 'ok',
      anyRejected ? 'Flow completed with errors' : 'Flow complete'
    )
    broadcastAndSave(run)
    await appendHistoryEntry(workspaceRoot, {
      runId: run.id,
      mode: 'orchestrate',
      providerId: run.providerId,
      providerLabel: provider.id,
      model: run.model,
      promptSummary: (run.prompt ?? '').slice(0, 200),
      status: run.status,
      tokenCountIn: 0,
      tokenCountOut: 0,
      sensorSummary: run.sensorResults
        ? `${run.sensorResults.filter((r) => r.pass).length}/${run.sensorResults.length}`
        : '0/0',
      gateDecisions: [],
      filesChangedCount: run.fileChanges.length,
      durationMs: runDurationMs(run),
      createdAt: run.createdAt,
      completedAt: run.completedAt ?? new Date().toISOString(),
      subAgentRunIds: run.subAgents.map((a) => a.agentId),
    })
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

  // Map to SubAgent type and attach to run
  run.subAgents = parsedAgents.map((a) => ({
    agentId: a.id,
    role: a.role,
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
        subAgent.status = 'running'
        broadcastAndSave(run)

        const agentData = parsedAgents.find((a) => a.id === agentId)
        const agentTask = agentData?.task ?? subAgent.role

        appendSubAgentLog(run.id, agentId, 'system', `${subAgent.role} — starting`)
        try {
          for await (const event of adapter.run({
            mode: 'spec-to-code',
            providerId: run.providerId,
            model: run.model,
            prompt: agentTask,
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
          appendSubAgentLog(run.id, agentId, 'ok', `${subAgent.role} complete`)
        } catch (err) {
          subAgent.status = 'rejected'
          appendSubAgentLog(run.id, agentId, 'error', `failed: ${String(err)}`)
        }
        broadcastAndSave(run)
      })
    )
  }

  // All tiers done — run sensors and finish
  if (harness.sensors.length > 0) {
    appendLog(run.id, 'system', `Running ${harness.sensors.length} sensor(s)…`)
    const sensorResults = await runAllSensors(harness.sensors, runRoot)
    run.sensorResults = sensorResults
    for (const r of sensorResults) {
      appendLog(run.id, 'sensor', `${r.pass ? '✓' : '✗'} ${r.sensorName} (${r.durationMs}ms)`)
      trackSensorResult(r.sensorName, r.pass, workspaceRoot)
    }
  }

  const anyRejected = run.subAgents.some((a) => a.status === 'rejected')
  run.status = anyRejected ? 'paused-error' : 'done'
  run.completedAt = new Date().toISOString()
  if (run.status === 'done') activeRuns.delete(workspaceRoot)
  appendLog(
    run.id,
    anyRejected ? 'error' : 'ok',
    anyRejected
      ? 'Orchestration completed with errors'
      : `Orchestration complete — ${run.subAgents.length} agents done`
  )
  broadcastAndSave(run)

  await appendHistoryEntry(workspaceRoot, {
    runId: run.id,
    mode: 'orchestrate',
    providerId: run.providerId,
    providerLabel: provider.id,
    model: run.model,
    promptSummary: (run.prompt ?? '').slice(0, 200),
    status: run.status,
    tokenCountIn: 0,
    tokenCountOut: 0,
    sensorSummary: run.sensorResults
      ? `${run.sensorResults.filter((r) => r.pass).length}/${run.sensorResults.length}`
      : '0/0',
    gateDecisions: [],
    filesChangedCount: run.fileChanges.length,
    durationMs: run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
      : 0,
    createdAt: run.createdAt,
    completedAt: run.completedAt ?? new Date().toISOString(),
    subAgentRunIds: run.subAgents.map((a) => a.agentId),
  })
}

// ─── Run execution loop ──────────────────────────────────────────────────────

const SLUG_STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'it',
  'as',
  'be',
  'do',
  'if',
])

function slugifyPrompt(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !SLUG_STOP.has(w))
      .slice(0, 5)
      .join('-')
      .replace(/-+/g, '-')
      .slice(0, 50) || 'run'
  )
}

async function executeRun(run: Run, harness: Harness): Promise<void> {
  const workspaceRoot = run.workspaceRoot
  const providers = await readProviders(workspaceRoot)
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

  // Derive a human-readable label from the spec filename or prompt text
  const worktreeLabel = slugifyPrompt(
    run.specPath
      ?.split('/')
      .pop()
      ?.replace(/\.\w+$/, '') ??
      run.prompt ??
      ''
  )

  // Create an isolated git worktree so the run doesn't pollute the working tree
  const worktreeResult = await createWorktree(workspaceRoot, run.id, worktreeLabel)
  if ('error' in worktreeResult) {
    appendLog(
      run.id,
      'error',
      `Could not create worktree: ${worktreeResult.error} — running in main workspace instead`
    )
  } else {
    run.worktreePath = worktreeResult.worktreePath
    run.worktreeBranch = worktreeResult.branch
    appendLog(
      run.id,
      'system',
      `Worktree: .worktrees/${worktreeResult.label}  (branch: ${worktreeResult.branch})`
    )
    broadcast('foundry:worktree-created', {
      runId: run.id,
      workspaceRoot,
      worktreePath: worktreeResult.worktreePath,
      branch: worktreeResult.branch,
      label: worktreeResult.label,
    })
  }

  // The agent operates in the worktree (or workspace if worktree failed)
  const runRoot = run.worktreePath ?? workspaceRoot

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

  // ─── Orchestrate mode: plan then execute tiers ──────────────────────────────
  if (run.mode === 'orchestrate') {
    await executeOrchestrate(
      run,
      harness,
      adapter,
      provider,
      workspaceRoot,
      runRoot,
      agentsMdContent
    )
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
      prompt: run.prompt ?? '',
      workspaceRoot: runRoot,
      agentsMdContent,
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
      appendLog(run.id, 'system', `Running ${harness.sensors.length} sensor(s)…`)
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
      // Auto-approve: merge worktree changes back and clean up
      if (run.worktreePath && run.worktreeBranch) {
        appendLog(run.id, 'system', 'Merging changes back to workspace…')
        const mergeResult = await mergeWorktreeBranch(workspaceRoot, run.worktreeBranch)
        if ('error' in mergeResult) {
          appendLog(
            run.id,
            'system',
            `Merge note: ${mergeResult.error} — changes remain on branch ${run.worktreeBranch}`
          )
        }
        cleanupWorktree(run, workspaceRoot)
      }
      appendLog(run.id, 'ok', 'Run complete (auto-approved — no gate required)')
      run.status = 'done'
      run.completedAt = new Date().toISOString()
      activeRuns.delete(workspaceRoot)
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

  reg(api, 'foundry:provider-list', async (payload: unknown) => {
    const { workspaceRoot } = payload as { workspaceRoot: string }
    if (!workspaceRoot) return { providers: [] }
    const providers = await readProviders(workspaceRoot)
    return { providers }
  })

  reg(api, 'foundry:provider-save', async (payload: unknown) => {
    const { provider, apiKey, workspaceRoot } = payload as {
      provider: StoredProvider
      apiKey?: string
      workspaceRoot: string
    }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    if (!keychainAvailable() && apiKey) {
      return { error: 'OS encryption unavailable — cannot store API key securely' }
    }
    if (apiKey && provider.keychainKey) {
      await storeKey(provider.keychainKey, apiKey)
    }
    const providers = await readProviders(workspaceRoot)
    const idx = providers.findIndex((p) => p.id === provider.id)
    if (idx >= 0) providers[idx] = provider
    else providers.push(provider)
    await writeProviders(workspaceRoot, providers)
    return { provider }
  })

  reg(api, 'foundry:provider-delete', async (payload: unknown) => {
    const { providerId, workspaceRoot } = payload as { providerId: string; workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    const providers = await readProviders(workspaceRoot)
    const idx = providers.findIndex((p) => p.id === providerId)
    if (idx >= 0) {
      const p = providers[idx]
      if (p.keychainKey) await deleteKey(p.keychainKey)
      providers.splice(idx, 1)
      await writeProviders(workspaceRoot, providers)
    }
    return { ok: true }
  })

  reg(api, 'foundry:provider-test', async (payload: unknown) => {
    const { providerId, workspaceRoot } = payload as { providerId: string; workspaceRoot: string }
    if (!workspaceRoot) return { error: 'workspaceRoot required' }
    const providers = await readProviders(workspaceRoot)
    const provider = providers.find((p) => p.id === providerId)
    if (!provider) return { error: 'Provider not found' }
    const adapter = buildAdapter(provider, workspaceRoot)
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
    const { workspaceRoot, mode, providerId, model, specPath, prompt, iterationLimit, manualDag } =
      payload as {
        workspaceRoot: string
        mode: string
        providerId: string
        model: string
        specPath?: string
        prompt?: string
        iterationLimit?: number
        manualDag?: Array<{ id: string; role: string; task: string; dependsOn: string[] }>
      }
    if (!workspaceRoot || !mode || !providerId || !model)
      return { error: 'workspaceRoot, mode, providerId, model required' }

    const existing = activeRuns.get(workspaceRoot)
    if (existing && (existing.status === 'running' || existing.status === 'gate')) {
      return { error: 'A run is already active in this workspace' }
    }

    const harnessResult = await readHarness(workspaceRoot)
    if ('error' in harnessResult) return { error: `Cannot read harness: ${harnessResult.error}` }
    if ('notFound' in harnessResult) return { error: 'Harness not configured. Run setup first.' }

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
    }

    // Pre-populate subAgents if the user provided a manual DAG
    if (mode === 'orchestrate' && manualDag && manualDag.length > 0) {
      run.subAgents = manualDag.map((a) => ({
        agentId: a.id,
        role: a.role,
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
        `Gate decision: reject — reverting ${run.fileChanges.length} file(s)`
      )
      const filePaths = run.fileChanges.map((c) => c.filePath)
      if (filePaths.length > 0) await revertFiles(workspaceRoot, filePaths)
      run.status = 'rejected'
      run.completedAt = new Date().toISOString()
      activeRuns.delete(workspaceRoot)
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
      })
      broadcastAndSave(run)
      return { run }
    }

    if (decision === 'approve') {
      appendLog(run.id, 'ok', 'Gate approved — merging changes to workspace…')
      if (run.worktreePath && run.worktreeBranch) {
        const mergeResult = await mergeWorktreeBranch(workspaceRoot, run.worktreeBranch)
        if ('error' in mergeResult) {
          appendLog(
            run.id,
            'system',
            `Merge note: ${mergeResult.error} — changes remain on branch ${run.worktreeBranch}`
          )
        } else {
          appendLog(run.id, 'ok', 'Changes merged into workspace')
        }
        cleanupWorktree(run, workspaceRoot)
      }
      run.status = 'done'
      run.completedAt = new Date().toISOString()
      activeRuns.delete(workspaceRoot)
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

  reg(api, 'foundry:run-abort', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    const run = activeRuns.get(workspaceRoot)
    if (!run || run.id !== runId) return { error: 'Run not found' }
    appendLog(run.id, 'system', 'Run aborted — discarding worktree')
    if (run.worktreePath && run.worktreeBranch) {
      // Worktree is isolated — just remove it; main workspace is untouched
      cleanupWorktree(run, workspaceRoot)
    } else {
      // Fallback: revert files in the main workspace
      const filePaths = run.fileChanges.map((c) => c.filePath)
      if (filePaths.length > 0) await revertFiles(workspaceRoot, filePaths)
    }
    run.status = 'aborted'
    run.completedAt = new Date().toISOString()
    activeRuns.delete(workspaceRoot)
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
    })
    broadcastAndSave(run)
    return { ok: true }
  })

  reg(api, 'foundry:run-dismiss', async (payload: unknown) => {
    const { runId, workspaceRoot } = payload as { runId: string; workspaceRoot: string }
    // Active run: abort if still running, then remove from memory
    const activeRun = activeRuns.get(workspaceRoot)
    if (activeRun && activeRun.id === runId) {
      const finalStatus =
        activeRun.status === 'done' || activeRun.status === 'rejected'
          ? activeRun.status
          : 'aborted'
      activeRun.status = finalStatus
      activeRun.completedAt = activeRun.completedAt ?? new Date().toISOString()
      // Clean up associated git worktree if one was created
      cleanupWorktree(activeRun, workspaceRoot)
      activeRuns.delete(workspaceRoot)
      runLogs.delete(runId)
      subAgentLogs.delete(runId)
      void clearSession(workspaceRoot)
      broadcast('foundry:run-status-changed', { runId, status: finalStatus })
    } else {
      // Historical run — the session file may have a worktreePath; try cleaning it up
      const session = await loadSession(workspaceRoot).catch(() => null)
      if (session?.run.id === runId && session.run.worktreePath && session.run.worktreeBranch) {
        cleanupWorktree(session.run, workspaceRoot)
      }
      void clearSession(workspaceRoot)
    }
    // Remove from history file regardless (works for both active and historical runs)
    await deleteHistoryEntry(workspaceRoot, runId)
    return { ok: true }
  })

  reg(api, 'foundry:run-logs', (payload: unknown) => {
    const { runId } = payload as { runId: string }
    const entries = runLogs.get(runId) ?? []
    return { entries }
  })

  reg(api, 'foundry:subagent-logs', (payload: unknown) => {
    const { runId, agentId } = payload as { runId: string; agentId: string }
    const entries = subAgentLogs.get(runId)?.get(agentId) ?? []
    return { entries }
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

    // Restore a persisted session if the app restarted with an active run in progress
    if (!activeRuns.has(workspaceRoot)) {
      const session = await loadSession(workspaceRoot)
      if (session) {
        const { run, logs } = session
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
          // Re-save with the potentially updated status
          void saveSession(workspaceRoot, run)
        } else {
          // Terminal status persisted — clean it up
          void clearSession(workspaceRoot)
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
    const providers = await readProviders(workspaceRoot)
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

    const providers = await readProviders(workspaceRoot)
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

#!/usr/bin/env node
// Which of the app's features the e2e suite drives, from evidence rather than
// from reading the specs: the IPC each spec caused in the real app
// (tests/e2e/ipc-trace.ts) joined with what the running app offers
// (tests/e2e/tools/feature-inventory.spec.ts). Writes the Markdown body of
// docs/research/feature-coverage.md.
//
//   node scripts/feature-coverage.mjs <inventory.json> <trace directory>
//
// A feature is "driven" when some spec caused its IPC: a channel invoked or
// sent, an event pushed, a command run through extension:execute-command or
// extension:run-command, a setting written through settings:update-global or
// extension:update-setting, a Quick Action recorded in quickActions.usage or
// quickActions.directUse. Driven is not asserted: a spec that opens a view
// drives every channel the view loads with, whether or not it checks them.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Each spec's trace as [kind, channel, payload] entries. */
export function readTraces(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({
      spec: basename(name, '.jsonl'),
      entries: readFileSync(join(directory, name), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    }))
}

/** The core bridge methods, by channel, from the manifest's method() blocks. */
export function coreChannels(manifestSource) {
  return manifestSource
    .split('method({')
    .slice(1)
    .map((block) => ({
      path: block.match(/path: '([^']+)'/)?.[1],
      kind: block.match(/kind: '([^']+)'/)?.[1],
      channel: block.match(/channel: '([^']+)'/)?.[1],
    }))
    .filter((method) => method.channel)
}

/** Every leaf path a settings patch writes, e.g. `appearance.theme`. */
export function patchPaths(patch, prefix = '') {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return [prefix]
  return Object.entries(patch).flatMap(([key, value]) =>
    patchPaths(value, prefix ? `${prefix}.${key}` : key)
  )
}

/** Adds `spec` to the set of specs that drove `key`. */
function drove(map, key, spec) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(spec)
}

/** What the traces show each spec drove, by kind of feature. */
export function drivenFeatures(traces) {
  const driven = {
    channels: new Map(),
    events: new Map(),
    commands: new Map(),
    globalSettings: new Map(),
    extensionSettings: new Map(),
    quickActions: new Map(),
  }
  for (const { spec, entries } of traces) {
    for (const [kind, channel, payload] of entries) {
      drove(kind === 'event' ? driven.events : driven.channels, channel, spec)
      if (channel === 'extension:execute-command' || channel === 'extension:run-command') {
        if (payload?.key) drove(driven.commands, payload.key, spec)
      }
      if (channel === 'extension:update-setting' && payload?.key) {
        drove(driven.extensionSettings, payload.key, spec)
      }
      if (channel === 'settings:update-global' && payload?.patch) {
        for (const path of patchPaths(payload.patch)) drove(driven.globalSettings, path, spec)
        for (const list of ['usage', 'directUse']) {
          for (const { id } of payload.patch.quickActions?.[list] ?? []) {
            drove(driven.quickActions, id, spec)
          }
        }
      }
    }
  }
  return driven
}

/** The extension whose built backend or view names `channel`, or null for core. */
function channelOwner(bundles, channel) {
  const owners = bundles.filter(({ source }) => source.includes(`"${channel}"`)).map((b) => b.id)
  return owners.length === 1 ? owners[0] : owners.length > 1 ? owners.join(', ') : null
}

function extensionBundles(extensionIds) {
  return readdirSync(join(REPO_ROOT, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(REPO_ROOT, 'extensions', entry.name))
    .filter((directory) => existsSync(join(directory, 'manifest.json')))
    .map((directory) => {
      const { id } = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
      const backend = join(directory, 'src', 'index.js')
      const source = existsSync(backend) ? readFileSync(backend, 'utf8') : ''
      return { id, source }
    })
    .filter(({ id }) => extensionIds.includes(id))
}

const CORE_QUICK_ACTION_TEMPLATES = [
  // Built per workspace and per session; recorded by their stable action id.
  { id: 'core.switch-workspace', note: 'one per workspace' },
  { id: 'session:*', note: 'one per session' },
]

function coreQuickActions() {
  const source = readFileSync(join(REPO_ROOT, 'src/renderer/quick-actions/core-actions.ts'), 'utf8')
  const fixed = [...source.matchAll(/id: '(core\.[^']+)'/g)].map((match) => match[1])
  return [...new Set(fixed)].sort().map((id) => ({ id }))
}

const specList = (specs) => (specs ? [...specs].sort().join(', ') : '')

function table(rows, columns) {
  const header = `| ${columns.map((c) => c.title).join(' | ')} |`
  const rule = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${columns.map((c) => c.value(row)).join(' | ')} |`)
  return [header, rule, ...body].join('\n')
}

function section(title, items, specsOf, describe) {
  const driven = items.filter((item) => specsOf(item))
  const lines = [`### ${title}: ${driven.length} of ${items.length} driven`, '']
  const undriven = items.filter((item) => !specsOf(item))
  if (undriven.length > 0) {
    lines.push('Not driven by any spec:', '', ...undriven.map((item) => `- ${describe(item)}`), '')
  }
  if (driven.length > 0) {
    lines.push(
      '<details><summary>Driven, and by which specs</summary>',
      '',
      ...driven.map((item) => `- ${describe(item)}: ${specList(specsOf(item))}`),
      '',
      '</details>',
      ''
    )
  }
  return { lines, driven: driven.length, total: items.length }
}

export function coverageReport(inventory, traces) {
  const driven = drivenFeatures(traces)
  const manifest = coreChannels(
    readFileSync(join(REPO_ROOT, 'src/shared/electron-api/manifest.ts'), 'utf8')
  )
  const coreByChannel = new Map(manifest.map((method) => [method.channel, method]))
  const bundles = extensionBundles(inventory.extensions)
  const handled = [...new Set([...inventory.channels.invoke, ...inventory.channels.send])]

  // Core: every manifest method, events included; extension: every channel the
  // running app handles that no manifest method declares and one extension names.
  const coreItems = manifest.map((method) => ({
    name: method.channel,
    detail: `${method.path} (${method.kind})`,
    events: method.kind === 'event',
  }))
  const byExtension = new Map(inventory.extensions.map((id) => [id, []]))
  const unowned = []
  for (const channel of handled.filter((c) => !coreByChannel.has(c)).sort()) {
    const owner = channelOwner(bundles, channel)
    if (owner && byExtension.has(owner)) byExtension.get(owner).push({ name: channel })
    else unowned.push(channel)
  }
  const channelSpecs = (item) => (item.events ? driven.events : driven.channels).get(item.name)

  const sections = [
    {
      area: 'Core IPC (window.electronAPI)',
      ...section('Core IPC', coreItems, channelSpecs, (i) => `\`${i.name}\` — ${i.detail}`),
    },
    ...[...byExtension].map(([id, items]) => ({
      area: `${id} IPC`,
      ...section(`${id} IPC`, items, channelSpecs, (i) => `\`${i.name}\``),
    })),
    {
      area: 'Commands (Quick Actions, menus)',
      ...section(
        'Extension commands',
        inventory.commands,
        (c) => driven.commands.get(c.key),
        (c) => `\`${c.key}\` — ${c.label}`
      ),
    },
    {
      area: 'Core Quick Actions',
      ...section(
        'Core Quick Actions',
        [...coreQuickActions(), ...CORE_QUICK_ACTION_TEMPLATES],
        (a) =>
          a.id === 'session:*'
            ? new Set(
                [...driven.quickActions]
                  .filter(([id]) => id.startsWith('session:'))
                  .flatMap(([, specs]) => [...specs])
              )
            : driven.quickActions.get(a.id),
        (a) => `\`${a.id}\`${a.note ? ` (${a.note})` : ''}`
      ),
    },
    {
      area: 'Extension settings',
      ...section(
        'Extension settings',
        inventory.settings,
        (s) => driven.extensionSettings.get(s.key),
        (s) => `\`${s.key}\` — ${s.label}`
      ),
    },
  ]
  // A section with nothing driven still reports its total, so the summary has it.
  for (const s of sections) if (s.total === 0) s.lines = [`### ${s.area}: none registered`, '']

  const summary = table(sections, [
    { title: 'Area', value: (s) => s.area },
    { title: 'Driven', value: (s) => String(s.driven) },
    { title: 'Total', value: (s) => String(s.total) },
    {
      title: 'Share',
      value: (s) => (s.total ? `${Math.round((100 * s.driven) / s.total)}%` : '—'),
    },
  ])
  const globalSettings = [...driven.globalSettings]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, specs]) => `- \`${path}\`: ${specList(specs)}`)

  return [
    summary,
    '',
    ...sections.flatMap((s) => s.lines),
    '### Global settings written by a spec',
    '',
    ...(globalSettings.length ? globalSettings : ['None.']),
    '',
    '### Channels the app handles that no manifest method or single extension names',
    '',
    'Electron internals and core channels outside the bridge manifest; not counted above.',
    '',
    ...unowned.map(
      (c) =>
        `- \`${c}\`${driven.channels.has(c) ? ` (driven: ${specList(driven.channels.get(c))})` : ''}`
    ),
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inventoryPath, traceDirectory] = process.argv.slice(2)
  if (!inventoryPath || !traceDirectory) {
    throw new Error('usage: feature-coverage.mjs <inventory.json> <trace directory>')
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  process.stdout.write(coverageReport(inventory, readTraces(traceDirectory)))
}

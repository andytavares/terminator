import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as path from 'node:path'

import type { ResolveSources } from './recipe/resolve.js'
import { resolveDataRoot, untrackedNotice } from './data-root.js'
import { fallbackRecordsBase } from './storage-folder.js'
import type { ActivationContext } from './ipc/register.js'

// Tell the operator once that the default records location is untracked. Best effort:
// no notification surface or settings answer may stop the extension loading. With no workspace
// open the records are in Foundry's own folder, inside no repository: nothing to say yet.
export function noteUntrackedDataRoot(api: ExtensionAPI, root: string): void {
  try {
    if (path.dirname(root) === fallbackRecordsBase(api)) return
    const configured = api.settings?.get<string>('terminator.foundry.dataDir') ?? ''
    const notice = untrackedNotice({ root, usingDefault: configured.trim() === '' })
    if (notice === null) return
    if (api.settings?.get<boolean>('terminator.foundry.untrackedNoticeSeen') === true) return
    api.notifications?.showToast('info', notice, 'untrackedDataRoot')
    api.settings?.set('terminator.foundry.untrackedNoticeSeen', true)
  } catch {
    // Nothing here is worth failing activation for.
  }
}

/** `resolveSources` read afresh each call: which repositories are open changes. */
export function sourcesOf({ api, dataRoot }: ActivationContext): () => ResolveSources {
  return () => resolveSources(api, dataRoot())
}

export function resolveSources(api: ExtensionAPI, root: string): ResolveSources {
  return {
    dataRoot: root,
    repoPaths: (api.workspace?.list() ?? []).map((workspace) => workspace.folderPath),
    // The built-ins ship inside the extension, so they are available in a
    // repository that contains nothing of Foundry's.
    builtInDir: path.resolve(__dirname, '..'),
  }
}

// Where Foundry keeps its records, resolved per read: activation runs before any
// workspace exists. Still one resolver (`data-root.ts`), memoised on its inputs so
// polling does not recompute and the untracked notice matches the writers.
const dataRootMemo = new Map<string, string>()

export function resolveFoundryDataRoot(api: ExtensionAPI): string {
  const { configured, workdir } = configuredLocation(api)
  const key = `${configured}\u0000${workdir ?? ''}`
  const memo = dataRootMemo.get(key)
  if (memo !== undefined) return memo

  const root = rootUnder(configured, workdir ?? fallbackRecordsBase(api))
  dataRootMemo.set(key, root)
  return root
}

// The configured data directory and the first workspace folder. Every read is optional:
// a host with no workspace yet is normal, and activation must not throw.
function configuredLocation(api: ExtensionAPI): { configured: string; workdir: string | null } {
  let configured = ''
  try {
    configured = api.settings?.get<string>('terminator.foundry.dataDir') ?? ''
    return { configured, workdir: api.workspace?.list()[0]?.folderPath ?? null }
  } catch {
    return { configured, workdir: null }
  }
}

// The records root for `configured` over `base`. A relative path throws, ambiguous for
// orders spanning repositories, so it falls back to the default rather than fail.
function rootUnder(configured: string, base: string): string {
  try {
    return resolveDataRoot(configured, base).root
  } catch {
    return resolveDataRoot('', base).root
  }
}

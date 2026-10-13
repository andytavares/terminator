import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as path from 'node:path'

import type { ResolveSources } from './recipe/resolve.js'
import { resolveDataRoot, untrackedNotice } from './data-root.js'
import { fallbackRecordsBase } from './storage-folder.js'

/** Where the chosen model lives, on the side of the bridge that launches runs. */
/**
 * Where Foundry keeps its records, resolved once at activation.
 *
 * Empty means beside the working directory, which leaves an untracked
 * directory behind — Foundry says so once and never edits a `.gitignore`,
 * because that would be writing into a repository the order did not ask to
 * change. A configured absolute path takes every order, which is the only
 * workable answer once an order spans repositories.
 */
/**
 * Tell the operator once that the default records location is untracked.
 *
 * Best-effort in every direction: a host with no notification surface, or a
 * settings store that will not answer, must not stop the extension loading.
 */
export function noteUntrackedDataRoot(api: ExtensionAPI, root: string): void {
  try {
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

/**
 * Where the records go when there is no workspace to be beside.
 *
 * Never `process.cwd()`. The extension host's working directory is wherever
 * the application was launched from — in development, the Terminator
 * repository itself — so defaulting to it writes one workspace's orders into
 * another repository's working tree. That happened, and the evidence was a
 * `.foundry/` directory in this repository with twelve orders in it from four
 * different fixtures.
 */
/**
 * The three rungs a recipe, role or rule is looked up in.
 *
 * Built on every read rather than captured at activation: which repositories
 * are open — and therefore which `.foundry/` directories are honoured — is not
 * known when the host loads the extension.
 */
export function resolveSources(api: ExtensionAPI, root: string): ResolveSources {
  return {
    dataRoot: root,
    repoPaths: (api.workspace?.list() ?? []).map((workspace) => workspace.folderPath),
    // The built-ins ship inside the extension, so they are available in a
    // repository that contains nothing of Foundry's.
    builtInDir: path.resolve(__dirname, '..'),
  }
}

/**
 * Where Foundry keeps its records.
 *
 * Resolved from the setting and the current workspace on each read rather than
 * once at activation, because activation runs before a workspace exists: the
 * host calls it synchronously at load, and `api.workspace.list()` is empty
 * until the operator opens something. Resolving once there pinned every order
 * to the fallback for the life of the process.
 *
 * Still one resolver in one place — `data-root.ts` — and every writer still
 * receives an absolute path it never resolves again. Memoised on the inputs so
 * a surface polling a channel is not recomputing a path, and so the untracked
 * notice is decided from the same answer the writers use.
 */
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

/**
 * The configured data directory and the first workspace folder.
 *
 * Every read here is optional. Activation is called synchronously by the host
 * and must not throw because one capability is absent — a host that has no
 * workspace yet is a normal state, not a reason to fail to load.
 */
function configuredLocation(api: ExtensionAPI): { configured: string; workdir: string | null } {
  let configured = ''
  try {
    configured = api.settings?.get<string>('terminator.foundry.dataDir') ?? ''
    return { configured, workdir: api.workspace?.list()[0]?.folderPath ?? null }
  } catch {
    return { configured, workdir: null }
  }
}

/**
 * The records root for `configured` over `base`. A relative path was
 * configured when that throws, which is ambiguous once an order spans
 * repositories, so it falls back to the default rather than refusing to
 * activate.
 */
function rootUnder(configured: string, base: string): string {
  try {
    return resolveDataRoot(configured, base).root
  } catch {
    return resolveDataRoot('', base).root
  }
}

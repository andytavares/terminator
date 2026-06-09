/**
 * Shared vault path singleton used by all IPC modules.
 * Previously each module had its own duplicate let/set/get triple.
 */

let _vaultPath = ''

export function setVaultPath(p: string): void {
  _vaultPath = p
}

export function getVaultPath(): string {
  return _vaultPath
}

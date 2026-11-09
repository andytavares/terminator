// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { droppedPaths } from '../../../../src/components/terminal/dropped-paths'
import { installElectronApi } from '../../../../../test-support/src/electron-api'

// Electron 32+ dropped File.path; the preload's getFilePath is what knows it.
const filePaths = new WeakMap<File, string>()
function filesAt(paths: string[]): FileList {
  const files = paths.map((path) => {
    const file = new File([], path.slice(path.lastIndexOf('/') + 1))
    filePaths.set(file, path)
    return file
  })
  return files as unknown as FileList
}

beforeEach(() => {
  installElectronApi({
    getFilePath: (file: File) => filePaths.get(file) ?? '',
    usage: { recordUse: async () => ({ data: true as const }) },
  })
})

describe('droppedPaths', () => {
  it.each([
    { paths: ['/Users/me/my file.png'], typed: "'/Users/me/my file.png'" },
    { paths: ['/a.txt', '/b.txt'], typed: '/a.txt /b.txt' },
  ])('types $paths as $typed', ({ paths, typed }) => {
    expect(droppedPaths(filesAt(paths))).toBe(typed)
  })
})

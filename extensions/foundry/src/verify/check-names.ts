// The checks a work order can require. Kept apart from the toolchain probe,
// which reads the disk, so the renderer can name them without bundling node:fs.
export const CHECK_NAMES = ['test', 'lint', 'format', 'coverage', 'e2e', 'build'] as const

export type CheckName = (typeof CHECK_NAMES)[number]

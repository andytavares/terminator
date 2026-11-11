import { describe, it, expect } from 'vitest'
import { buildChapters } from '../../src/github/pr-review-service'

const f = (path: string) => ({ path, additions: 10, deletions: 2, status: 'modified' })

const chapterPaths = (chapters: ReturnType<typeof buildChapters>) =>
  chapters.map((c) => [c.name, c.files.map((file) => file.path)])

describe('buildChapters()', () => {
  it('returns no chapters for no files', () => {
    expect(buildChapters([])).toEqual([])
  })

  it('makes one chapter per directory that holds three or more changed files', () => {
    const chapters = buildChapters([
      f('cmd/server/main.go'),
      f('cmd/server/routes.go'),
      f('cmd/server/config.go'),
      f('app/models/user.rb'),
      f('app/models/post.rb'),
      f('app/models/comment.rb'),
    ])
    expect(chapterPaths(chapters)).toEqual([
      ['app/models', ['app/models/comment.rb', 'app/models/post.rb', 'app/models/user.rb']],
      ['cmd/server', ['cmd/server/config.go', 'cmd/server/main.go', 'cmd/server/routes.go']],
    ])
  })
})

describe('buildChapters() merges small directories upward', () => {
  it('merges directories of fewer than three files into their nearest ancestor directory', () => {
    const chapters = buildChapters([
      f('internal/auth/token.go'),
      f('internal/auth/session.go'),
      f('internal/db/conn.go'),
    ])
    expect(chapterPaths(chapters)).toEqual([
      ['internal', ['internal/auth/session.go', 'internal/auth/token.go', 'internal/db/conn.go']],
    ])
  })

  it('puts files whose directories never reach three files in one Root chapter', () => {
    const chapters = buildChapters([f('src/lib/foo.rs'), f('app/models/user.rb'), f('README.md')])
    expect(chapterPaths(chapters)).toEqual([
      ['Root', ['README.md', 'app/models/user.rb', 'src/lib/foo.rs']],
    ])
  })
})

describe('buildChapters() has no file-name rules', () => {
  it('keeps test, type and lock files in their directory chapter', () => {
    const chapters = buildChapters([
      f('src/auth.ts'),
      f('src/auth.spec.ts'),
      f('src/auth.types.ts'),
      f('package-lock.json'),
    ])
    expect(chapterPaths(chapters)).toEqual([
      ['Root', ['package-lock.json']],
      ['src', ['src/auth.spec.ts', 'src/auth.ts', 'src/auth.types.ts']],
    ])
  })

  it('applies a saved file order to the chapter it names', () => {
    const chapters = buildChapters([f('src/types.ts'), f('src/service.ts'), f('src/utils.ts')], {
      'chapter:src': ['src/utils.ts', 'src/service.ts', 'src/types.ts'],
    })
    expect(chapters[0].files.map((file) => file.path)).toEqual([
      'src/utils.ts',
      'src/service.ts',
      'src/types.ts',
    ])
  })
})

describe('buildChapters() chapter ids', () => {
  it('gives distinct ids to directories whose names differ only in punctuation, and to a "root" folder', () => {
    const files = ['src/a-b', 'src/a_b', 'root'].flatMap((dir) =>
      ['x.go', 'y.go', 'z.go'].map((name) => f(`${dir}/${name}`))
    )
    const ids = buildChapters([...files, f('README.md')]).map((c) => c.id)
    expect(new Set(ids).size).toBe(4)
  })
})

describe('buildChapters() hunk counts', () => {
  it('counts the hunks of each patch that change more than formatting', () => {
    const patch = ['@@ -1,1 +1,1 @@', '-a', '+b', '@@ -9,1 +9,1 @@', '-  c', '+c'].join('\n')
    const [chapter] = buildChapters([{ ...f('main.go'), patch }])
    expect(chapter.files[0].hunkCount).toBe(1)
  })
})

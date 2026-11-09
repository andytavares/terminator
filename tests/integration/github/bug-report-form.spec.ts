import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { ATTACHMENT_EXTENSIONS, newIssueUrl } from '../../../packages/core-shared/src/bug-report'

// The browser path of a bug report (ADR 156) fills this form through URL parameters named after
// its field ids. A renamed field would arrive empty, with nothing failing, so this pins them.

interface FormField {
  type: string
  id?: string
  validations?: { accept?: string }
}

const FORM_FILE = join(__dirname, '../../../.github/ISSUE_TEMPLATE/bug_report.yml')
const form = load(readFileSync(FORM_FILE, 'utf8')) as { labels: string[]; body: FormField[] }

describe('the bug report issue form', () => {
  it('has a field for every report value the link fills in', () => {
    const url = new URL(newIssueUrl({ title: 't', description: 'd', origin: 'o', details: 'a' }))
    const filled = [...url.searchParams.keys()].filter(
      (key) => !['template', 'title'].includes(key)
    )
    const ids = form.body.map((field) => field.id)

    expect(filled.filter((key) => !ids.includes(key))).toEqual([])
  })

  it('takes uploads of the file types the app attaches, for the files it shows in Finder', () => {
    const upload = form.body.find((field) => field.type === 'upload')
    const accepted = upload?.validations?.accept?.split(',').map((ext) => ext.slice(1))

    expect(accepted).toEqual([...ATTACHMENT_EXTENSIONS])
  })

  it('labels the issue a bug', () => {
    expect(form.labels).toEqual(['bug'])
  })
})

import type React from 'react'
import { recordUsage } from '@terminator/extension-sdk/renderer'

/** The tags with `raw` added as a tag (lower case, spaces as dashes), unless blank or present. */
export function withTag(tags: string[], raw: string): string[] {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-')
  return tag && !tags.includes(tag) ? [...tags, tag] : tags
}

/** A tag list and the tag being typed into it. */
export interface TagField {
  tags: string[]
  updateTags: (change: (tags: string[]) => string[]) => void
  tagInput: string
  setTagInput: (value: string) => void
}

/** Enter or comma adds the typed tag; Backspace on an empty input removes the last one. */
export function tagEditing(field: TagField) {
  const { tags, updateTags, tagInput, setTagInput } = field
  function addTag(raw: string) {
    if (raw.trim()) recordUsage('tag')
    updateTags((prev) => withTag(prev, raw))
    setTagInput('')
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      updateTags((prev) => prev.slice(0, -1))
    }
  }
  return { addTag, handleTagKeyDown }
}

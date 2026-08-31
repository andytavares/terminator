import React, { useMemo } from 'react'
import { PanelRightClose } from 'lucide-react'
import { useEditorStore } from '../stores/editor.store'
import { parseOutline } from '../editor/outline'

interface NoteOutlineProps {
  /** Called with the heading's document offset when one is clicked. */
  onSelect: (pos: number) => void
  /** Dismisses the panel. Whoever owns that state also owns the way back in. */
  onClose: () => void
}

/**
 * The open note's headings, nested by level, in the right rail.
 *
 * Depth is relative to the note's shallowest heading rather than absolute, so a
 * note whose top level is `##` — which is most of them, since the title is
 * usually the first `#` and often omitted — does not open with every entry
 * indented past the panel edge.
 */
export function NoteOutline({ onSelect, onClose }: NoteOutlineProps): React.JSX.Element {
  const bodyDraft = useEditorStore((s) => s.bodyDraft)
  const headings = useMemo(() => parseOutline(bodyDraft), [bodyDraft])
  const topLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1

  return (
    <div className="notepad-outline">
      <div className="notepad-outline__header">
        <span className="notepad-outline__title">Outline</span>
        <span className="notepad-outline__count">{headings.length}</span>
        <button className="notepad-outline__close" aria-label="Close outline" onClick={onClose}>
          <PanelRightClose />
        </button>
      </div>

      {headings.length === 0 ? (
        <div className="notepad-outline__empty">No headings yet</div>
      ) : (
        <div className="notepad-outline__items">
          {headings.map((heading) => (
            <button
              key={heading.from}
              className="notepad-outline__item"
              style={{ ['--outline-depth' as string]: heading.level - topLevel }}
              title={heading.text}
              onClick={() => onSelect(heading.from)}
            >
              {heading.text}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

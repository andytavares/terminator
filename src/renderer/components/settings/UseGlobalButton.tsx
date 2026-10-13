import React from 'react'

/** Hands a workspace's own value back to the global one. */
export function UseGlobalButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button className="settings-section__btn-link" onClick={onClick}>
      Use global default
    </button>
  )
}

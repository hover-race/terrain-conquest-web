// Include descendants such as button icons and shortcut labels.
export function isUiEvent(event) {
  return !!event.target?.closest?.(
    'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], #game-hud, #delivery-hud, #conquest-hud, #dispatch-screen, .dg'
  )
}

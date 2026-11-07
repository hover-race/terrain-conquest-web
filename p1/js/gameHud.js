import { assetPath } from './util.js'

export function createGameHud({ onDropTrailer, onSwitchCamera, hitchCoupler, getHitchCoupler }) {
  const root = document.createElement('div')
  root.id = 'game-hud'

  root.innerHTML = `
    <div class="hud-trailer-status" role="status" aria-live="polite" aria-atomic="true">
      <strong data-trailer-label></strong>
    </div>
    <button type="button" class="hud-btn hud-btn-shortcut" id="hud-drop-trailer" title="Drop trailer (T)" aria-label="Drop trailer" aria-keyshortcuts="T">
      <img src="${assetPath('/assets/img/icon-drop-trailer.svg')}" alt="" />
      <span class="hud-shortcut">T</span>
    </button>
    <button type="button" class="hud-btn hud-btn-shortcut" id="hud-camera" title="Switch camera (C)" aria-label="Switch camera">
      <img src="${assetPath('/assets/img/icon-camera.svg')}" alt="" />
      <span class="hud-shortcut">C</span>
    </button>
  `

  document.body.appendChild(root)

  // Keep mouse interaction out of gameplay and retain focus for driving keys.
  root.addEventListener('mousedown', event => {
    event.preventDefault()
    event.stopPropagation()
  })
  root.addEventListener('pointerdown', event => event.stopPropagation())
  root.addEventListener('touchstart', event => event.stopPropagation(), { passive: true })
  root.addEventListener('click', event => {
    event.stopPropagation()
    if (event.detail > 0) event.target.closest('button')?.blur()
  })
  // Let release events reach document so an existing shot/drag always ends.

  root.querySelector('#hud-drop-trailer').addEventListener('click', () => onDropTrailer?.())
  root.querySelector('#hud-camera').addEventListener('click', () => onSwitchCamera?.())

  const label = root.querySelector('[data-trailer-label]')
  const status = root.querySelector('.hud-trailer-status')
  const dropButton = root.querySelector('#hud-drop-trailer')
  let hideTimer
  let wasCoupled
  const update = () => {
    const activeCoupler = getHitchCoupler ? getHitchCoupler() : hitchCoupler
    const coupled = !!activeCoupler?.coupled
    const state = coupled ? 'attached' : activeCoupler?.connecting ? 'connecting' : 'detached'
    if (root.dataset.trailerState !== state) {
      root.dataset.trailerState = state
      const description = state === 'connecting' ? 'Trailer connecting'
        : coupled ? 'Trailer connected' : 'Trailer disconnected'
      dropButton.title = `${description} — Drop trailer (T)`
      dropButton.setAttribute('aria-label', `${description}. Drop trailer`)
    }
    // Attraction changes only the button; connection messages keep their 4-second lifetime.
    if (wasCoupled === coupled) return
    wasCoupled = coupled
    label.textContent = coupled ? 'Trailer connected' : 'Trailer disconnected'
    status.hidden = false
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { status.hidden = true }, 4000)
  }
  update()

  return { root, update }
}

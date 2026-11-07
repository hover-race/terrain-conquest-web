import * as THREE from 'three'
import { guiState } from './gui.js'
import { MIN_GUN_PITCH, MAX_GUN_PITCH } from './vehicle.js'
import { isUiEvent } from './gameInput.js'

export class GunCamera {
  camera
  parentNode
  scene
  vehicle

  lastMouseX = 0
  lastMouseY = 0
  hasMouseSample = false
  boundHandleMouseMove
  boundHandleMouseClick
  boundHandleMouseWheel
  boundHandlePointerLockChange
  boundHandlePointerLockError
  isPointerLocked = false

  zoomLevels = [1, 1.8, 3.5]
  currentZoomIndex = 0
  baseFOV = 60

  isActive = false
  desiredPosition = new THREE.Vector3()
  lookTarget = new THREE.Vector3()
  upVector = new THREE.Vector3()

  constructor(scene, parentNode, vehicle) {
    this.scene = scene
    this.parentNode = parentNode
    this.vehicle = vehicle
    this.camera = scene.camera

    this.boundHandleMouseMove = this.handleMouseMove.bind(this)
    this.boundHandleMouseClick = this.handleMouseClick.bind(this)
    this.boundHandlePointerLockChange = this.handlePointerLockChange.bind(this)
    this.boundHandlePointerLockError = this.handlePointerLockError.bind(this)
    this.boundHandleMouseWheel = this.handleMouseWheel.bind(this)
  }

  handlePointerLockChange() {
    const isLocked = document.pointerLockElement === document.body
    this.isPointerLocked = isLocked
    if (!isLocked && this.isActive) {
      document.body.style.cursor = 'crosshair'
    }
  }

  handlePointerLockError() {
    this.isPointerLocked = false
    document.body.style.cursor = 'crosshair'
  }

  lockCursorAndHide() {
    if (this.isPointerLocked || !document.body.requestPointerLock) return
    document.body.requestPointerLock()
  }

  unlockCursorAndShow() {
    document.body.style.cursor = 'crosshair'
    if (document.pointerLockElement === document.body && document.exitPointerLock) {
      document.exitPointerLock()
    }
    this.isPointerLocked = false
  }

  handleMouseClick(event) {
    if (!this.isActive || isUiEvent(event)) return
    if (event.button === 0) {
      this.lockCursorAndHide()
    }
  }

  handleMouseWheel(event) {
    if (!this.isActive || isUiEvent(event)) return
    event.preventDefault()

    if (event.deltaY > 0) {
      this.currentZoomIndex = Math.max(0, this.currentZoomIndex - 1)
    } else {
      this.currentZoomIndex = Math.min(this.zoomLevels.length - 1, this.currentZoomIndex + 1)
    }

    const zoomLevel = this.zoomLevels[this.currentZoomIndex]
    this.updateReticleScale(zoomLevel)
  }

  updateReticleScale(zoomLevel) {
    const reticle = document.getElementById('reticle')
    if (reticle) {
      const reticleScale = 2.6 * Math.sqrt(zoomLevel)
      reticle.style.transform = `translate(-50%, -50%) scale(${reticleScale})`
    }
  }

  activate() {
    if (this.isActive || !this.parentNode) return
    this.isActive = true
    this.camera = this.scene.camera
    this.currentZoomIndex = 0
    this.hasMouseSample = false

    const reticle = document.getElementById('reticle')
    if (reticle) {
      reticle.style.display = 'block'
    }
    this.updateReticleScale(this.zoomLevels[this.currentZoomIndex])

    document.removeEventListener('pointerlockchange', this.boundHandlePointerLockChange)
    document.removeEventListener('pointerlockerror', this.boundHandlePointerLockError)
    document.addEventListener('pointerlockchange', this.boundHandlePointerLockChange)
    document.addEventListener('pointerlockerror', this.boundHandlePointerLockError)

    document.removeEventListener('mousemove', this.boundHandleMouseMove)
    document.removeEventListener('mousedown', this.boundHandleMouseClick)
    document.removeEventListener('wheel', this.boundHandleMouseWheel)
    document.addEventListener('mousemove', this.boundHandleMouseMove)
    document.addEventListener('mousedown', this.boundHandleMouseClick)
    document.addEventListener('wheel', this.boundHandleMouseWheel, { passive: false })

    this.update(0.016)
  }

  deactivate() {
    if (!this.isActive) return
    this.isActive = false

    const reticle = document.getElementById('reticle')
    if (reticle) {
      reticle.style.display = 'none'
    }

    this.unlockCursorAndShow()

    if (this.camera) {
      this.camera.up.set(0, 1, 0)
      this.camera.fov = 75
      this.camera.updateProjectionMatrix()
    }

    document.removeEventListener('pointerlockchange', this.boundHandlePointerLockChange)
    document.removeEventListener('pointerlockerror', this.boundHandlePointerLockError)
    document.removeEventListener('mousemove', this.boundHandleMouseMove)
    document.removeEventListener('mousedown', this.boundHandleMouseClick)
    document.removeEventListener('wheel', this.boundHandleMouseWheel)
  }

  handleMouseMove(event) {
    if (!this.isActive || !this.vehicle?.turret) return

    let rawDx = 0
    let rawDy = 0

    if (document.pointerLockElement === document.body) {
      rawDx = event.movementX || 0
      rawDy = event.movementY || 0
    } else if (this.hasMouseSample) {
      rawDx =
        typeof event.movementX === 'number' && event.movementX !== 0
          ? event.movementX
          : event.clientX - this.lastMouseX
      rawDy =
        typeof event.movementY === 'number' && event.movementY !== 0
          ? event.movementY
          : event.clientY - this.lastMouseY
    }

    this.lastMouseX = event.clientX
    this.lastMouseY = event.clientY
    this.hasMouseSample = true

    const deltaX = THREE.MathUtils.clamp(rawDx, -55, 55)
    const deltaY = THREE.MathUtils.clamp(rawDy, -55, 55)

    const zoom = this.zoomLevels[this.currentZoomIndex] || 1
    const baseSens = THREE.MathUtils.clamp(guiState.gunMouseSensitivity || 0.0018, 0.0004, 0.0045)
    const sens = baseSens / zoom

    this.vehicle.turret.targetYaw -= deltaX * sens
    this.vehicle.turret.targetPitch = THREE.MathUtils.clamp(
      this.vehicle.turret.targetPitch - deltaY * sens,
      MIN_GUN_PITCH,
      MAX_GUN_PITCH
    )
  }

  update(deltaTime = 0.016) {
    if (!this.isActive || !this.vehicle || !this.parentNode) return
    this.camera = this.scene.camera
    if (!this.camera) return

    this.vehicle.turret?.applyAnglesAndRecoil(deltaTime)
    this.vehicle.chassis.updateMatrixWorld(true)

    this.parentNode.getWorldPosition(this.desiredPosition)

    const pivot = this.vehicle.gunElevationPivot
    this.lookTarget.set(0, 0.045, 75)
    pivot.localToWorld(this.lookTarget)

    this.upVector.set(0, 1, 0).transformDirection(pivot.matrixWorld).normalize()

    this.camera.near = 0.08
    this.camera.position.copy(this.desiredPosition)
    this.camera.up.copy(this.upVector)
    this.camera.lookAt(this.lookTarget)

    const zoomLevel = this.zoomLevels[this.currentZoomIndex] || 1
    const desiredFov = this.baseFOV / zoomLevel
    if (Math.abs(this.camera.fov - desiredFov) > 0.01) {
      this.camera.fov = desiredFov
      this.camera.updateProjectionMatrix()
    }
  }

  dispose() {
    this.deactivate()
  }
}
